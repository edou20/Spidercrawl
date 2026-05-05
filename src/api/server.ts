import Fastify from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { registerRoutes } from "./routes.js";
import { getRedis } from "../lib/redis.js";
import { logger } from "../lib/logger.js";
import path from "node:path";
import fs from "node:fs";

/**
 * Creates and configures the Fastify server instance.
 */
export async function createServer() {
  const app = Fastify({
    logger: false, // We use our own pino instance
    requestTimeout: 120_000,
  });

  // ── Plugins ──────────────────────────────────────────────────
  await app.register(cors, { origin: true });
  await app.register(rateLimit, {
    max: Number(process.env.API_RATE_LIMIT_MAX ?? 1000),
    timeWindow: process.env.API_RATE_LIMIT_WINDOW ?? "1 minute",
  });

  // ── API key enforcement ──────────────────────────────────────
  if (process.env.REQUIRE_API_KEY === "true") {
    const OPEN_ROUTES = new Set(["/health", "/v1/ai/status"]);

    app.addHook("onRequest", async (request, reply) => {
      const urlPath = request.url.split("?")[0];
      if (OPEN_ROUTES.has(urlPath)) return;

      const redis = getRedis();

      // Bootstrap mode: allow API key creation if none exist
      if (urlPath === "/v1/apikeys") {
        const keyCount = await redis.scard("spidercrawl:apikeys");
        if (keyCount === 0 && (request.method === "POST" || request.method === "GET")) {
          return;
        }
      }

      const authHeader = (request.headers.authorization ?? "").trim();
      const key = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";

      if (!key) {
        return reply.status(401).send({
          success: false,
          error: "Authentication required. Pass your API key as: Authorization: Bearer sk-sc-…",
        });
      }

      // O(1) lookup in Redis
      const keyRecord = await redis.get(`apikey:lookup:${key}`);
      let orgId: string | undefined;
      let isValidKey = false;

      if (keyRecord) {
        isValidKey = true;
        try {
          const parsed = JSON.parse(keyRecord);
          orgId = parsed.orgId;
        } catch {
          // Older dashboard-created keys stored a Redis key id as a plain string.
          // Treat the lookup hit as valid while leaving org scoping unset.
        }
      } else {
        // Fallback to DB
        const { getDb } = await import("../lib/db.js");
        const { rows } = await getDb().query(
          "SELECT org_id FROM api_keys WHERE key = $1 LIMIT 1",
          [key]
        );
        if (rows.length > 0) {
          isValidKey = true;
          orgId = rows[0].org_id;
          // Cache in Redis for next time
          await redis.set(`apikey:lookup:${key}`, JSON.stringify({ orgId }), "EX", 3600);
        }
      }

      if (!isValidKey) {
        logger.warn({ url: request.url }, "Rejected request: invalid API key");
        return reply.status(401).send({ success: false, error: "Invalid or revoked API key." });
      }

      // Attach orgId to the request for downstream use
      request.orgId = orgId;
    });

    logger.info("API key enforcement enabled (REQUIRE_API_KEY=true)");
  }

  // ── Health check ─────────────────────────────────────────────
  app.get("/health", async () => ({
    status: "ok",
    service: "spidercrawl",
    version: "0.1.0",
    uptime: process.uptime(),
  }));

  // ── API Routes ───────────────────────────────────────────────
  await registerRoutes(app);

  // ── Dashboard (static SPA at /app) ────────────────────────────
  const dashboardDist = path.resolve(process.cwd(), "dashboard/dist");
  if (fs.existsSync(dashboardDist)) {
    await app.register(fastifyStatic, {
      root: dashboardDist,
      prefix: "/app/",
      decorateReply: false,
    });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith("/app")) {
        return reply.type("text/html").send(
          fs.readFileSync(path.join(dashboardDist, "index.html"))
        );
      }
      reply.status(404).send({ success: false, error: "Not found" });
    });
    logger.info({ dashboardDist }, "Dashboard mounted at /app");
  }

  // ── Global error handler ─────────────────────────────────────
  app.setErrorHandler((error: Error & { statusCode?: number }, _request, reply) => {
    logger.error(error, "Unhandled error");
    reply.status(error.statusCode || 500).send({
      success: false,
      error: error.message || "Internal Server Error",
    });
  });

  return app;
}
