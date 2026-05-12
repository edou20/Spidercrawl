import type { FastifyInstance } from "fastify";
import Stripe from "stripe";
import { getDb, isDbEnabled } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { getOrgBilling, setPlan, PLAN_LIMITS } from "../lib/billing.js";

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";
const APP_URL = process.env.APP_URL ?? "https://spidercrawl.dev";

const PRICE_TO_PLAN: Record<string, string> = {
  [process.env.STRIPE_PRICE_STARTER ?? ""]: "starter",
  [process.env.STRIPE_PRICE_PRO ?? ""]: "pro",
};

function getStripe(): import("stripe").Stripe {
  if (!STRIPE_SECRET_KEY) throw new Error("STRIPE_SECRET_KEY not configured");
  return new (Stripe as any)(STRIPE_SECRET_KEY, { apiVersion: "2026-04-22.dahlia" });
}

export async function registerBillingRoutes(app: FastifyInstance) {
  // ── POST /billing/checkout ────────────────────────────────────
  // Creates a Stripe Checkout session and returns the redirect URL.
  app.post("/billing/checkout", async (request, reply) => {
    if (!request.orgId) return reply.status(401).send({ success: false, error: "Authentication required" });

    const { plan } = (request.body as any) ?? {};
    const priceId = plan === "pro"
      ? process.env.STRIPE_PRICE_PRO
      : process.env.STRIPE_PRICE_STARTER;

    if (!priceId) {
      return reply.status(400).send({ success: false, error: "Invalid plan. Choose 'starter' or 'pro'." });
    }

    const billing = await getOrgBilling(request.orgId);
    if (!billing) return reply.status(404).send({ success: false, error: "Organization not found" });

    try {
      const stripe = getStripe();

      // Reuse existing Stripe customer if available
      let customerId = billing.stripeCustomerId;
      if (!customerId) {
        const db = getDb();
        const { rows } = await db.query("SELECT email, name FROM organizations WHERE id = $1", [request.orgId]);
        const org = rows[0];
        const customer = await stripe.customers.create({
          email: org?.email ?? undefined,
          name: org?.name ?? undefined,
          metadata: { orgId: request.orgId },
        });
        customerId = customer.id;
        await setPlan(request.orgId, billing.plan, customerId);
      }

      const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${APP_URL}/app/settings?upgraded=1`,
        cancel_url: `${APP_URL}/app/settings`,
        metadata: { orgId: request.orgId, plan: plan ?? "starter" },
      });

      return reply.status(200).send({ success: true, data: { url: session.url } });
    } catch (err: any) {
      logger.error({ err: err.message }, "Stripe checkout failed");
      return reply.status(500).send({ success: false, error: "Failed to create checkout session" });
    }
  });

  // ── GET /billing/portal ───────────────────────────────────────
  // Redirects to Stripe Customer Portal for self-serve plan management.
  app.get("/billing/portal", async (request, reply) => {
    if (!request.orgId) return reply.status(401).send({ success: false, error: "Authentication required" });

    const billing = await getOrgBilling(request.orgId);
    if (!billing?.stripeCustomerId) {
      return reply.status(400).send({ success: false, error: "No active subscription found." });
    }

    try {
      const stripe = getStripe();
      const session = await stripe.billingPortal.sessions.create({
        customer: billing.stripeCustomerId,
        return_url: `${APP_URL}/app/settings`,
      });
      return reply.redirect(session.url);
    } catch (err: any) {
      logger.error({ err: err.message }, "Stripe portal failed");
      return reply.status(500).send({ success: false, error: "Failed to open billing portal" });
    }
  });

  // ── POST /billing/webhook ─────────────────────────────────────
  // Stripe sends events here. Must be registered before body parsing.
  app.post("/billing/webhook", {
    config: { rawBody: true },
  }, async (request, reply) => {
    if (!STRIPE_WEBHOOK_SECRET) {
      return reply.status(500).send({ success: false, error: "Webhook secret not configured" });
    }

    const sig = request.headers["stripe-signature"] as string;
    let event: ReturnType<typeof getStripe>["webhooks"] extends { constructEvent(...args: any[]): infer E } ? E : any;

    try {
      const stripe = getStripe();
      const rawBody = (request as any).rawBody ?? Buffer.from(JSON.stringify(request.body));
      event = stripe.webhooks.constructEvent(rawBody, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err: any) {
      logger.warn({ err: err.message }, "Stripe webhook signature invalid");
      return reply.status(400).send({ error: "Invalid signature" });
    }

    try {
      if (!isDbEnabled()) return reply.status(200).send({ received: true });

      if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.created") {
        const sub = event.data.object as any;
        const orgId = sub.metadata?.orgId;
        if (!orgId) return reply.status(200).send({ received: true });

        const priceId = sub.items.data[0]?.price?.id ?? "";
        const plan = PRICE_TO_PLAN[priceId] ?? "free";
        await setPlan(orgId, plan, sub.customer as string, sub.id);
        logger.info({ orgId, plan }, "Plan updated via Stripe webhook");
      }

      if (event.type === "customer.subscription.deleted") {
        const sub = event.data.object as any;
        const orgId = sub.metadata?.orgId;
        if (orgId) {
          await setPlan(orgId, "free");
          logger.info({ orgId }, "Subscription cancelled — reverted to free plan");
        }
      }
    } catch (err: any) {
      logger.error({ err: err.message, eventType: event.type }, "Stripe webhook handler failed");
    }

    return reply.status(200).send({ received: true });
  });

  // ── GET /billing/plans ────────────────────────────────────────
  app.get("/billing/plans", async (_request, reply) => {
    return reply.status(200).send({
      success: true,
      data: [
        { id: "free",    name: "Free",    price: 0,  pagesPerMonth: PLAN_LIMITS.free },
        { id: "starter", name: "Starter", price: 29, pagesPerMonth: PLAN_LIMITS.starter },
        { id: "pro",     name: "Pro",     price: 99, pagesPerMonth: PLAN_LIMITS.pro },
      ],
    });
  });
}
