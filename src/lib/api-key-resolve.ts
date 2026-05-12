import { getRedis } from "./redis.js";
import { getDb, isDbEnabled } from "./db.js";

/**
 * Resolves organization id from `Authorization: Bearer sk-sc-…` using Redis then Postgres.
 * Used for routes that need org context even when REQUIRE_API_KEY is false.
 */
export async function resolveOrgIdFromBearer(authHeader: string | undefined): Promise<string | undefined> {
  const h = authHeader?.trim();
  if (!h?.toLowerCase().startsWith("bearer ")) return undefined;
  const key = h.slice(7).trim();
  if (!key) return undefined;

  try {
    const redis = getRedis();
    const rec = await redis.get(`apikey:lookup:${key}`);
    if (rec) {
      try {
        const parsed = JSON.parse(rec) as { orgId?: string };
        if (parsed.orgId) return parsed.orgId;
      } catch {
        /* legacy plain string in redis */
      }
    }
  } catch {
    /* Redis unavailable */
  }

  if (!isDbEnabled()) return undefined;
  try {
    const { rows } = await getDb().query<{ org_id: string }>(
      "SELECT org_id::text AS org_id FROM api_keys WHERE key = $1 LIMIT 1",
      [key]
    );
    return rows[0]?.org_id;
  } catch {
    return undefined;
  }
}
