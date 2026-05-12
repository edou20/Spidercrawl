import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { getDb, isDbEnabled } from "../lib/db.js";
import { getRedis } from "../lib/redis.js";
import { logger } from "../lib/logger.js";
import { getOrgBilling, PLAN_LIMITS } from "../lib/billing.js";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL ?? "noreply@spidercrawl.dev";
const APP_URL = process.env.APP_URL ?? "https://spidercrawl.dev";

async function sendApiKeyEmail(to: string, apiKey: string): Promise<void> {
  if (!RESEND_API_KEY) {
    logger.warn("RESEND_API_KEY not set — skipping welcome email");
    return;
  }
  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to,
      subject: "Your Spidercrawl API key",
      html: `
        <h2>Welcome to Spidercrawl</h2>
        <p>Here is your API key:</p>
        <pre style="background:#f4f4f4;padding:12px;border-radius:6px;font-size:16px">${apiKey}</pre>
        <p>Quick start:</p>
        <pre style="background:#f4f4f4;padding:12px;border-radius:6px">curl -X POST ${APP_URL}/v1/crawl \\
  -H "Authorization: Bearer ${apiKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"url":"https://example.com","maxPages":10}'</pre>
        <p>You're on the <strong>Free plan</strong> — ${PLAN_LIMITS.free.toLocaleString()} pages/month.</p>
        <p><a href="${APP_URL}/app">Open your dashboard →</a></p>
      `,
    }),
  });
}

export async function registerAuthRoutes(app: FastifyInstance) {
  // ── POST /auth/register ───────────────────────────────────────
  // Public endpoint — creates org + API key, emails the key, returns it.
  app.post("/auth/register", {
    config: { rateLimit: { max: 5, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const { email, name } = (request.body as any) ?? {};

    if (!email?.trim() || !email.includes("@")) {
      return reply.status(400).send({ success: false, error: "Valid email required" });
    }
    if (!isDbEnabled()) {
      return reply.status(503).send({ success: false, error: "Database not configured" });
    }

    const db = getDb();
    const redis = getRedis();

    // Prevent duplicate registrations
    const { rows: existing } = await db.query(
      "SELECT id FROM organizations WHERE email = $1 LIMIT 1",
      [email.trim().toLowerCase()]
    );
    if (existing.length > 0) {
      return reply.status(409).send({ success: false, error: "An account with this email already exists." });
    }

    const orgId = crypto.randomUUID();
    const slug = `org-${nanoid(8)}`;
    const orgName = name?.trim() || email.split("@")[0];
    const apiKey = `sk-sc-${nanoid(32)}`;

    try {
      await db.query(
        `INSERT INTO organizations (id, name, slug, email, plan, pages_used, period_reset_at)
         VALUES ($1, $2, $3, $4, 'free', 0, NOW())`,
        [orgId, orgName, slug, email.trim().toLowerCase()]
      );

      await db.query(
        `INSERT INTO api_keys (org_id, name, key) VALUES ($1, $2, $3)`,
        [orgId, "Default Key", apiKey]
      );

      // Cache in Redis for fast auth lookups
      await redis.set(`apikey:lookup:${apiKey}`, JSON.stringify({ orgId }), "EX", 86400 * 30);

      // Send welcome email (non-blocking)
      sendApiKeyEmail(email.trim().toLowerCase(), apiKey).catch((err) => {
        logger.warn({ err: err.message, email }, "Failed to send welcome email");
      });

      logger.info({ orgId, email: email.trim().toLowerCase() }, "New organization registered");

      return reply.status(201).send({
        success: true,
        data: {
          apiKey,
          orgId,
          plan: "free",
          pagesLimit: PLAN_LIMITS.free,
          message: `Your API key has been sent to ${email}. Keep it safe — it won't be shown again.`,
        },
      });
    } catch (err: any) {
      logger.error({ err: err.message }, "Registration failed");
      return reply.status(500).send({ success: false, error: "Registration failed. Please try again." });
    }
  });

  // ── GET /auth/me ──────────────────────────────────────────────
  // Returns the current org's plan + usage. Requires API key.
  app.get("/auth/me", async (request, reply) => {
    if (!request.orgId) {
      return reply.status(401).send({ success: false, error: "Authentication required" });
    }
    const billing = await getOrgBilling(request.orgId);
    if (!billing) return reply.status(404).send({ success: false, error: "Organization not found" });

    const limit = PLAN_LIMITS[billing.plan] ?? PLAN_LIMITS.free;
    return reply.status(200).send({
      success: true,
      data: {
        orgId: billing.id,
        plan: billing.plan,
        pagesUsed: billing.pagesUsed,
        pagesLimit: limit,
        usagePercent: Math.round((billing.pagesUsed / limit) * 100),
        periodResetAt: billing.periodResetAt,
      },
    });
  });
}
