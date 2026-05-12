import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getRedis } from "../lib/redis.js";
import { logger } from "../lib/logger.js";
import { registerOrganizationWithApiKey, getOrgForAuth } from "../lib/org-billing.js";
import { isDbEnabled } from "../lib/db.js";
import { sendTransactionalEmail } from "../lib/email.js";
import { resolveOrgIdFromBearer } from "../lib/api-key-resolve.js";

const RegisterBodySchema = z.object({
  name: z.string().min(1).max(200),
  email: z.string().email().max(320),
});

export async function registerAuthRoutes(app: FastifyInstance) {
  app.post("/auth/register", async (request, reply) => {
    if (!isDbEnabled()) {
      return reply.status(503).send({ success: false, error: "Registration requires DATABASE_URL (Postgres)." });
    }
    const parsed = RegisterBodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: "Validation failed", details: parsed.error.flatten() });
    }
    const { name, email } = parsed.data;
    try {
      const { orgId, slug, apiKey } = await registerOrganizationWithApiKey(name, email);
      const redis = getRedis();
      await redis.set(`apikey:lookup:${apiKey}`, JSON.stringify({ orgId }));
      await redis.sadd("spidercrawl:apikeys", apiKey);

      const appUrl = process.env.APP_URL?.trim() || "http://127.0.0.1:3200";
      await sendTransactionalEmail(
        email,
        "Welcome to Spidercrawl",
        `<p>Your organization <strong>${escapeHtml(name)}</strong> is ready.</p>
         <p>API key (store securely): <code>${escapeHtml(apiKey)}</code></p>
         <p>Use it as <code>Authorization: Bearer …</code> on every request when <code>REQUIRE_API_KEY=true</code>.</p>
         <p><a href="${escapeHtml(appUrl)}/app/">Open dashboard</a></p>`
      );

      return reply.status(201).send({
        success: true,
        data: {
          orgId,
          slug,
          apiKey,
          message: "Save your API key now — it is not shown again.",
        },
      });
    } catch (err: any) {
      const msg = err?.message || "Registration failed";
      if (/already exists/i.test(msg)) {
        return reply.status(409).send({ success: false, error: msg });
      }
      logger.error(err, "auth/register failed");
      return reply.status(500).send({ success: false, error: msg });
    }
  });

  app.get("/auth/me", async (request, reply) => {
    const orgId = request.orgId ?? (await resolveOrgIdFromBearer(request.headers.authorization));
    if (!orgId) {
      return reply.status(401).send({ success: false, error: "Authentication required. Pass Authorization: Bearer sk-sc-…" });
    }
    const org = await getOrgForAuth(orgId);
    if (!org) {
      return reply.status(404).send({ success: false, error: "Organization not found" });
    }
    return reply.send({
      success: true,
      data: {
        orgId: org.id,
        name: org.name,
        slug: org.slug,
        email: org.email,
        plan: org.plan,
        pagesUsed: org.pages_used,
        pagesQuota: org.pages_quota,
        stripeCustomerId: org.stripe_customer_id,
      },
    });
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
