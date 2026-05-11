import { Queue, Worker, Job } from "bullmq";
import parseExpression from "cron-parser";
import { createBullRedis, getRedis } from "../lib/redis.js";
import { scrapePage } from "./scraper.js";
import { scoreLinks, filterByRelevance } from "../ai/goal-scorer.js";
import { isAIAvailable } from "../ai/provider.js";
import { resolveEntities, resolveEntitiesForPage } from "../ai/entity-resolver.js";
import { logger } from "../lib/logger.js";
import { upsertJob, updateJobStatus, insertPage, getJobRequest, getJobRecord, getJobPages, getJobPagesWithContent, getVisitedUrls, listJobs, getPageHashes, getOldPageResult, insertCrawlEvent } from "../lib/job-store.js";
import { emitCrawlEvent } from "../lib/crawl-events.js";
import { deliverJobWebhooks } from "../lib/webhooks.js";
import { isDbEnabled } from "../lib/db.js";
import { buildPageJsonLd, detectEntityType } from "../export/jsonld.js";
import { listSchedules, updateScheduleLastRun, getSchedule } from "../lib/schedule-store.js";
import { nanoid } from "nanoid";
import type { CrawlRequest, JobStatus, PageResult, Schedule } from "../types/schemas.js";
import { readIntegerEnv } from "../lib/env-utils.js";

// ── Queue Definitions ────────────────────────────────────────

const CRAWL_QUEUE_NAME = "spidercrawl-crawls";
const DEFAULT_STALE_QUEUED_JOB_MS = 10 * 60 * 1000;

// Lazy-initialized queue to avoid connecting to Redis if not needed
let crawlQueue: Queue | null = null;
let crawlWorker: Worker | null = null;
const CRAWL_EXECUTION_MODE = process.env.CRAWL_EXECUTION_MODE ?? "auto";
const CRAWL_QUEUE_FALLBACK_MS = readIntegerEnv("CRAWL_QUEUE_FALLBACK_MS", 5000, { min: 0 });
const CRAWL_PAGE_DELAY_MS = readIntegerEnv("CRAWL_PAGE_DELAY_MS", 500, { min: 0 });

function getQueue(): Queue {
  if (!crawlQueue) {
    crawlQueue = new Queue(CRAWL_QUEUE_NAME, { connection: createBullRedis() });
  }
  return crawlQueue;
}

function dispatchLocalCrawl(jobId: string, req: CrawlRequest): void {
  queueMicrotask(() => {
    runCrawl(jobId, req).catch(async (err: any) => {
      logger.error({ jobId, err: err.message }, "In-process crawl fallback failed");
      await markJobFailed(jobId, err.message);
    });
  });
}

async function removeWaitingQueueJob(jobId: string): Promise<boolean> {
  try {
    const queueJob = await getQueue().getJob(jobId);
    if (!queueJob) return true;

    const state = await queueJob.getState();
    if (!["waiting", "delayed", "prioritized"].includes(state)) return false;

    await queueJob.remove();
    return true;
  } catch (err: any) {
    logger.debug({ jobId, err: err.message }, "Unable to remove queued crawl before fallback");
    return false;
  }
}

function scheduleQueueFallback(jobId: string, req: CrawlRequest): void {
  if (CRAWL_EXECUTION_MODE === "queue" || CRAWL_QUEUE_FALLBACK_MS <= 0) return;

  setTimeout(() => {
    void (async () => {
      const status = await getCrawlStatus(jobId);
      if (!status || status.status !== "queued") return;

      const removed = await removeWaitingQueueJob(jobId);
      if (!removed) return;

      logger.warn({ jobId }, "BullMQ did not pick up crawl in time; running in-process fallback");
      dispatchLocalCrawl(jobId, req);
    })().catch((err: any) => {
      logger.warn({ jobId, err: err.message }, "Queued crawl fallback check failed");
    });
  }, CRAWL_QUEUE_FALLBACK_MS).unref();
}

// ── Job Status Management (Redis) ────────────────────────────

const JOB_KEY_PREFIX = "spidercrawl:job:";

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Strips large fields from a PageResult to create a lightweight summary.
 */
