import { getDb, isDbEnabled } from "./db.js";
import { logger } from "./logger.js";
import type { CrawlRequest, JobStatus, PageResult, Entity } from "../types/schemas.js";

export async function upsertJob(job: JobStatus, req: CrawlRequest): Promise<void> {
  if (!isDbEnabled()) return;
  const db = getDb();
  await db.query(
    `INSERT INTO jobs (id, root_url, status, goal, max_depth, max_pages,
                       total_pages, completed_pages, progress, error, request,
                       created_at, updated_at, satisfaction_score, changed_pages, skipped_pages, org_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (id) DO UPDATE SET
       status=EXCLUDED.status,
       total_pages=EXCLUDED.total_pages,
       completed_pages=EXCLUDED.completed_pages,
       changed_pages=EXCLUDED.changed_pages,
       skipped_pages=EXCLUDED.skipped_pages,
       progress=EXCLUDED.progress,
       error=EXCLUDED.error,
       updated_at=EXCLUDED.updated_at,
       satisfaction_score=EXCLUDED.satisfaction_score`,
    [
      job.id,
      req.url,
      job.status,
      req.goal ?? null,
      req.maxDepth,
      req.maxPages,
      job.totalPages,
      job.completedPages,
      job.progress,
      job.error ?? null,
      JSON.stringify(req),
      job.createdAt,
      job.updatedAt,
      job.satisfactionScore ?? null,
      job.changedPages ?? null,
      job.skippedPages ?? null,
      (job as any).orgId ?? null,
    ]
  );
}

export async function updateJobStatus(job: JobStatus): Promise<void> {
  if (!isDbEnabled()) return;
  const db = getDb();
  await db.query(
    `UPDATE jobs SET status=$2, total_pages=$3, completed_pages=$4,
                     changed_pages=$5, skipped_pages=$6, progress=$7, error=$8,
                     updated_at=$9, satisfaction_score=$10
     WHERE id=$1`,
    [
      job.id,
      job.status,
      job.totalPages,
      job.completedPages,
      job.changedPages ?? null,
      job.skippedPages ?? null,
      job.progress,
      job.error ?? null,
      job.updatedAt,
      job.satisfactionScore ?? null,
    ]
  );
}

export async function insertPage(
  jobId: string,
  depth: number,
  page: PageResult,
  jsonld?: Record<string, unknown>,
  entityType?: string,
  contentHash?: string
): Promise<string | null> {
  if (!isDbEnabled()) return null;
  const db = getDb();
  const pageJson = page.json ?? (page.tables ? { tables: page.tables } : null);
  
  // Use ON CONFLICT to prevent duplicates if the same URL is crawled twice in a job
  const res = await db.query<{ id: string }>(
    `INSERT INTO pages (job_id, url, title, status_code, depth, markdown, html,
                        json_data, extracted_data, image_descriptions, links, metadata,
                        jsonld, entity_type, content_hash, crawled_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (job_id, url) DO UPDATE SET
       title = EXCLUDED.title,
       status_code = EXCLUDED.status_code,
       markdown = EXCLUDED.markdown,
       html = EXCLUDED.html,
       json_data = EXCLUDED.json_data,
       extracted_data = EXCLUDED.extracted_data,
       image_descriptions = EXCLUDED.image_descriptions,
       links = EXCLUDED.links,
       metadata = EXCLUDED.metadata,
       jsonld = EXCLUDED.jsonld,
       entity_type = EXCLUDED.entity_type,
       content_hash = EXCLUDED.content_hash,
       crawled_at = EXCLUDED.crawled_at
     RETURNING id`,
    [
      jobId,
      page.url,
      page.title,
      page.statusCode,
      depth,
      page.markdown ?? null,
      page.html ?? null,
      pageJson ? JSON.stringify(pageJson) : null,
      page.extractedData ? JSON.stringify(page.extractedData) : null,
      page.imageDescriptions ? JSON.stringify(page.imageDescriptions) : null,
      JSON.stringify(page.links),
      JSON.stringify(page.metadata),
      jsonld ? JSON.stringify(jsonld) : null,
      entityType ?? null,
      contentHash ?? null,
      page.metadata.crawledAt,
    ]
  );
  const pageId = res.rows[0]?.id ?? null;
  if (pageId && page.links.length) {
    const values = page.links.map((_, i) => `($1, $${i + 2})`).join(",");
    try {
      await db.query(
        `INSERT INTO page_links (from_page_id, to_url) VALUES ${values}
         ON CONFLICT DO NOTHING`,
        [pageId, ...page.links]
      );
    } catch (err: any) {
      logger.warn({ err: err.message, pageId }, "Failed to insert page_links");
    }
  }
  return pageId;
}

