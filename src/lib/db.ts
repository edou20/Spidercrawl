import pg from "pg";
import { logger } from "./logger.js";

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getDb(): pg.Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    pool = new Pool({ connectionString, max: 10 });
    pool.on("error", (err) => logger.error(err, "Postgres pool error"));
    logger.info("Postgres pool initialised");
  }
  return pool;
}

export function isDbEnabled(): boolean {
  return !!process.env.DATABASE_URL;
}

export async function disconnectDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info("Postgres pool closed");
  }
}