function toSummary(result: PageResult): PageResult {
  return {
    url: result.url,
    title: result.title,
    statusCode: result.statusCode,
    metadata: {
      crawledAt: result.metadata.crawledAt,
      elapsedMs: result.metadata.elapsedMs,
    },
    // We keep these small counts/flags for the dashboard
    unchanged: result.unchanged,
    links: [], // summaries don't need full links
    extractedData: result.extractedData ? { __present: true } as any : undefined,
  };
}

async function saveJobStatus(job: JobStatus): Promise<void> {
  const redis = getRedis();
  
  // Clone to avoid mutating the original object in the worker's memory
  const sanitized = { 
    ...job, 
    results: job.results.map(toSummary) 
  };
  
  try {
    await withTimeout(
      redis.set(`${JOB_KEY_PREFIX}${job.id}`, JSON.stringify(sanitized), "EX", 604800),
      800,
      `Redis set for job ${job.id}`,
    );
  } catch (err: any) {
    logger.warn({ err: err.message, jobId: job.id }, "Skipping Redis job-status cache write");
  }
}

async function persistJobStatus(job: JobStatus): Promise<void> {
  await saveJobStatus(job);
  try {
    await updateJobStatus(job);
  } catch (err: any) {
    logger.warn({ err: err.message, jobId: job.id }, "Failed to persist job status to Postgres");
  }
}

