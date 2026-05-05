import type { FastifyInstance } from "fastify";
import { nanoid } from "nanoid";
import { ScrapeRequestSchema, CrawlRequestSchema, MapRequestSchema, ScheduleRequestSchema } from "../types/schemas.js";
import { scrapePage } from "../core/scraper.js";
import { startCrawl, getCrawlStatus, listRecentJobs, deleteJobStatus, exportJobCsv, exportJobJson, exportJobJsonl, exportJobFineTuneJsonl, retryJob } from "../core/orchestrator.js";
import { deleteEntities, deleteJobRecord, getEntities, getJobPages, getPageDetail, getCrawlEvents, getRecentCrawlEvents, getJobExtractedData, getJobRequest, getJobSummary, setJobSummary, listPageContentForExtraction, updatePageExtractedData } from "../lib/job-store.js";
import { onCrawlEvent } from "../lib/crawl-events.js";
import { detectEntityType, buildPageJsonLd } from "../export/jsonld.js";
import { buildKnowledgeGraphExport, knowledgeGraphToCytoscape, knowledgeGraphToGraphMl } from "../export/graph.js";
import { createSearchSnippet, extractMatchedTerms, tokenizeSearchQuery } from "../export/search.js";
import { searchEmbeddings } from "../export/rag.js";
import { buildKeywordHitFromRow, mergeAndRerankHybridHits, rerankHybridHit } from "./hybrid-search.js";
import { mapSite } from "../core/mapper.js";
import { extractStructured, extractStructuredDetailed } from "../ai/structured-extractor.js";
import { resolveEntities } from "../ai/entity-resolver.js";
import { isAIAvailable, aiComplete } from "../ai/provider.js";
import { getRedis } from "../lib/redis.js";
import { getDb, isDbEnabled } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { createWebhook, deleteWebhook, listWebhooks, toPublicWebhookRecord } from "../lib/webhooks.js";
import { listSchedules, upsertSchedule, deleteSchedule, updateScheduleStatus, getSchedule } from "../lib/schedule-store.js";
import { scheduleCrawlJob, unscheduleCrawlJob } from "../core/orchestrator.js";
import type { WebhookEvent } from "../lib/webhooks.js";
import { normalizeApiPayload } from "./serialize.js";
import { resolveReplayLimit, toReplayPayload } from "./sse-utils.js";

function classifyAIError(err: unknown): { status: number; error: string } | null {
  const message = err instanceof Error ? err.message : String(err ?? "");
  if (/api key not valid|api_key_invalid|invalid api key|unauthorized|permission_denied|401|403/i.test(message)) {
    return {
      status: 503,
      error: "AI provider rejected the configured API key. Update GOOGLE_AI_API_KEY or OPENAI_API_KEY.",
    };
  }
  if (/quota|rate limit|resource_exhausted|too many requests|429/i.test(message)) {
    return {
      status: 503,
      error: "AI provider is temporarily unavailable because of quota or rate limits.",
    };
  }
  return null;
}

/**
 * Registers all v1 API routes.
 */
