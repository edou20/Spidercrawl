import { nanoid } from "nanoid";
import { getDb, isDbEnabled } from "./db.js";
import { logger } from "./logger.js";
import { readIntegerEnv } from "./env-utils.js";

export function defaultPagesQuotaForPlan(plan: string): number {
  const p = (plan || "free").toLowerCase();
  if (p === "starter") return readIntegerEnv("PAGES_QUOTA_STARTER", 100_000, { min: 1 });
  if (p === "pro") return readIntegerEnv("PAGES_QUOTA_PRO", 500_000, { min: 1 });
  return readIntegerEnv("PAGES_QUOTA_FREE", 10_000, { min: 1 });
}

export function slugifyOrgBase(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return s || "org";
}

export async function assertCrawlAllowed(orgId: string | undefined): Promise<void> {
  if (!orgId || !isDbEnabled()) return;
  const db = getDb();
  const res = await db.query<{ pages_used: number; pages_quota: number }>(
    `SELECT pages_used, pages_quota FROM organizations WHERE id = $1`,
    [orgId]
  );
  const row = res.rows[0];
  if (!row) return;
  if (row.pages_used >= row.pages_quota) {
    throw new Error(
      `Page quota exceeded (${row.pages_used}/${row.pages_quota}). Upgrade your plan or raise pages_quota for this organization.`
    );
  }
}

export async function incrementOrgPagesUsed(orgId: string, delta: number): Promise<void> {
  if (!orgId || !isDbEnabled() || delta <= 0) return;
  try {
    const db = getDb();
    await db.query(`UPDATE organizations SET pages_used = pages_used + $2 WHERE id = $1`, [orgId, delta]);
  } catch (err: any) {
    logger.warn({ err: err.message, orgId }, "incrementOrgPagesUsed failed");
  }
}

export interface OrgAuthRow {
  id: string;
  name: string;
  slug: string;
  email: string | null;
  plan: string;
  pages_used: number;
  pages_quota: number;
  stripe_customer_id: string | null;
}

export async function getOrgForAuth(orgId: string): Promise<OrgAuthRow | null> {
  if (!isDbEnabled()) return null;
  const db = getDb();
  const res = await db.query<OrgAuthRow>(
    `SELECT id, name, slug, email, plan, pages_used, pages_quota, stripe_customer_id
     FROM organizations WHERE id = $1`,
    [orgId]
  );
  return res.rows[0] ?? null;
}

export async function registerOrganizationWithApiKey(
  name: string,
  email: string
): Promise<{ orgId: string; slug: string; apiKey: string }> {
  if (!isDbEnabled()) {
    throw new Error("DATABASE_URL is required for registration");
  }
  const db = getDb();
  const slug = `${slugifyOrgBase(name)}-${nanoid(8)}`.toLowerCase();
  const apiKey = `sk-sc-${nanoid(24)}`;
  const quota = defaultPagesQuotaForPlan("free");

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const orgRes = await client.query<{ id: string }>(
      `INSERT INTO organizations (name, slug, email, plan, pages_quota)
       VALUES ($1, $2, lower(trim($3)), 'free', $4)
       RETURNING id`,
      [name.trim(), slug, email.trim(), quota]
    );
    const orgId = orgRes.rows[0]!.id;
    await client.query(
      `INSERT INTO api_keys (org_id, name, key) VALUES ($1, $2, $3)`,
      [orgId, "Primary", apiKey]
    );
    await client.query("COMMIT");
    return { orgId, slug, apiKey };
  } catch (err: any) {
    await client.query("ROLLBACK");
    if (/unique|duplicate/i.test(err.message)) {
      throw new Error("An organization with this email already exists.");
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function updateOrgStripeCustomer(orgId: string, customerId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = getDb();
  await db.query(`UPDATE organizations SET stripe_customer_id = $2 WHERE id = $1`, [orgId, customerId]);
}

export async function applySubscriptionToOrg(
  orgId: string,
  subscriptionId: string | null,
  plan: string,
  pagesQuota: number
): Promise<void> {
  if (!isDbEnabled()) return;
  const db = getDb();
  await db.query(
    `UPDATE organizations SET stripe_subscription_id = $2, plan = $3, pages_quota = $4 WHERE id = $1`,
    [orgId, subscriptionId, plan, pagesQuota]
  );
}

export async function setOrgToFreeTier(orgId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = getDb();
  const quota = defaultPagesQuotaForPlan("free");
  await db.query(
    `UPDATE organizations SET plan = 'free', stripe_subscription_id = NULL, pages_quota = $2 WHERE id = $1`,
    [orgId, quota]
  );
}