async function markJobFailed(jobId: string, error: string): Promise<void> {
  const status = await getCrawlStatus(jobId);
  if (status) {
    status.status = "failed";
    status.error = error;
    status.updatedAt = new Date().toISOString();
    await persistJobStatus(status);
    await deliverJobWebhooks("job.failed", status, status.orgId);
    return;
  }

  const record = await getJobRecord(jobId);
  if (!record) return;

  const reconstructed: JobStatus = {
    id: record.id,
    rootUrl: record.root_url,
    goal: record.goal ?? undefined,
    maxDepth: record.max_depth,
    maxPages: record.max_pages,
    status: "failed",
    progress: record.progress ?? 0,
    totalPages: record.total_pages ?? 0,
    completedPages: record.completed_pages ?? 0,
    results: [],
    error,
    createdAt: new Date(record.created_at).toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await persistJobStatus(reconstructed);
  await deliverJobWebhooks("job.failed", reconstructed, reconstructed.orgId);
}

export async function getCrawlStatus(jobId: string): Promise<JobStatus | null> {
  // 1. Fast path: Redis cache hit (contains summaries)
  try {
    const redis = getRedis();
    const data = await withTimeout(
      redis.get(`${JOB_KEY_PREFIX}${jobId}`),
      800,
      `Redis get for job ${jobId}`,
    );
    if (data) return JSON.parse(data) as JobStatus;
  } catch (err: any) {
    logger.warn({ err: err.message, jobId }, "Redis job-status lookup failed; falling back to PostgreSQL");
  }

  // 2. Redis miss — reconstruct from PostgreSQL
  if (!isDbEnabled()) return null;
  return reconstructJobFromDb(jobId);
}

/**
 * Rebuilds a JobStatus from PostgreSQL rows when Redis doesn't have it.
 * Fetches page summaries rather than full content to avoid OOM.
 */
async function reconstructJobFromDb(jobId: string): Promise<JobStatus | null> {
  const jobRecord = await getJobRecord(jobId);
  if (!jobRecord) return null;

  logger.info({ jobId }, "Reconstructing job status from PostgreSQL (Redis miss)");

  const pages = await getJobPages(jobId);
  const requestConfig = jobRecord.request as CrawlRequest | undefined;
  const jobStatus: JobStatus = {
    id: jobRecord.id,
    orgId: jobRecord.org_id,
    rootUrl: jobRecord.root_url,
    goal: jobRecord.goal ?? undefined,
    maxDepth: jobRecord.max_depth,
    maxPages: jobRecord.max_pages,
    status: jobRecord.status,
    progress: jobRecord.progress,
    totalPages: jobRecord.total_pages,
    completedPages: jobRecord.completed_pages,
    error: jobRecord.error ?? undefined,
    results: pages.map(p => ({
      url: p.url,
      title: p.title,
      statusCode: p.status_code,
      metadata: {
        crawledAt: new Date(p.crawled_at).toISOString(),
        elapsedMs: (p.metadata as any)?.elapsedMs ?? 0,
      },
      links: [],
    })),
    createdAt: new Date(jobRecord.created_at).toISOString(),
    updatedAt: new Date(jobRecord.updated_at).toISOString(),
    satisfactionScore: jobRecord.satisfaction_score ?? undefined,
    changedPages: jobRecord.changed_pages ?? undefined,
    skippedPages: jobRecord.skipped_pages ?? undefined,
    extractionPrompt: requestConfig?.extractionPrompt,
    extractionSchema: requestConfig?.extractionSchema,
    enableEntities: requestConfig?.enableEntities,
    adaptiveBudget: requestConfig?.adaptiveBudget,
    satisfactionThreshold: requestConfig?.satisfactionThreshold,
  };

  // Re-warm Redis
  await saveJobStatus(jobStatus);
  return jobStatus;
}

export async function listRecentJobs(orgId?: string): Promise<JobStatus[]> {
  if (isDbEnabled()) {
    try {
      const rows = await listJobs(100, orgId);
      return rows.map((row) => ({
        id: row.id,
        rootUrl: row.root_url,
        goal: row.goal ?? undefined,
        maxDepth: row.max_depth ?? 3,
        maxPages: row.max_pages ?? 50,
        status: row.status,
        progress: row.progress ?? 0,
        totalPages: row.total_pages ?? 0,
        completedPages: row.completed_pages ?? 0,
        error: row.error ?? undefined,
        results: [],
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
        satisfactionScore: row.satisfaction_score ?? undefined,
        changedPages: row.changed_pages ?? undefined,
        skippedPages: row.skipped_pages ?? undefined,
      }));
    } catch (err: any) {
      logger.warn({ err: err.message }, "DB listJobs failed; falling back to Redis scan");
    }
  }

  const redis = getRedis();
  let cursor = "0";
  const keys: string[] = [];
  do {
    const [nextCursor, foundKeys] = await redis.scan(cursor, "MATCH", `${JOB_KEY_PREFIX}*`, "COUNT", 100);
    cursor = nextCursor;
    keys.push(...foundKeys);
  } while (cursor !== "0");

  const jobs: JobStatus[] = [];
  for (const key of keys) {
    const data = await redis.get(key);
    if (data) jobs.push(JSON.parse(data) as JobStatus);
  }

  if (jobs.length === 0) {
    // If Redis is empty (e.g. restart), fallback to DB
    const rows = await listJobs(100, orgId);
    return rows.map((r: any) => ({
      id: r.id,
      rootUrl: r.root_url,
      status: r.status,
      progress: r.progress,
      totalPages: r.total_pages,
      completedPages: r.completed_pages,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }) as JobStatus);
  }

  return jobs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export async function reconcileStaleQueuedJobs(): Promise<number> {
  if (!isDbEnabled()) return 0;

  const staleMs = readIntegerEnv("STALE_QUEUED_JOB_MS", DEFAULT_STALE_QUEUED_JOB_MS, { min: 0 });
  if (staleMs <= 0) return 0;

  let rows: any[];
  try {
    rows = await listJobs(500);
  } catch (err: any) {
    logger.warn({ err: err.message }, "Unable to scan queued jobs for reconciliation");
    return 0;
  }

  let reconciled = 0;
  const now = Date.now();

  for (const row of rows) {
    if (row.status !== "queued") continue;

    const updatedAt = new Date(row.updated_at).getTime();
    if (!Number.isFinite(updatedAt) || now - updatedAt < staleMs) continue;

    let queueState: string | null = null;
    try {
      const queueJob = await getQueue().getJob(row.id);
      queueState = queueJob ? await queueJob.getState() : null;
    } catch (err: any) {
      logger.debug({ jobId: row.id, err: err.message }, "Unable to inspect BullMQ job during reconciliation");
    }

    if (queueState && ["waiting", "delayed", "prioritized", "active"].includes(queueState)) {
      continue;
    }

    const failedStatus: JobStatus = {
      id: row.id,
      orgId: row.org_id ?? undefined,
      rootUrl: row.root_url,
      goal: row.goal ?? undefined,
      maxDepth: row.max_depth ?? 3,
      maxPages: row.max_pages ?? 50,
      status: "failed",
      progress: 100,
      totalPages: row.total_pages ?? 0,
      completedPages: row.completed_pages ?? 0,
      results: [],
      error: "Crawl job was queued but no worker picked it up. Retry the job to run it again.",
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date().toISOString(),
      changedPages: row.changed_pages ?? undefined,
      skippedPages: row.skipped_pages ?? undefined,
      satisfactionScore: row.satisfaction_score ?? undefined,
    };

    await persistJobStatus(failedStatus);
    reconciled++;
  }

  if (reconciled > 0) {
    logger.warn({ reconciled }, "Reconciled stale queued crawl jobs");
  }

  return reconciled;
}

// ── Public API ───────────────────────────────────────────────

export async function startCrawl(jobId: string, req: CrawlRequest, orgId?: string): Promise<void> {
  const jobStatus: JobStatus = {
    id: jobId,
    rootUrl: req.url,
    goal: req.goal,
    maxDepth: req.maxDepth,
    maxPages: req.maxPages,
    status: "queued",
    progress: 0,
    totalPages: 0,
    completedPages: 0,
    results: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    extractionPrompt: req.extractionPrompt,
    extractionSchema: req.extractionSchema,
    enableEntities: req.enableEntities,
    adaptiveBudget: req.adaptiveBudget,
    satisfactionThreshold: req.satisfactionThreshold,
  };

  if (orgId) {
    (jobStatus as any).orgId = orgId;
  }

  await saveJobStatus(jobStatus);
  try {
    await upsertJob(jobStatus, req);
  } catch (err: any) {
    logger.warn({ err: err.message, jobId }, "Failed to persist job to Postgres");
  }

  if (CRAWL_EXECUTION_MODE === "inline") {
    logger.info({ jobId, url: req.url }, "Running crawl in-process (CRAWL_EXECUTION_MODE=inline)");
    dispatchLocalCrawl(jobId, req);
    return;
  }

  try {
    const queue = getQueue();
    await withTimeout(
      queue.add("crawl", { jobId, req }, { jobId }),
      1200,
      `BullMQ enqueue for job ${jobId}`,
    );
    logger.info({ jobId, url: req.url }, "Enqueued crawl job in BullMQ");
    scheduleQueueFallback(jobId, req);
  } catch (err: any) {
    logger.warn({ jobId, err: err.message }, "BullMQ unavailable; running crawl in-process");
    dispatchLocalCrawl(jobId, req);
  }
}

// ── Schedule Integration ─────────────────────────────────────

/**
 * Enqueues a repeatable job in BullMQ for a schedule.
 */
export async function scheduleCrawlJob(schedule: Schedule): Promise<void> {
  if (!schedule.active) return;
  const queue = getQueue();
  
  const repeatId = `schedule:${schedule.id}`;
  
  // We use the schedule ID as the job name to make it repeatable
  await withTimeout(
    queue.add(
      "crawl", 
      { 
        jobId: `sc-${nanoid(10)}`, // Generate a new job ID for this run
        req: {
          url: schedule.url,
          goal: schedule.goal,
          maxDepth: schedule.maxDepth,
          maxPages: schedule.maxPages,
          extractionSchema: schedule.extractionSchema,
          extractionPrompt: schedule.extractionPrompt,
          adaptiveBudget: schedule.adaptiveBudget,
          satisfactionThreshold: schedule.satisfactionThreshold,
        } as CrawlRequest,
        scheduleId: schedule.id, // Track that this came from a schedule
      },
      {
        repeat: {
          pattern: schedule.cron,
          jobId: repeatId,
        }
      }
    ),
    1200,
    `BullMQ schedule registration for ${schedule.id}`,
  );
  
  logger.info({ scheduleId: schedule.id, cron: schedule.cron }, "Registered repeatable job in BullMQ");
}

/**
 * Removes a repeatable job from BullMQ.
 */
export async function unscheduleCrawlJob(scheduleId: string, cron: string): Promise<void> {
  const queue = getQueue();
  await withTimeout(
    queue.removeRepeatable("crawl", {
      pattern: cron,
      jobId: `schedule:${scheduleId}`,
    }),
    1200,
    `BullMQ schedule removal for ${scheduleId}`,
  );
  logger.info({ scheduleId }, "Removed repeatable job from BullMQ");
}

/**
 * Synchronizes all active schedules from Postgres with BullMQ on startup.
 */
export async function syncSchedulesWithQueue(): Promise<void> {
  if (!isDbEnabled()) return;
  
  logger.info("Synchronizing active schedules with BullMQ queue...");
  const schedules = await listSchedules();
  
  const activeSchedules = schedules.filter(s => s.active);
  for (const s of activeSchedules) {
    await scheduleCrawlJob(s);
  }
  
  logger.info({ count: activeSchedules.length }, "Schedules synchronized");
}

// ── Worker Initialization ────────────────────────────────────

export function startOrchestratorWorker(): void {
  if (crawlWorker) return;

  crawlWorker = new Worker(
    CRAWL_QUEUE_NAME,
    async (job: Job) => {
      const { jobId, req, scheduleId } = job.data as { jobId: string; req: CrawlRequest; scheduleId?: string };
      
      // If this is a scheduled run, update the schedule's last/next run info
      if (scheduleId && isDbEnabled()) {
        try {
          const schedule = await getSchedule(scheduleId);
          if (schedule) {
            const interval = (parseExpression as any).parseExpression(schedule.cron);
            const nextRunAt = interval.next().toDate();
            await updateScheduleLastRun(scheduleId, new Date(), nextRunAt);
          }
        } catch (e: any) {
          logger.warn({ scheduleId, err: e.message }, "Failed to update schedule next run info");
          await updateScheduleLastRun(scheduleId, new Date(), new Date(Date.now() + 86400000));
        }
      }
      
      await runCrawl(jobId, req);
    },
    {
      connection: createBullRedis(),
      concurrency: 5,
    }
  );

  crawlWorker.on("completed", (job) => {
    logger.info({ jobId: job.id }, "BullMQ crawl job completed");
  });

  crawlWorker.on("failed", async (job, err) => {
    logger.error({ jobId: job?.id, err: err.message }, "BullMQ crawl job failed");
    const crawlJobId = (job?.data as { jobId?: string } | undefined)?.jobId ?? job?.id;
    if (crawlJobId) {
      await markJobFailed(crawlJobId, err.message);
    }
  });

  crawlWorker.on("error", (err) => {
    logger.error({ err: err.message }, "BullMQ crawl worker error");
  });

  void crawlWorker.waitUntilReady()
    .then(() => logger.info("BullMQ crawl worker ready"))
    .catch((err: any) => logger.error({ err: err.message }, "BullMQ crawl worker failed to become ready"));

  logger.info("Started BullMQ crawl worker");
}

// ── Internal crawl loop ──────────────────────────────────────

interface QueueItem {
  url: string;
  title: string;
  depth: number;
  score: number;
}

function fireEvent(jobId: string, type: Parameters<typeof emitCrawlEvent>[0]["type"], url: string | null, data: Record<string, unknown>): void {
  const event = { type, jobId, url: url ?? undefined, data, ts: new Date().toISOString() };
  emitCrawlEvent(event);
  // Persist to DB asynchronously — never block the crawl loop
  insertCrawlEvent(jobId, type, url, data).catch(() => {});
}

async function runCrawl(jobId: string, req: CrawlRequest): Promise<void> {
  const job = await getCrawlStatus(jobId);
  if (!job) throw new Error(`Job status not found for ${jobId}`);
  let failedPages = 0;

  job.status = "processing";
  job.updatedAt = new Date().toISOString();
  await persistJobStatus(job);

  fireEvent(jobId, "job.started", null, { url: req.url, maxPages: req.maxPages, goal: req.goal ?? null });

  const visited = new Set<string>();
  try {
    const dbVisited = await getVisitedUrls(jobId);
    if (dbVisited.size > 0) {
      dbVisited.forEach((url) => visited.add(url));
    }
  } catch (err: any) {
    logger.warn({ err: err.message, jobId }, "Failed to seed visited set from DB");
  }

  const previousHashes = new Map<string, string>();
  if (req.rerunJobId) {
    try {
      const hashes = await getPageHashes(req.rerunJobId);
      hashes.forEach((hash, url) => previousHashes.set(url, hash));
    } catch (err: any) {
      logger.warn({ err: err.message, jobId }, "Failed to load previous hashes");
    }
  }

  const queue: QueueItem[] = [{ url: req.url, title: "Root", depth: 0, score: 1.0 }];
  const rootOrigin = new URL(req.url).origin;
  const isGoalOriented = !!req.goal;
  
  const recentScores: number[] = [];
  const SATISFACTION_WINDOW = 5;

  while (queue.length > 0 && job.completedPages < req.maxPages) {
    if (isGoalOriented) {
      queue.sort((a, b) => b.score - a.score);
    }

    const item = queue.shift()!;
    if (visited.has(item.url) || item.depth > req.maxDepth) continue;
    visited.add(item.url);

    // Adaptive Budget
    if (isGoalOriented && req.adaptiveBudget && item.url !== req.url) {
      recentScores.push(item.score);
      if (recentScores.length > SATISFACTION_WINDOW) recentScores.shift();
      if (recentScores.length === SATISFACTION_WINDOW) {
        const avgScore = recentScores.reduce((a, b) => a + b, 0) / SATISFACTION_WINDOW;
        job.satisfactionScore = avgScore;
        if (avgScore < (req.satisfactionThreshold ?? 0.3)) {
          logger.info({ jobId, avgScore }, "Adaptive budget reached; stopping early");
          break;
        }
      }
    }

    // Patterns
    if (req.includePatterns?.length) {
      if (!req.includePatterns.some((p) => new RegExp(p).test(item.url))) continue;
    }
    if (req.excludePatterns?.length) {
      if (req.excludePatterns.some((p) => new RegExp(p).test(item.url))) continue;
    }

    try {
      let result = await scrapePage({
        url: item.url,
        formats: req.formats,
        enableVision: false,
        useBrowser: false,
        extractSchema: req.extractionSchema,
        extractPrompt: req.extractionPrompt,
        waitFor: req.waitFor,
        timeout: Math.min(req.timeout, 30_000),
        previousHash: previousHashes.get(item.url),
      });

      if (result.unchanged && req.rerunJobId) {
        job.skippedPages = (job.skippedPages ?? 0) + 1;
        fireEvent(jobId, "page.skipped", item.url, { depth: item.depth, reason: "unchanged" });
        const oldData = await getOldPageResult(req.rerunJobId, item.url);
        if (oldData) {
          oldData.metadata.elapsedMs = result.metadata.elapsedMs;
          result = oldData;
        }
      } else {
        job.changedPages = (job.changedPages ?? 0) + 1;
      }

      const entityType = detectEntityType(result);
      const jsonld = buildPageJsonLd(result, entityType);

      // Store summary in memory (worker memory + Redis)
      job.results.push(toSummary(result));
      job.completedPages++;
      job.totalPages = visited.size;
      job.progress = Math.round((job.completedPages / Math.min(req.maxPages, visited.size + queue.length)) * 100);
      if (result.extractedData) job.extractedCount = (job.extractedCount ?? 0) + 1;
      job.updatedAt = new Date().toISOString();

      fireEvent(jobId, "page.crawled", item.url, {
        title: result.title,
        statusCode: result.statusCode,
        depth: item.depth,
        elapsedMs: result.metadata.elapsedMs,
        hasExtracted: !!result.extractedData,
        linksFound: result.links?.length ?? 0,
        unchanged: result.unchanged ?? false,
        completedPages: job.completedPages,
        progress: job.progress,
      });

      await saveJobStatus(job);
      
      // Persist full content to Postgres
      try {
        await insertPage(jobId, item.depth, result, jsonld, entityType, result.contentHash);
        await updateJobStatus(job);
      } catch (err: any) {
        logger.warn({ err: err.message, jobId }, "Failed to persist page to Postgres");
      }

      // Incremental entity resolution (runs per page when enabled).
      if (req.enableEntities && isAIAvailable()) {
        resolveEntitiesForPage(jobId, { url: result.url, markdown: result.markdown, html: result.html })
          .then((entityRes) => {
            if (entityRes.found > 0) {
              fireEvent(jobId, "job.progress", result.url, {
                entityFound: entityRes.found,
                entityUpserted: entityRes.upserted,
              });
            }
          })
          .catch((err: any) => {
            logger.warn({ jobId, url: result.url, err: err.message }, "Incremental entity resolution failed");
          });
      }

      // Link Discovery
      const newLinks: { url: string; title: string }[] = [];
      for (const link of result.links || []) {
        try {
          if (new URL(link).origin === rootOrigin && !visited.has(link)) {
            newLinks.push({ url: link, title: "" });
          }
        } catch {}
      }

      if (newLinks.length > 0 && isGoalOriented && req.goal) {
        try {
          const scored = await scoreLinks(newLinks, req.goal, result.markdown?.slice(0, 500));
          const relevant = filterByRelevance(scored, 0.25);
          for (const s of relevant) {
            if (!visited.has(s.url)) queue.push({ url: s.url, title: s.title, depth: item.depth + 1, score: s.score });
          }
        } catch {
          for (const link of newLinks) queue.push({ url: link.url, title: link.title, depth: item.depth + 1, score: 0.5 });
        }
      } else {
        for (const link of newLinks) queue.push({ url: link.url, title: link.title, depth: item.depth + 1, score: 0.5 });
      }

      await delay(CRAWL_PAGE_DELAY_MS);
    } catch (err: any) {
      failedPages++;
      logger.warn({ url: item.url, err: err.message }, "Crawl: page failed");
      fireEvent(jobId, "page.failed", item.url, { error: err.message, depth: item.depth });
    }
  }

  if (job.completedPages === 0 && failedPages > 0) {
    job.status = "failed";
    job.error = `All ${failedPages} page fetches failed`;
  } else {
    job.status = "completed";
    if (failedPages > 0) job.error = `${failedPages} page fetches failed`;
  }
  job.progress = 100;
  job.updatedAt = new Date().toISOString();
  await persistJobStatus(job);

  fireEvent(jobId, job.status === "completed" ? "job.completed" : "job.failed", null, {
    completedPages: job.completedPages,
    failedPages,
    satisfactionScore: job.satisfactionScore ?? null,
    error: job.error ?? null,
  });

  if (job.status === "completed" && job.completedPages > 0 && isAIAvailable() && req.enableEntities) {
    try {
      // Safety reconciliation pass to fill any missed entities from transient errors.
      const entityResult = await resolveEntities(jobId, undefined, 2);
      logger.info({ jobId, found: entityResult.entitiesFound }, "Entity reconciliation pass finished");
    } catch (err: any) {
      logger.warn({ jobId, err: err.message }, "Entity resolution failed");
    }
  }

  await deliverJobWebhooks(job.status === "completed" ? "job.completed" : "job.failed", job, job.orgId);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function deleteJobStatus(jobId: string): Promise<void> {
  const redis = getRedis();
  await redis.del(`${JOB_KEY_PREFIX}${jobId}`);
}

export async function exportJobCsv(jobId: string): Promise<string> {
  // For export, we fetch full data from DB
  const pages = await getJobPagesWithContent(jobId);
  let csv = "url,title,status_code,crawled_at\n";
  for (const p of pages) {
    csv += `${p.url},"${p.title.replace(/"/g, '""')}",${p.statusCode},"${p.metadata.crawledAt}"\n`;
  }
  return csv;
}

export async function exportJobJson(jobId: string): Promise<JobStatus> {
  const status = await getCrawlStatus(jobId);
  if (!status) throw new Error("Job not found");
  status.results = await getJobPagesWithContent(jobId);
  return status;
}

export async function exportJobJsonl(jobId: string): Promise<string> {
  const status = await exportJobJson(jobId);
  const { jobToJsonl } = await import("../export/jsonl.js");
  return jobToJsonl(status);
}

export async function exportJobFineTuneJsonl(jobId: string): Promise<string> {
  const status = await exportJobJson(jobId);
  const { jobToFineTuneJsonl } = await import("../export/jsonl.js");
  return jobToFineTuneJsonl(status);
}

export async function retryJob(jobId: string, orgId?: string): Promise<string> {
  const req = await getJobRequest(jobId);
  if (!req) throw new Error("Job request not found in database");

  const newJobId = nanoid();
  await startCrawl(
    newJobId,
    {
      ...req,
      rerunJobId: req.rerunJobId ?? jobId,
    },
    orgId,
  );

  return newJobId;
}
