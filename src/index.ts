import "dotenv/config";
import { createServer } from "./api/server.js";
import { logger } from "./lib/logger.js";
import { reconcileStaleQueuedJobs, startOrchestratorWorker, syncSchedulesWithQueue } from "./core/orchestrator.js";
import { runMigrations } from "./lib/migrate.js";

const PORT = Number(process.env.PORT) || 3200;
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

main();
