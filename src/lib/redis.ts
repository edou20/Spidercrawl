import IORedis, { type RedisOptions } from "ioredis";
import { logger } from "./logger.js";

const REDIS_URL = process.env.REDIS_URL?.trim();
const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
const REDIS_PORT = Number(process.env.REDIS_PORT) || 6379;
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined;

let connection: IORedis | null = null;
let lastRedisErrorMessage: string | null = null;
let lastRedisErrorLoggedAt = 0;

function createRedisClient(options: RedisOptions = {}): IORedis {
  const base: RedisOptions = {
    maxRetriesPerRequest: null, // Required by BullMQ; harmless for normal commands.
    lazyConnect: true,
    connectTimeout: 1000,
    retryStrategy: (attempt) => Math.min(1000 * attempt, 15000),
    ...options,
  };

  if (REDIS_URL) {
    return new IORedis(REDIS_URL, base);
  }

  return new IORedis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: REDIS_PASSWORD,
    ...base,
  });
}

/**
 * Returns a shared Redis connection for BullMQ and general caching.
 * Lazy-initialised on first call.
 */
export function getRedis(): IORedis {
  if (!connection) {
    connection = createRedisClient({ commandTimeout: 1000 });

    connection.on("connect", () => logger.info("Redis connected"));
    connection.on("error", (err) => {
      const now = Date.now();
      if (err.message === lastRedisErrorMessage && now - lastRedisErrorLoggedAt < 15000) {
        return;
      }
      lastRedisErrorMessage = err.message;
      lastRedisErrorLoggedAt = now;
      logger.error(err, "Redis error");
    });
  }

  return connection;
}

/**
 * BullMQ uses blocking Redis commands. Do not set commandTimeout here,
 * otherwise idle workers can time out before a job arrives.
 */
export function createBullRedis(): IORedis {
  const client = createRedisClient();
  client.on("error", (err) => logger.error(err, "BullMQ Redis error"));
  return client;
}

/**
 * Gracefully disconnect Redis (used during shutdown).
 */
export async function disconnectRedis(): Promise<void> {
  if (connection) {
    await connection.quit();
    connection = null;
    logger.info("Redis disconnected");
  }
}