export async function listJobs(limit = 50, orgId?: string): Promise<any[]> {
  if (!isDbEnabled()) return [];
  const db = getDb();
  let query = `SELECT id, root_url, status, goal, total_pages, completed_pages,
                      changed_pages, skipped_pages, progress, error, created_at, updated_at, satisfaction_score,
                      max_depth, max_pages
               FROM jobs`;
  const params: any[] = [limit];
  
  if (orgId) {
    query += " WHERE org_id = $2";
    params.push(orgId);
  }
  
  query += " ORDER BY created_at DESC LIMIT $1";
  
  const res = await db.query(query, params);
  return res.rows;
}

/**
 * Returns a summary of pages for a job (no markdown/html/full tables).
 * Used for dashboard feed to save bandwidth.
 */
export async function getJobPages(jobId: string, limit = 1000): Promise<any[]> {
  if (!isDbEnabled()) return [];
  const db = getDb();
  const res = await db.query(
    `SELECT id, url, title, status_code, depth, entity_type, 
            metadata, crawled_at,
            (CASE WHEN json_data->'tables' IS NOT NULL THEN jsonb_array_length(json_data->'tables') ELSE 0 END) as table_count,
            substring(markdown from 1 for 500) as markdown_preview
     FROM pages 
     WHERE job_id=$1 
     ORDER BY crawled_at ASC 
     LIMIT $2`,
    [jobId, limit]
  );
  return res.rows;
}

/**
 * Fetches a single page with full content.
 */
export async function getPageDetail(jobId: string, url: string): Promise<any | null> {
  if (!isDbEnabled()) return null;
  const db = getDb();
  const res = await db.query(
    `SELECT * FROM pages WHERE job_id=$1 AND url=$2 LIMIT 1`,
    [jobId, url]
  );
  return res.rows[0] ?? null;
}

export async function getPageLinks(jobId: string): Promise<{ from: string; to: string }[]> {
  if (!isDbEnabled()) return [];
  const db = getDb();
  const res = await db.query<{ from: string; to: string }>(
    `SELECT p.url AS from, pl.to_url AS to
     FROM page_links pl
     JOIN pages p ON p.id = pl.from_page_id
     WHERE p.job_id = $1`,
    [jobId]
  );
  return res.rows;
}

export async function getJobRecord(jobId: string): Promise<any | null> {
  if (!isDbEnabled()) return null;
  const db = getDb();
  const res = await db.query(
    `SELECT * FROM jobs WHERE id=$1`,
    [jobId]
  );
  return res.rows[0] ?? null;
}

export async function deleteJobRecord(jobId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = getDb();
  await db.query(`DELETE FROM jobs WHERE id=$1`, [jobId]);
}

export async function getJobRequest(jobId: string): Promise<CrawlRequest | null> {
  if (!isDbEnabled()) return null;
  const db = getDb();
  const res = await db.query(`SELECT request FROM jobs WHERE id=$1`, [jobId]);
  if (!res.rows[0]) return null;
  return res.rows[0].request as CrawlRequest;
}

/**
 * Returns url→hash map for all pages of a job.
 * Used by incremental re-crawl to skip unchanged pages.
 */
export async function getPageHashes(jobId: string): Promise<Map<string, string>> {
  if (!isDbEnabled()) return new Map();
  const db = getDb();
  const res = await db.query<{ url: string; content_hash: string }>(
    `SELECT url, content_hash FROM pages WHERE job_id=$1 AND content_hash IS NOT NULL`,
    [jobId]
  );
  return new Map(res.rows.map((r) => [r.url, r.content_hash]));
}

// ── Entity store (Phase 1.4) ─────────────────────────────────────

export async function upsertEntity(
  jobId: string,
  entity: Omit<Entity, "id" | "jobId" | "createdAt">
): Promise<string | null> {
  if (!isDbEnabled()) return null;
  const db = getDb();

  const res = await db.query<{ id: string }>(
    `INSERT INTO entities (job_id, name, type, description, aliases, source_urls, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (job_id, name, type) DO UPDATE SET
       aliases = (
         SELECT jsonb_agg(DISTINCT x)
         FROM jsonb_array_elements(entities.aliases || EXCLUDED.aliases) AS x
       ),
       source_urls = (
         SELECT jsonb_agg(DISTINCT x)
         FROM jsonb_array_elements(entities.source_urls || EXCLUDED.source_urls) AS x
       ),
       description = COALESCE(EXCLUDED.description, entities.description),
       metadata = entities.metadata || EXCLUDED.metadata
     RETURNING id`,
    [
      jobId,
      entity.name,
      entity.type,
      entity.description ?? null,
      JSON.stringify(entity.aliases),
      JSON.stringify(entity.sourceUrls),
      JSON.stringify(entity.metadata),
    ]
  );

  return res.rows[0]?.id ?? null;
}

