import { getDb, isDbEnabled } from "./db.js";

export const PLAN_LIMITS: Record<string, number> = {
  free:    1_000,
  starter: 50_000,
  pro:     500_000,
};

export interface OrgBilling {
  id: string;
  plan: string;
  pagesUsed: number;
  periodResetAt: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}

export async function getOrgBilling(orgId: string): Promise<OrgBilling | null> {
  if (!isDbEnabled()) return null;
  const db = getDb();
  const { rows } = await db.query(
    `SELECT id, plan, pages_used, period_reset_at, stripe_customer_id, stripe_subscription_id
     FROM organizations WHERE id = $1`,
    [orgId]
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    id: r.id,
    plan: r.plan,
    pagesUsed: r.pages_used,
    periodResetAt: new Date(r.period_reset_at).toISOString(),
    stripeCustomerId: r.stripe_customer_id ?? undefined,
    stripeSubscriptionId: r.stripe_subscription_id ?? undefined,
  };
}

export async function incrementPagesUsed(orgId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = getDb();
  await db.query(
    `UPDATE organizations SET pages_used = pages_used + 1 WHERE id = $1`,
    [orgId]
  );
}

export async function isOverQuota(orgId: string): Promise<{ over: boolean; plan: string; used: number; limit: number }> {
  const billing = await getOrgBilling(orgId);
  if (!billing) return { over: false, plan: "free", used: 0, limit: PLAN_LIMITS.free };
  const limit = PLAN_LIMITS[billing.plan] ?? PLAN_LIMITS.free;
  return { over: billing.pagesUsed >= limit, plan: billing.plan, used: billing.pagesUsed, limit };
}

export async function setPlan(orgId: string, plan: string, stripeCustomerId?: string, stripeSubscriptionId?: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = getDb();
  await db.query(
    `UPDATE organizations
     SET plan = $2,
         stripe_customer_id = COALESCE($3, stripe_customer_id),
         stripe_subscription_id = COALESCE($4, stripe_subscription_id)
     WHERE id = $1`,
    [orgId, plan, stripeCustomerId ?? null, stripeSubscriptionId ?? null]
  );
}

export async function resetMonthlyUsage(): Promise<void> {
  if (!isDbEnabled()) return;
  const db = getDb();
  await db.query(
    `UPDATE organizations SET pages_used = 0, period_reset_at = NOW()`
  );
}
