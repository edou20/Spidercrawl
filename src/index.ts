import "dotenv/config";
import crypto from "node:crypto";
import { createServer } from "./api/server.js";
import { logger } from "./lib/logger.js";
import { reconcileStaleQueuedJobs, startOrchestratorWorker, syncSchedulesWithQueue } from "./core/orchestrator.js";
import { runMigrations } from "./lib/migrate.js";
import { readIntegerEnv } from "./lib/env-utils.js";

const PORT = readIntegerEnv("PORT", 3200, { min: 1, max: 65535 });
const HOST = process.env.HOST || "0.0.0.0";

async function main() {
  // Apply any pending DB migrations before accepting traffic
  await runMigrations();
  
  // Phase 4.1: Bootstrap default organization and API key if none exist
  await bootstrapMultiTenancy();

  const server = await createServer();

  try {
    await server.listen({ port: PORT, host: HOST });
    logger.info(`🕷️  Spidercrawl API running at http://${HOST}:${PORT}`);

    if (process.env.DATABASE_URL && process.env.DISABLE_DATABASE_KEEPALIVE !== "true") {
      const ms = readIntegerEnv("DATABASE_KEEPALIVE_MS", 86_400_000, { min: 60_000 });
      setInterval(() => {
        void import("./lib/db.js").then(({ getDb, isDbEnabled }) => {
          if (!isDbEnabled()) return;
          getDb().query("SELECT 1").catch(() => {});
        });
      }, ms).unref();
      logger.info({ ms }, "Database keepalive interval started");
    }

    // Start background worker for crawl jobs
    startOrchestratorWorker();
    await reconcileStaleQueuedJobs();
    
    // Sync active schedules
    await syncSchedulesWithQueue();
  } catch (err) {
    logger.error(err, "Failed to start Spidercrawl");
    process.exit(1);
  }
}

async function bootstrapMultiTenancy() {
  const { isDbEnabled, getDb } = await import("./lib/db.js");
  const { getRedis } = await import("./lib/redis.js");
  const { nanoid } = await import("nanoid");
  
  if (!isDbEnabled()) return;
  const db = getDb();
  const redis = getRedis();
  
  // Check if any org exists
  const { rows: orgs } = await db.query("SELECT id FROM organizations LIMIT 1");
  if (orgs.length === 0) {
    logger.info("First run detected. Bootstrapping default organization...");
    const orgId = crypto.randomUUID();
    await db.query(
      "INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3)",
      [orgId, "Default Organization", "default"]
    );
    
    const apiKey = `sk-sc-${nanoid(24)}`;
    await db.query(
      "INSERT INTO api_keys (org_id, name, key) VALUES ($1, $2, $3)",
      [orgId, "Default Key", apiKey]
    );
    
    // Sync to Redis for fast lookup
    await redis.set(`apikey:lookup:${apiKey}`, JSON.stringify({ orgId }));
    await redis.sadd("spidercrawl:apikeys", apiKey);
    
    logger.info({ apiKey }, "🚀 Default organization and API key created.");
    console.log(`\n🔑 INITIAL API KEY: ${apiKey}\n`);
  }
}

main();