export async function getEntities(jobId: string, type?: string): Promise<Entity[]> {
  if (!isDbEnabled()) return [];
  const db = getDb();
  const res = await db.query(
    type
      ? `SELECT * FROM entities WHERE job_id=$1 AND type=$2 ORDER BY name`
      : `SELECT * FROM entities WHERE job_id=$1 ORDER BY type, name`,
    type ? [jobId, type] : [jobId]
  );
  return res.rows.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    name: row.name,
    type: row.type,
    description: row.description ?? undefined,
    aliases: row.aliases ?? [],
    sourceUrls: row.source_urls ?? [],
    metadata: row.metadata ?? {},
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function deleteEntities(jobId: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = getDb();
  await db.query(`DELETE FROM entities WHERE job_id=$1`, [jobId]);
}

/**
 * Returns all crawled pages for a job with their full content,
 * reconstructed as PageResult objects. Used for DB-based job recovery.
 */
export async function getJobPagesWithContent(jobId: string): Promise<PageResult[]> {
  if (!isDbEnabled()) return [];
  const db = getDb();
  const res = await db.query(
    `SELECT url, title, status_code, markdown, html, json_data,
            extracted_data, image_descriptions, links, metadata, crawled_at
     FROM pages WHERE job_id=$1 ORDER BY crawled_at ASC`,
    [jobId]
  );
  return res.rows.map((row) => {
    const jsonData = row.json_data
      ? (typeof row.json_data === "object" ? row.json_data : JSON.parse(row.json_data))
      : undefined;

    return {
      ...(jsonData && typeof jsonData === "object" ? { tables: (jsonData as any).tables ?? undefined } : {}),
      url: row.url,
      statusCode: row.status_code ?? 200,
      title: row.title ?? "",
      markdown: row.markdown ?? undefined,
      html: row.html ?? undefined,
      json: jsonData,
      links: Array.isArray(row.links) ? row.links : (row.links ? JSON.parse(row.links) : []),
      extractedData: row.extracted_data ?? undefined,
      imageDescriptions: row.image_descriptions ?? undefined,
      metadata: row.metadata
        ? (typeof row.metadata === "object" ? row.metadata : JSON.parse(row.metadata))
        : { crawledAt: row.crawled_at?.toISOString() ?? new Date().toISOString(), elapsedMs: 0 },
    };
  });
}

/**
 * Fetches a single page's full content from a previous job.
 * Used for incremental re-crawls to copy unchanged pages without re-extracting.
 */
export async function getOldPageResult(jobId: string, url: string): Promise<PageResult | null> {
  if (!isDbEnabled()) return null;
  const db = getDb();
  const res = await db.query(
    `SELECT url, title, status_code, markdown, html, json_data,
            extracted_data, image_descriptions, links, metadata, crawled_at
     FROM pages WHERE job_id=$1 AND url=$2 LIMIT 1`,
    [jobId, url]
  );
  if (res.rows.length === 0) return null;
  
  const row = res.rows[0];
  const jsonData = row.json_data
    ? (typeof row.json_data === "object" ? row.json_data : JSON.parse(row.json_data))
    : undefined;

  return {
    ...(jsonData && typeof jsonData === "object" ? { tables: (jsonData as any).tables ?? undefined } : {}),
    url: row.url,
    statusCode: row.status_code ?? 200,
    title: row.title ?? "",
    markdown: row.markdown ?? undefined,
    html: row.html ?? undefined,
    json: jsonData,
    links: Array.isArray(row.links) ? row.links : (row.links ? JSON.parse(row.links) : []),
    extractedData: row.extracted_data ?? undefined,
    imageDescriptions: row.image_descriptions ?? undefined,
    metadata: row.metadata
      ? (typeof row.metadata === "object" ? row.metadata : JSON.parse(row.metadata))
      : { crawledAt: row.crawled_at?.toISOString() ?? new Date().toISOString(), elapsedMs: 0 },
  };
}

/**
 * Returns the set of URLs already crawled for a job.
 * Used to seed the BFS visited set on job resume/restart.
 */
// ── Crawl Event store (Phase C/D) ────────────────────────────────

export interface CrawlEventRow {
  id: string;
  jobId: string;
  eventType: string;
  url?: string;
  data: Record<string, unknown>;
  createdAt: string;
}

export async function insertCrawlEvent(
  jobId: string,
  eventType: string,
  url: string | null,
  data: Record<string, unknown>
): Promise<void> {
  if (!isDbEnabled()) return;
  const db = getDb();
  await db.query(
    `INSERT INTO crawl_events (job_id, event_type, url, data) VALUES ($1, $2, $3, $4)`,
    [jobId, eventType, url ?? null, JSON.stringify(data)]
  );
}

export async function getCrawlEvents(jobId: string, limit = 500): Promise<CrawlEventRow[]> {
  if (!isDbEnabled()) return [];
  const db = getDb();
  const res = await db.query(
    `SELECT id, job_id, event_type, url, data, created_at
     FROM crawl_events WHERE job_id = $1 ORDER BY created_at ASC LIMIT $2`,
    [jobId, limit]
  );
  return res.rows.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    eventType: row.event_type,
    url: row.url ?? undefined,
    data: typeof row.data === "object" ? row.data : JSON.parse(row.data ?? "{}"),
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function getRecentCrawlEvents(jobId: string, limit = 100): Promise<CrawlEventRow[]> {
  if (!isDbEnabled()) return [];
  const db = getDb();
  const safeLimit = Math.max(1, Math.min(limit, 1000));
  const res = await db.query(
    `SELECT id, job_id, event_type, url, data, created_at
     FROM (
       SELECT id, job_id, event_type, url, data, created_at
       FROM crawl_events
       WHERE job_id = $1
       ORDER BY created_at DESC
       LIMIT $2
     ) recent
     ORDER BY created_at ASC`,
    [jobId, safeLimit]
  );
  return res.rows.map((row) => ({
    id: row.id,
    jobId: row.job_id,
    eventType: row.event_type,
    url: row.url ?? undefined,
    data: typeof row.data === "object" ? row.data : JSON.parse(row.data ?? "{}"),
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function getJobExtractedData(
  jobId: string,
  limit = 50
): Promise<Array<{ url: string; title: string; data: Record<string, unknown> }>> {
  if (!isDbEnabled()) return [];
  const db = getDb();
  const res = await db.query(
    `SELECT url, title, extracted_data
     FROM pages
     WHERE job_id = $1 AND extracted_data IS NOT NULL
     ORDER BY crawled_at ASC
     LIMIT $2`,
    [jobId, limit]
  );
  return res.rows.map((r) => ({
    url: r.url,
    title: r.title ?? "",
    data: typeof r.extracted_data === "object" ? r.extracted_data : JSON.parse(r.extracted_data ?? "{}"),
  }));
}

export async function listPageContentForExtraction(
  jobId: string
): Promise<Array<{ url: string; markdown?: string; html?: string }>> {
  if (!isDbEnabled()) return [];
  const db = getDb();
  const res = await db.query(
    `SELECT url, markdown, html
     FROM pages
     WHERE job_id = $1
     ORDER BY crawled_at ASC`,
    [jobId]
  );
  return res.rows.map((r) => ({
    url: r.url,
    markdown: r.markdown ?? undefined,
    html: r.html ?? undefined,
  }));
}

export async function updatePageExtractedData(
  jobId: string,
  url: string,
  extractedData: Record<string, unknown>
): Promise<void> {
  if (!isDbEnabled()) return;
  const db = getDb();
  await db.query(
    `UPDATE pages
     SET extracted_data = $3
     WHERE job_id = $1 AND url = $2`,
    [jobId, url, JSON.stringify(extractedData)]
  );
}

export async function getJobSummary(jobId: string): Promise<string | null> {
  if (!isDbEnabled()) return null;
  const db = getDb();
  const res = await db.query(`SELECT summary FROM jobs WHERE id = $1`, [jobId]);
  return res.rows[0]?.summary ?? null;
}

export async function setJobSummary(jobId: string, summary: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = getDb();
  await db.query(`UPDATE jobs SET summary = $2 WHERE id = $1`, [jobId, summary]);
}

export async function getVisitedUrls(jobId: string): Promise<Set<string>> {
  if (!isDbEnabled()) return new Set();
  const db = getDb();
  const res = await db.query(`SELECT url FROM pages WHERE job_id=$1`, [jobId]);
  return new Set<string>(res.rows.map((r) => r.url as string));
}
