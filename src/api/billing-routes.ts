import type { FastifyInstance } from "fastify";
import Stripe from "stripe";
import { z } from "zod";
import { logger } from "../lib/logger.js";
import {
  applySubscriptionToOrg,
  defaultPagesQuotaForPlan,
  getOrgForAuth,
  setOrgToFreeTier,
  updateOrgStripeCustomer,
} from "../lib/org-billing.js";
import { resolveOrgIdFromBearer } from "../lib/api-key-resolve.js";

const CheckoutSchema = z.object({
  plan: z.enum(["starter", "pro"]),
});

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return null;
  return new Stripe(key);
}

function resolvePlanFromPriceId(priceId: string | undefined): { plan: string; quota: number } {
  const starter = process.env.STRIPE_PRICE_STARTER?.trim();
  const pro = process.env.STRIPE_PRICE_PRO?.trim();
  if (priceId && starter && priceId === starter) {
    return { plan: "starter", quota: defaultPagesQuotaForPlan("starter") };
  }
  if (priceId && pro && priceId === pro) {
    return { plan: "pro", quota: defaultPagesQuotaForPlan("pro") };
  }
  return { plan: "free", quota: defaultPagesQuotaForPlan("free") };
}

export async function registerBillingRoutes(app: FastifyInstance) {
  app.post(
    "/billing/webhook",
    {
      config: {
        rawBody: true,
      },
    },
    async (request, reply) => {
      const stripe = getStripe();
      const secret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
      if (!stripe || !secret) {
        return reply.status(503).send({ success: false, error: "Billing webhook not configured" });
      }
      const sig = request.headers["stripe-signature"];
      if (!sig || typeof sig !== "string") {
        return reply.status(400).send({ success: false, error: "Missing stripe-signature header" });
      }
      const raw = (request as unknown as { rawBody?: Buffer | string }).rawBody;
      const payload = Buffer.isBuffer(raw) ? raw : Buffer.from(typeof raw === "string" ? raw : "", "utf8");
      let event: unknown;
      try {
        event = stripe.webhooks.constructEvent(payload, sig, secret);
      } catch (err: any) {
        logger.warn({ err: err.message }, "Stripe webhook signature verification failed");
        return reply.status(400).send({ success: false, error: "Invalid signature" });
      }

      try {
        switch ((event as { type: string }).type) {
          case "customer.subscription.created":
          case "customer.subscription.updated": {
            const sub = (event as { data: { object: unknown } }).data.object as {
              metadata?: { org_id?: string };
              items?: { data?: Array<{ price?: { id?: string } }> };
              status?: string;
              id?: string;
            };
            const orgId = sub.metadata?.org_id;
            if (!orgId) break;
            const priceId = sub.items?.data?.[0]?.price?.id;
            const { plan, quota } = resolvePlanFromPriceId(priceId);
            if (sub.status === "canceled" || sub.status === "unpaid" || sub.status === "incomplete_expired") {
              await setOrgToFreeTier(orgId);
            } else {
              await applySubscriptionToOrg(orgId, sub.id ?? null, plan, quota);
            }
            break;
          }
          case "customer.subscription.deleted": {
            const sub = (event as { data: { object: unknown } }).data.object as { metadata?: { org_id?: string } };
            const orgId = sub.metadata?.org_id;
            if (orgId) await setOrgToFreeTier(orgId);
            break;
          }
          default:
            break;
        }
      } catch (err: any) {
        logger.error(err, "Stripe webhook handler error");
        return reply.status(500).send({ success: false, error: err.message });
      }

      return reply.send({ received: true });
    }
  );

  app.post("/billing/checkout", async (request, reply) => {
    const stripe = getStripe();
    if (!stripe) {
      return reply.status(503).send({ success: false, error: "Stripe is not configured (STRIPE_SECRET_KEY)." });
    }
    const orgId = request.orgId ?? (await resolveOrgIdFromBearer(request.headers.authorization));
    if (!orgId) {
      return reply.status(401).send({ success: false, error: "Authentication required" });
    }
    const parsed = CheckoutSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: "Validation failed", details: parsed.error.flatten() });
    }
    const { plan } = parsed.data;
    const priceId =
      plan === "starter" ? process.env.STRIPE_PRICE_STARTER?.trim() : process.env.STRIPE_PRICE_PRO?.trim();
    if (!priceId) {
      return reply.status(500).send({ success: false, error: `Missing STRIPE_PRICE_${plan.toUpperCase()} env var` });
    }

    const org = await getOrgForAuth(orgId);
    if (!org) {
      return reply.status(404).send({ success: false, error: "Organization not found" });
    }

    const appUrl = (process.env.APP_URL || "http://127.0.0.1:3200").replace(/\/+$/, "");

    let customerId = org.stripe_customer_id ?? undefined;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: org.email ?? undefined,
        metadata: { org_id: orgId },
      });
      const cid = customer.id;
      if (!cid) {
        return reply.status(500).send({ success: false, error: "Stripe did not return a customer id" });
      }
      customerId = cid;
      await updateOrgStripeCustomer(orgId, customerId);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${appUrl}/app/?billing=success`,
      cancel_url: `${appUrl}/app/?billing=cancel`,
      metadata: { org_id: orgId, plan },
      subscription_data: { metadata: { org_id: orgId, plan } },
    });

    if (!session.url) {
      return reply.status(500).send({ success: false, error: "Stripe did not return a checkout URL" });
    }
    return reply.send({ success: true, data: { url: session.url } });
  });
}
