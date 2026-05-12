import "dotenv/config";
import * as Sentry from "@sentry/node";

// Sentry must init before any other imports so it can instrument them.
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0.1,
  });
}

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

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
  Sentry.captureException(reason);
});

process.on("uncaughtException", (error) => {
  logger.error({ err: error }, "Uncaught exception — shutting down");
  Sentry.captureException(error);
  process.exit(1);
});

main();
