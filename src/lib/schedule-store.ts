import { getDb, isDbEnabled } from "./db.js";
import type { Schedule, ScheduleRequest } from "../types/schemas.js";

export async function listSchedules(orgId?: string): Promise<Schedule[]> {
  if (!isDbEnabled()) return [];
  const db = getDb();
  const res = await db.query(
    orgId 
      ? `SELECT * FROM schedules WHERE org_id=$1 ORDER BY created_at DESC`
      : `SELECT * FROM schedules ORDER BY created_at DESC`,
    orgId ? [orgId] : []
  );
  return res.rows.map(mapRowToSchedule);
}

export async function getSchedule(id: string): Promise<Schedule | null> {
  if (!isDbEnabled()) return null;
  const db = getDb();
  const res = await db.query(
    `SELECT * FROM schedules WHERE id=$1`,
    [id]
  );
  return res.rows[0] ? mapRowToSchedule(res.rows[0]) : null;
}

export async function upsertSchedule(req: ScheduleRequest & { orgId?: string }, id?: string): Promise<Schedule> {
  const db = getDb();
  const { crawlRequest, orgId } = req;

  const res = await db.query(
    `INSERT INTO schedules (
      id, name, url, goal, max_depth, max_pages, cron, 
      extraction_schema, extraction_prompt, adaptive_budget, 
      satisfaction_threshold, active, org_id
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      url = EXCLUDED.url,
      goal = EXCLUDED.goal,
      max_depth = EXCLUDED.max_depth,
      max_pages = EXCLUDED.max_pages,
      cron = EXCLUDED.cron,
      extraction_schema = EXCLUDED.extraction_schema,
      extraction_prompt = EXCLUDED.extraction_prompt,
      adaptive_budget = EXCLUDED.adaptive_budget,
      satisfaction_threshold = EXCLUDED.satisfaction_threshold,
      active = EXCLUDED.active,
      org_id = COALESCE(EXCLUDED.org_id, schedules.org_id),
      updated_at = CURRENT_TIMESTAMP
    RETURNING *`,
    [
      id || null, // null lets the DB generate a UUID for new records
      req.name,
      crawlRequest.url,
      crawlRequest.goal || null,
      crawlRequest.maxDepth,
      crawlRequest.maxPages,
      req.cron,
      crawlRequest.extractionSchema ? JSON.stringify(crawlRequest.extractionSchema) : null,
      crawlRequest.extractionPrompt || null,
      crawlRequest.adaptiveBudget,
      crawlRequest.satisfactionThreshold,
      req.active,
      orgId || null
    ]
  );

  return mapRowToSchedule(res.rows[0]);
}

export async function updateScheduleStatus(id: string, active: boolean): Promise<void> {
  if (!isDbEnabled()) return;
  const db = getDb();
  await db.query(
    `UPDATE schedules SET active=$2, updated_at=CURRENT_TIMESTAMP WHERE id=$1`,
    [id, active]
  );
}

export async function deleteSchedule(id: string): Promise<void> {
  if (!isDbEnabled()) return;
  const db = getDb();
  await db.query(`DELETE FROM schedules WHERE id=$1`, [id]);
}

export async function updateScheduleLastRun(id: string, lastRunAt: Date, nextRunAt: Date): Promise<void> {
  if (!isDbEnabled()) return;
  const db = getDb();
  await db.query(
    `UPDATE schedules SET last_run_at=$2, next_run_at=$3 WHERE id=$1`,
    [id, lastRunAt, nextRunAt]
  );
}

function mapRowToSchedule(row: any): Schedule {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    goal: row.goal || undefined,
    maxDepth: row.max_depth,
    maxPages: row.max_pages,
    cron: row.cron,
    extractionSchema: row.extraction_schema || undefined,
    extractionPrompt: row.extraction_prompt || undefined,
    adaptiveBudget: row.adaptive_budget,
    satisfactionThreshold: row.satisfaction_threshold,
    active: row.active,
    lastRunAt: row.last_run_at ? new Date(row.last_run_at).toISOString() : undefined,
    nextRunAt: row.next_run_at ? new Date(row.next_run_at).toISOString() : undefined,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}