export async function registerRoutes(app: FastifyInstance) {
  app.addHook("preSerialization", async (request, _reply, payload) => {
    if (!request.url.startsWith("/v1/")) return payload;
    if (!payload || typeof payload !== "object") return payload;
    if (Buffer.isBuffer(payload) || payload instanceof Uint8Array) return payload;
    if (typeof (payload as any).pipe === "function") return payload;
    return normalizeApiPayload(payload);
  });

  // ─── POST /v1/scrape ────────────────────────────────────────
  app.post("/v1/scrape", async (request, reply) => {
    const parsed = ScrapeRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: "Validation failed", details: parsed.error.flatten() });
    }

    try {
      const result = await scrapePage(parsed.data);
      return reply.status(200).send({ success: true, data: result });
    } catch (err: any) {
      logger.error(err, "Scrape failed");
      return reply.status(500).send({ success: false, error: err.message || "Scrape failed" });
    }
  });

  // ─── POST /v1/crawl ────────────────────────────────────────
  app.post("/v1/crawl", {
    config: { rateLimit: { max: 10, timeWindow: "1 minute" } },
  }, async (request, reply) => {
    const parsed = CrawlRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: "Validation failed", details: parsed.error.flatten() });
    }

    const MAX_CONCURRENT_CRAWLS = Number(process.env.MAX_CONCURRENT_CRAWLS ?? 10);
    try {
      const activeJobs = await listRecentJobs(request.orgId);
      const running = activeJobs.filter((j) => j.status === "processing" || j.status === "queued").length;
      if (running >= MAX_CONCURRENT_CRAWLS) {
        return reply.status(429).send({
          success: false,
          error: `Too many active crawls (${running}/${MAX_CONCURRENT_CRAWLS}).`,
        });
      }
    } catch {}

    try {
      const jobId = nanoid();
      await startCrawl(jobId, parsed.data, request.orgId);
      return reply.status(201).send({
        success: true,
        data: {
          id: jobId,
          message: "Crawl job started",
          statusUrl: `/v1/crawl/${jobId}`,
        },
      });
    } catch (err: any) {
      logger.error(err, "Failed to start crawl");
      return reply.status(500).send({ success: false, error: err.message || "Failed to start crawl" });
    }
  });

  // ─── GET /v1/crawl/:id ─────────────────────────────────────
  app.get("/v1/crawl/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const status = await getCrawlStatus(id);
      if (!status) return reply.status(404).send({ success: false, error: "Job not found" });
      const requestConfig = await getJobRequest(id).catch(() => null);
      const enrichedStatus = requestConfig
        ? {
            ...status,
            extractionPrompt: status.extractionPrompt ?? requestConfig.extractionPrompt,
            extractionSchema: status.extractionSchema ?? requestConfig.extractionSchema,
            enableEntities: status.enableEntities ?? requestConfig.enableEntities,
            adaptiveBudget: status.adaptiveBudget ?? requestConfig.adaptiveBudget,
            satisfactionThreshold: status.satisfactionThreshold ?? requestConfig.satisfactionThreshold,
          }
        : status;
      return reply.status(200).send({ success: true, data: enrichedStatus });
    } catch (err: any) {
      const aiError = classifyAIError(err);
      if (aiError) return reply.status(aiError.status).send({ success: false, error: aiError.error });
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ─── POST /v1/map ──────────────────────────────────────────
  app.post("/v1/map", async (request, reply) => {
    const parsed = MapRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ success: false, error: "Validation failed" });
    try {
      const result = await mapSite(parsed.data);
      return reply.status(200).send({ success: true, data: result });
    } catch (err: any) {
      const aiError = classifyAIError(err);
      if (aiError) return reply.status(aiError.status).send({ success: false, error: aiError.error });
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ─── POST /v1/extract ─────────────────────────────────────
  app.post("/v1/extract", async (request, reply) => {
    const body = request.body as any;
    if (!body.url && !body.content) return reply.status(400).send({ success: false, error: "url or content required" });
    
    try {
      let content = body.content || "";
      let pageUrl = body.url || "direct-content";
      if (body.url) {
        const scraped = await scrapePage({ 
          url: body.url, 
          formats: ["markdown"], 
          timeout: 30000,
          enableVision: false,
          useBrowser: false
        });
        content = scraped.markdown || scraped.html || "";
        pageUrl = body.url;
      }
      const extracted = await extractStructured(content, body.schema || body.prompt!, pageUrl);
      return reply.status(200).send({ success: true, data: extracted, url: pageUrl });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ─── GET /v1/jobs ─────────────────────────────────────────
  app.get("/v1/jobs", async (request, reply) => {
    try {
      const jobs = await listRecentJobs(request.orgId);
      return reply.status(200).send({ success: true, data: jobs });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ─── GET /v1/stats ────────────────────────────────────────
  app.get("/v1/stats", async (_request, reply) => {
    try {
      const jobs = await listRecentJobs();
      const totalPages = jobs.reduce((s, j) => s + (j.completedPages || 0), 0);
      return reply.status(200).send({
        success: true,
        data: {
          totalJobs: jobs.length,
          activeJobs: jobs.filter((j) => j.status === "processing" || j.status === "queued").length,
          completedJobs: jobs.filter((j) => j.status === "completed").length,
          failedJobs: jobs.filter((j) => j.status === "failed").length,
          totalPages,
          aiAvailable: isAIAvailable(),
        },
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ─── DELETE /v1/jobs/:id ──────────────────────────────────
  app.delete("/v1/jobs/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      await deleteJobStatus(id);
      await deleteJobRecord(id);
      return reply.status(200).send({ success: true });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ─── POST /v1/jobs/:id/retry ──────────────────────────────
  app.post("/v1/jobs/:id/retry", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const newJobId = await retryJob(id, request.orgId);
      return reply.status(202).send({ success: true, data: { id: newJobId, message: "Job retried" } });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ─── GET /v1/jobs/:id/pages ───────────────────────────────
  app.get("/v1/jobs/:id/pages", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      // Use summary fetch to save memory
      const pages = await getJobPages(id);
      return reply.status(200).send({ success: true, data: pages });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ─── GET /v1/jobs/:id/pages/:url ──────────────────────────
  app.get("/v1/jobs/:id/pages/*", async (request, reply) => {
    const { id } = request.params as { id: string };
    const url = (request.params as any)["*"];
    try {
      const page = await getPageDetail(id, url);
      if (!page) return reply.status(404).send({ success: false, error: "Page not found" });
      return reply.status(200).send({ success: true, data: page });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ─── GET /v1/jobs/:id/links (Graph support) ────────────────
  app.get("/v1/jobs/:id/links", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const { getPageLinks } = await import("../lib/job-store.js");
      const links = await getPageLinks(id);
      return reply.status(200).send({ success: true, data: links });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ─── GET /v1/jobs/:id/entities ────────────────────────────
  app.get("/v1/jobs/:id/entities", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { type } = (request.query as { type?: string }) ?? {};
    try {
      if (!isDbEnabled()) return reply.status(200).send({ success: true, data: [] });
      const entities = await getEntities(id, type);
      return reply.status(200).send({ success: true, data: entities });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ─── POST /v1/jobs/:id/entities/rerun ─────────────────────
  app.post("/v1/jobs/:id/entities/rerun", async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!isDbEnabled()) {
      return reply.status(400).send({ success: false, error: "Database not available for entity resolution" });
    }
    if (!isAIAvailable()) {
      return reply.status(503).send({ success: false, error: "Entity resolution requires GOOGLE_AI_API_KEY or OPENAI_API_KEY" });
    }

    try {
      const req = await getJobRequest(id);
      if (!req) return reply.status(404).send({ success: false, error: "Job not found" });
      await deleteEntities(id);
      const result = await resolveEntities(id, undefined, 2);
      return reply.status(200).send({ success: true, data: result });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ─── Export endpoints ─────────────────────────────────────
  app.get("/v1/export/json/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const job = await exportJobJson(id);
      return reply.status(200).send({ success: true, data: job });
    } catch (err: any) {
      const status = err.message === "Job not found" ? 404 : 500;
      return reply.status(status).send({ success: false, error: err.message });
    }
  });

  app.get("/v1/export/csv/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const csv = await exportJobCsv(id);
      return reply
        .header("content-type", "text/csv; charset=utf-8")
        .header("content-disposition", `attachment; filename="crawl-${id}.csv"`)
        .send(csv);
    } catch (err: any) {
      const status = err.message === "Job not found" ? 404 : 500;
      return reply.status(status).send({ success: false, error: err.message });
    }
  });

  app.get("/v1/export/jsonl/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const jsonl = await exportJobJsonl(id);
      return reply
        .header("content-type", "application/x-ndjson; charset=utf-8")
        .header("content-disposition", `attachment; filename="crawl-${id}.jsonl"`)
        .send(jsonl);
    } catch (err: any) {
      const status = err.message === "Job not found" ? 404 : 500;
      return reply.status(status).send({ success: false, error: err.message });
    }
  });

  app.get("/v1/export/fine-tune-jsonl/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const jsonl = await exportJobFineTuneJsonl(id);
      return reply
        .header("content-type", "application/x-ndjson; charset=utf-8")
        .header("content-disposition", `attachment; filename="crawl-${id}-fine-tune.jsonl"`)
        .send(jsonl);
    } catch (err: any) {
      const status = err.message === "Job not found" ? 404 : 500;
      return reply.status(status).send({ success: false, error: err.message });
    }
  });

  app.get("/v1/export/jsonld/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const job = await exportJobJson(id);
      const graph = job.results.map((page) => buildPageJsonLd(page, detectEntityType(page)));
      return reply.status(200).send({
        success: true,
        data: {
          "@context": "https://schema.org",
          "@type": "Dataset",
          name: `Spidercrawl export for ${job.rootUrl}`,
          url: job.rootUrl,
          dateCreated: job.createdAt,
          dateModified: job.updatedAt,
          "@graph": graph,
        },
      });
    } catch (err: any) {
      const status = err.message === "Job not found" ? 404 : 500;
      return reply.status(status).send({ success: false, error: err.message });
    }
  });

  app.get("/v1/export/cytoscape/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const job = await exportJobJson(id);
      const entities = await getEntities(id);
      const graph = buildKnowledgeGraphExport(job, entities);
      return reply.status(200).send({ success: true, data: knowledgeGraphToCytoscape(graph) });
    } catch (err: any) {
      const status = err.message === "Job not found" ? 404 : 500;
      return reply.status(status).send({ success: false, error: err.message });
    }
  });

  app.get("/v1/export/graphml/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const job = await exportJobJson(id);
      const entities = await getEntities(id);
      const graphml = knowledgeGraphToGraphMl(buildKnowledgeGraphExport(job, entities));
      return reply
        .header("content-type", "application/graphml+xml; charset=utf-8")
        .header("content-disposition", `attachment; filename="crawl-${id}.graphml"`)
        .send(graphml);
    } catch (err: any) {
      const status = err.message === "Job not found" ? 404 : 500;
      return reply.status(status).send({ success: false, error: err.message });
    }
  });

  app.get("/v1/export/rag/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const job = await exportJobJson(id);
      const { results, ...metadata } = job;
      return reply.status(200).send({
        success: true,
        data: {
          job: metadata,
          documents: results.map((page) => ({
            id: page.url,
            url: page.url,
            title: page.title,
            content: page.markdown ?? page.html ?? "",
            metadata: {
              statusCode: page.statusCode,
              crawledAt: page.metadata.crawledAt,
              description: page.metadata.description,
              language: page.metadata.language,
            },
          })),
        },
      });
    } catch (err: any) {
      const status = err.message === "Job not found" ? 404 : 500;
      return reply.status(status).send({ success: false, error: err.message });
    }
  });

  // ─── POST /v1/export/rag/:id/search ───────────────────────
  app.post("/v1/export/rag/:id/search", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { query, limit = 8 } = request.body as { query?: string; limit?: number };
    if (!query?.trim()) return reply.status(400).send({ success: false, error: "query required" });

    try {
      if (isDbEnabled()) {
        const db = getDb();
        const terms = tokenizeSearchQuery(query);
        const patterns = terms.length ? terms.map((term) => `%${term}%`) : [`%${query}%`];
        const clauses = patterns.map((_, index) => `(markdown ILIKE $${index + 2} OR title ILIKE $${index + 2})`);
        const scoreSql = patterns
          .map((_, index) => `CASE WHEN markdown ILIKE $${index + 2} OR title ILIKE $${index + 2} THEN 1 ELSE 0 END`)
          .join(" + ");
        const keywordRes = await db.query(
          `SELECT url, title, markdown,
                  (${scoreSql})::float as similarity,
                  status_code, depth, crawled_at
           FROM pages
           WHERE job_id = $1 AND (${clauses.join(" OR ")})
           ORDER BY similarity DESC, crawled_at DESC
           LIMIT $${patterns.length + 2}`,
          [id, ...patterns, limit * 3]
        );

        const keywordHits = keywordRes.rows.map((row) => buildKeywordHitFromRow(row, query, terms, patterns.length));

        if (process.env.OPENAI_API_KEY) {
          try {
            const countRes = await db.query(`SELECT COUNT(*) FROM embeddings WHERE job_id = $1`, [id]);
            if (parseInt(countRes.rows[0].count) > 0) {
              const vectorHits = await searchEmbeddings(id, query, limit * 3);
              const reranked = mergeAndRerankHybridHits(keywordHits, vectorHits, query, limit);
              return reply.status(200).send({ success: true, data: reranked, searchType: "hybrid" });
            }
          } catch (err: any) {
            logger.warn({ jobId: id, err: err.message }, "Vector search failed; falling back to keyword-only results");
          }
        }

        const reranked = keywordHits
          .map((hit) => {
            const rerank = rerankHybridHit(hit, terms);
            return { ...hit, similarity: rerank, scoreBreakdown: { ...(hit.scoreBreakdown ?? {}), rerank }, searchType: "hybrid" as const };
          })
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, limit);

        return reply.status(200).send({ success: true, data: reranked, searchType: "hybrid" });
      }

      return reply.status(400).send({ success: false, error: "Database not available for search" });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ─── POST /v1/search ───────────────────────────────────────
  // Cross-job search optimized with SQL ILIKE
  app.post("/v1/search", async (request, reply) => {
    const { query, limit = 12 } = request.body as { query?: string; limit?: number };
    if (!query?.trim()) return reply.status(400).send({ success: false, error: "query required" });
    if (!isDbEnabled()) return reply.status(400).send({ success: false, error: "DATABASE_URL required" });

    try {
      const db = getDb();
      const terms = tokenizeSearchQuery(query);
      const patterns = terms.length ? terms.map((term) => `%${term}%`) : [`%${query}%`];
      const clauses = patterns.map((_, index) => {
        const param = `$${index + 1}`;
        return `(p.markdown ILIKE ${param} OR p.title ILIKE ${param} OR j.root_url ILIKE ${param})`;
      });
      const scoreSql = patterns
        .map((_, index) => {
          const param = `$${index + 1}`;
          return `CASE WHEN p.markdown ILIKE ${param} OR p.title ILIKE ${param} OR j.root_url ILIKE ${param} THEN 1 ELSE 0 END`;
        })
        .join(" + ");

      const res = await db.query(
        `SELECT p.url, p.title, p.markdown,
                (${scoreSql})::float as similarity,
                p.status_code, p.depth, p.crawled_at,
                j.id as job_id, j.root_url as job_root_url, j.goal as job_goal
         FROM pages p
         JOIN jobs j ON j.id = p.job_id
         WHERE (${clauses.join(" OR ")})
           AND (j.org_id = $${patterns.length + 2} OR j.org_id IS NULL)
         ORDER BY similarity DESC, p.crawled_at DESC
         LIMIT $${patterns.length + 1}`,
        [...patterns, limit, request.orgId]
      );
      
      const formatted = res.rows.map(row => ({
        url: row.url,
        title: row.title,
        content: createSearchSnippet(row.markdown ?? "", terms.length ? terms : [query.toLowerCase()]),
        similarity: Number(row.similarity) / Math.max(1, patterns.length),
        searchType: "hybrid" as const,
        matchedTerms: extractMatchedTerms(`${row.title ?? ""} ${row.markdown ?? ""} ${row.job_root_url ?? ""}`.toLowerCase(), terms),
        provenance: {
          depth: row.depth ?? undefined,
          statusCode: row.status_code ?? undefined,
          crawledAt: row.crawled_at ? new Date(row.crawled_at).toISOString() : undefined,
        },
        scoreBreakdown: {
          keyword: Number(row.similarity) / Math.max(1, patterns.length),
        },
        job: { id: row.job_id, rootUrl: row.job_root_url, goal: row.job_goal ?? undefined }
      }));

      const reranked = formatted
        .map((hit) => {
          const rerank = rerankHybridHit(hit, terms);
          return {
            ...hit,
            similarity: rerank,
            scoreBreakdown: { ...(hit.scoreBreakdown ?? {}), rerank },
          };
        })
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

      return reply.status(200).send({ success: true, data: reranked });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ─── API Keys ─────────────────────────────────────────────
  app.post("/v1/apikeys", async (request, reply) => {
    const { name } = (request.body as any) ?? {};
    const key = `sk-sc-${nanoid(40)}`;
    const record = { id: nanoid(8), name: name?.trim() || "Key", key, createdAt: new Date().toISOString() };
    const redis = getRedis();
    
    await redis.set(`apikey:${record.id}`, JSON.stringify(record));
    await redis.set(`apikey:lookup:${key}`, record.id); // O(1) lookup
    await redis.sadd("spidercrawl:apikeys", record.id);
    
    return reply.status(201).send({ success: true, data: record });
  });

  app.get("/v1/apikeys", async (_request, reply) => {
    const redis = getRedis();
    const ids = await redis.smembers("spidercrawl:apikeys");
    const results = (await Promise.all(ids.map(async id => {
      const raw = await redis.get(`apikey:${id}`);
      if (!raw) return null;
      const d = JSON.parse(raw);
      return { id: d.id, name: d.name, createdAt: d.createdAt };
    }))).filter(Boolean);
    return reply.status(200).send({ success: true, data: results });
  });

  app.delete("/v1/apikeys/:keyId", async (request, reply) => {
    const { keyId } = request.params as { keyId: string };
    const redis = getRedis();
    const raw = await redis.get(`apikey:${keyId}`);
    if (raw) {
      const d = JSON.parse(raw);
      await redis.del(`apikey:lookup:${d.key}`);
    }
    await redis.del(`apikey:${keyId}`);
    await redis.srem("spidercrawl:apikeys", keyId);
    return reply.status(200).send({ success: true });
  });

  // ─── Schedules (Phase 2.4) ───────────────────────────────────
  app.get("/v1/schedules", async (request, reply) => {
    try {
      const list = await listSchedules(request.orgId);
      return reply.status(200).send({ success: true, data: list });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  app.post("/v1/schedules", async (request, reply) => {
    const parsed = ScheduleRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: "Validation failed", details: parsed.error.flatten() });
    }

    try {
      const schedule = await upsertSchedule({ ...parsed.data, orgId: request.orgId });
      if (schedule.active) {
        await scheduleCrawlJob(schedule);
      }
      return reply.status(201).send({ success: true, data: schedule });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  app.patch("/v1/schedules/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { active } = request.body as { active?: boolean };
    
    if (active === undefined) return reply.status(400).send({ success: false, error: "active field required" });

    try {
      const schedule = await getSchedule(id);
      if (!schedule) return reply.status(404).send({ success: false, error: "Schedule not found" });

      await updateScheduleStatus(id, active);
      
      if (active) {
        await scheduleCrawlJob({ ...schedule, active: true });
      } else {
        await unscheduleCrawlJob(id, schedule.cron);
      }

      return reply.status(200).send({ success: true });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  app.delete("/v1/schedules/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const schedule = await getSchedule(id);
      if (schedule) {
        await unscheduleCrawlJob(id, schedule.cron);
        await deleteSchedule(id);
      }
      return reply.status(200).send({ success: true });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ─── Webhooks (Phase 2.5) ───────────────────────────────────
  app.get("/v1/webhooks", async (request, reply) => {
    try {
      const list = await listWebhooks(request.orgId);
      return reply.status(200).send({ success: true, data: list.map(toPublicWebhookRecord) });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  app.post("/v1/webhooks", async (request, reply) => {
    const { url, event } = (request.body as any) ?? {};
    if (!url || !event) return reply.status(400).send({ success: false, error: "url and event required" });
    
    try {
      const record = await createWebhook(event as WebhookEvent, url, request.orgId);
      return reply.status(201).send({ success: true, data: { ...toPublicWebhookRecord(record), secret: record.secret } });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  app.delete("/v1/webhooks/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const ok = await deleteWebhook(id, request.orgId);
      return reply.status(ok ? 200 : 404).send({ success: ok, data: { deleted: ok } });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ─── GET /v1/jobs/:id/events ──────────────────────────────
  app.get("/v1/jobs/:id/events", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const events = await getCrawlEvents(id);
      return reply.status(200).send({ success: true, data: events });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ─── GET /v1/crawl/:id/stream (SSE) ──────────────────────
  app.get("/v1/crawl/:id/stream", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { replayLimit } = (request.query as { replayLimit?: string }) ?? {};

    const status = await getCrawlStatus(id);
    if (!status) return reply.status(404).send({ success: false, error: "Job not found" });

    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no");
    reply.raw.flushHeaders();

    const replaySafe = resolveReplayLimit(replayLimit, process.env.SSE_REPLAY_LIMIT);

    // Replay the last N persisted events so dashboard refreshes don't lose context.
    if (replaySafe > 0) {
      try {
        const recent = await getRecentCrawlEvents(id, replaySafe);
        for (const event of recent) {
          reply.raw.write(`data: ${toReplayPayload(event)}\n\n`);
        }
      } catch (err: any) {
        logger.warn({ jobId: id, err: err.message }, "Failed to replay recent crawl events");
      }
    }

    // If job is already done, send a terminal event and close immediately
    if (status.status === "completed" || status.status === "failed") {
      const terminal = JSON.stringify({
        type: `job.${status.status}`,
        jobId: id,
        data: { completedPages: status.completedPages },
        ts: new Date().toISOString(),
      });
      reply.raw.write(`data: ${terminal}\n\n`);
      reply.raw.write(`data: {"type":"stream.end"}\n\n`);
      reply.raw.end();
      return reply;
    }

    // Send an initial progress snapshot
    const snapshot = JSON.stringify({
      type: "job.progress",
      jobId: id,
      data: { completedPages: status.completedPages, progress: status.progress },
      ts: new Date().toISOString(),
    });
    reply.raw.write(`data: ${snapshot}\n\n`);

    // Heartbeat to keep proxy connections alive
    const heartbeat = setInterval(() => {
      if (!reply.raw.destroyed) reply.raw.write(":heartbeat\n\n");
    }, 15000);

    // Subscribe to in-process events
    const unsubscribe = onCrawlEvent(id, (event) => {
      if (reply.raw.destroyed) return;
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      if (event.type === "job.completed" || event.type === "job.failed") {
        reply.raw.write(`data: {"type":"stream.end"}\n\n`);
        clearInterval(heartbeat);
        unsubscribe();
        reply.raw.end();
      }
    });

    // Clean up when client disconnects
    reply.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });

    // Hijack Fastify reply — we're managing the response manually
    return reply;
  });

  // ─── GET /v1/jobs/:id/extracted ──────────────────────────
  app.get("/v1/jobs/:id/extracted", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { limit } = request.query as { limit?: string };
    try {
      const data = await getJobExtractedData(id, limit ? Number(limit) : 50);
      return reply.status(200).send({ success: true, data });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ─── POST /v1/jobs/:id/extraction/rerun ───────────────────
  app.post("/v1/jobs/:id/extraction/rerun", async (request, reply) => {
    const { id } = request.params as { id: string };
    const body = (request.body as { schema?: Record<string, unknown>; prompt?: string; limit?: number }) ?? {};
    if (!body.schema && !body.prompt) {
      return reply.status(400).send({ success: false, error: "schema or prompt required" });
    }
    if (!isDbEnabled()) {
      return reply.status(400).send({ success: false, error: "Database not available for extraction rerun" });
    }

    try {
      const pages = await listPageContentForExtraction(id);
      if (pages.length === 0) return reply.status(404).send({ success: false, error: "No pages found for job" });

      const max = Math.max(1, Math.min(body.limit ?? pages.length, pages.length));
      const schema = body.schema ?? body.prompt!;
      let successCount = 0;
      const failures: Array<{ url: string; error: string }> = [];

      for (const page of pages.slice(0, max)) {
        const content = page.markdown ?? page.html ?? "";
        if (!content.trim()) continue;
        try {
          const { data } = await extractStructuredDetailed(content, schema, page.url);
          await updatePageExtractedData(id, page.url, data);
          successCount++;
        } catch (err: any) {
          failures.push({ url: page.url, error: err.message || "Extraction failed" });
        }
      }

      return reply.status(200).send({
        success: true,
        data: {
          jobId: id,
          processed: max,
          extracted: successCount,
          failed: failures.length,
          failures: failures.slice(0, 20),
        },
      });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ─── GET /v1/jobs/:id/summary ─────────────────────────────
  app.get("/v1/jobs/:id/summary", async (request, reply) => {
    const { id } = request.params as { id: string };
    try {
      const cached = await getJobSummary(id);
      if (cached) return reply.status(200).send({ success: true, data: { summary: cached, cached: true } });

      if (!isAIAvailable()) {
        return reply.status(503).send({ success: false, error: "AI provider not configured" });
      }
      if (!isDbEnabled()) {
        return reply.status(503).send({ success: false, error: "Database not configured" });
      }

      const db = getDb();
      const jobRes = await db.query(`SELECT root_url, goal, completed_pages FROM jobs WHERE id = $1`, [id]);
      if (!jobRes.rows[0]) return reply.status(404).send({ success: false, error: "Job not found" });
      const job = jobRes.rows[0];

      const pagesRes = await db.query(
        `SELECT title, url, substring(markdown from 1 for 400) AS excerpt
         FROM pages WHERE job_id = $1 AND markdown IS NOT NULL
         ORDER BY crawled_at ASC LIMIT 30`,
        [id]
      );
      if (pagesRes.rows.length === 0) {
        return reply.status(422).send({ success: false, error: "No page content to summarize" });
      }

      const pageList = pagesRes.rows
        .map((r: any) => `• ${r.title || r.url}: ${(r.excerpt || "").slice(0, 200)}`)
        .join("\n");

      const response = await aiComplete({
        systemPrompt: "You are a research analyst. Summarize web crawl results concisely in bullet points.",
        prompt: `Crawl of: ${job.root_url}\nGoal: ${job.goal || "Breadth-first exploration"}\nPages crawled: ${job.completed_pages}\n\nPage excerpts:\n${pageList}\n\nWrite exactly 3 bullet points (each starting with •) covering: what type of content was found, key topics or data discovered, and one notable pattern or standout finding.`,
        temperature: 0.2,
        maxTokens: 512,
      });

      const summary = response.text.trim();
      await setJobSummary(id, summary).catch(() => {});
      return reply.status(200).send({ success: true, data: { summary, cached: false } });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ─── POST /v1/jobs/:id/ask ────────────────────────────────
  app.post("/v1/jobs/:id/ask", async (request, reply) => {
    const { id } = request.params as { id: string };
    const { question, limit = 5 } = request.body as { question?: string; limit?: number };
    if (!question?.trim()) {
      return reply.status(400).send({ success: false, error: "question is required" });
    }
    if (!isAIAvailable()) {
      return reply.status(503).send({ success: false, error: "AI provider not configured" });
    }
    try {
      const { answer, sources } = await synthesizeAnswer(id, question.trim(), Number(limit));
      return reply.status(200).send({ success: true, data: { answer, sources } });
    } catch (err: any) {
      return reply.status(500).send({ success: false, error: err.message });
    }
  });

  // ─── GET /v1/ai/status ────────────────────────────────────
  app.get("/v1/ai/status", async () => ({
    success: true,
    aiAvailable: isAIAvailable(),
    providers: { gemini: !!process.env.GOOGLE_AI_API_KEY, openai: !!process.env.OPENAI_API_KEY },
  }));

  // ─── GET /v1/system/health ────────────────────────────────
  app.get("/v1/system/health", async (_request, reply) => {
    const workerHost = process.env.WORKER_HOST ?? "127.0.0.1";
    const workerPort = process.env.WORKER_PORT ?? "8400";

    let dbOk = false;
    try {
      if (isDbEnabled()) {
        await getDb().query("SELECT 1");
        dbOk = true;
      }
    } catch {}

    let redisOk = false;
    try {
      await getRedis().ping();
      redisOk = true;
    } catch {}

    let workerOk = false;
    try {
      const res = await fetch(`http://${workerHost}:${workerPort}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      workerOk = res.ok;
    } catch {}

    let lastWorkerError: string | undefined;
    if (isDbEnabled()) {
      try {
        const db = getDb();
        const errRes = await db.query(
          `SELECT url, data, created_at
           FROM crawl_events
           WHERE event_type = 'page.failed'
           ORDER BY created_at DESC
           LIMIT 1`
        );
        if (errRes.rows[0]) {
          const row = errRes.rows[0];
          const data = typeof row.data === "object" ? row.data : JSON.parse(row.data ?? "{}");
          const msg = typeof data.error === "string" ? data.error : "Worker page failure";
          lastWorkerError = `${msg}${row.url ? ` @ ${row.url}` : ""}`;
        }
      } catch {}
    }

    return reply.status(200).send({
      success: true,
      data: {
        api: true,
        db: dbOk,
        redis: redisOk,
        worker: workerOk,
        ai: isAIAvailable(),
        lastWorkerError,
      },
    });
  });
}

// ── Shared synthesis helper (used by route + MCP tool) ───────────────────────

export async function synthesizeAnswer(
  jobId: string,
  question: string,
  limit = 5
): Promise<{ answer: string; sources: string[] }> {
  let chunks: Array<{ content: string; url: string; title?: string }> = [];

  // 1. Try vector search (requires pgvector + OpenAI key)
  if (isDbEnabled() && process.env.OPENAI_API_KEY) {
    try {
      const hits = await searchEmbeddings(jobId, question, limit);
      if (hits.length > 0) {
        chunks = hits.map((h) => ({ content: h.content, url: h.url, title: h.title }));
      }
    } catch {}
  }

  // 2. Fallback: keyword search over stored markdown
  if (chunks.length === 0 && isDbEnabled()) {
    const db = getDb();
    const terms = tokenizeSearchQuery(question);
    const res = await db.query(
      `SELECT url, title, substring(markdown from 1 for 2000) AS excerpt
       FROM pages WHERE job_id = $1 AND markdown IS NOT NULL
       ORDER BY crawled_at ASC LIMIT 50`,
      [jobId]
    );
    const scored = res.rows
      .map((r: any) => ({
        ...r,
        score: terms.filter((t: string) => (r.excerpt ?? "").toLowerCase().includes(t)).length,
      }))
      .filter((r: any) => r.score > 0)
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, limit);
    chunks = scored.map((r: any) => ({ content: r.excerpt, url: r.url, title: r.title }));
  }

  if (chunks.length === 0) {
    throw new Error("No relevant content found. Ensure the crawl is complete and has page content.");
  }

  const context = chunks
    .map((c, i) => `[${i + 1}] ${c.url}\n${c.content}`)
    .join("\n\n---\n\n");

  const response = await aiComplete({
    systemPrompt:
      "You are a precise research assistant. Answer questions using ONLY the provided page excerpts. Cite sources by URL. If the answer is not in the content, say so clearly.",
    prompt: `Question: ${question}\n\nContent from crawled pages:\n\n${context}\n\nAnswer:`,
    temperature: 0.1,
    maxTokens: 1024,
  });

  return {
    answer: response.text.trim(),
    sources: [...new Set(chunks.map((c) => c.url))],
  };
}
