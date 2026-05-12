import { createHmac, randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import { getDb, isDbEnabled } from "./db.js";
import { logger } from "./logger.js";
import type { JobStatus } from "../types/schemas.js";

export type WebhookEvent = "job.completed" | "job.failed";

export interface WebhookRecord {
  id: string;
  orgId?: string;
  event: WebhookEvent;
  url: string;
  secret: string;
  createdAt: string;
}

export interface PublicWebhookRecord extends Omit<WebhookRecord, "secret"> {
  hasSecret: boolean;
}

export function signWebhookPayload(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

export function buildWebhookPayload(event: WebhookEvent, job: JobStatus) {
  return {
    event,
    job: {
      id: job.id,
      rootUrl: job.rootUrl,
      status: job.status,
      goal: job.goal,
      completedPages: job.completedPages,
      totalPages: job.totalPages,
      error: job.error,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
    },
    sentAt: new Date().toISOString(),
  };
}

export function assertDeliverableWebhookUrl(url: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("webhook url must use http or https");
  }
}

export function toPublicWebhookRecord(webhook: WebhookRecord): PublicWebhookRecord {
  const { secret: _secret, ...publicRecord } = webhook;
  return { ...publicRecord, hasSecret: true };
}

export async function createWebhook(event: WebhookEvent, url: string, orgId?: string): Promise<WebhookRecord> {
  if (!isDbEnabled()) throw new Error("DATABASE_URL is required for webhooks");
  assertDeliverableWebhookUrl(url);
  const db = getDb();
  const record = {
    id: nanoid(12),
    orgId,
    event,
    url,
    secret: randomBytes(24).toString("hex"),
    createdAt: new Date().toISOString(),
  };

  await db.query(
    `INSERT INTO webhooks (id, org_id, event, url, secret, created_at) VALUES ($1,$2,$3,$4,$5,$6)`,
    [record.id, record.orgId, record.event, record.url, record.secret, record.createdAt]
  );
  return record;
}

export async function listWebhooks(orgId?: string, event?: WebhookEvent): Promise<WebhookRecord[]> {
  if (!isDbEnabled()) return [];
  const db = getDb();
  
  let q = "SELECT * FROM webhooks WHERE 1=1";
  const params: any[] = [];
  
  if (orgId) {
    params.push(orgId);
    q += ` AND (org_id = $${params.length} OR org_id IS NULL)`;
  }
  if (event) {
    params.push(event);
    q += ` AND event = $${params.length}`;
  }
  
  q += " ORDER BY created_at DESC";
  
  const res = await db.query(q, params);
  return res.rows.map((row) => ({
    id: row.id,
    orgId: row.org_id,
    event: row.event,
    url: row.url,
    secret: row.secret,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

export async function deleteWebhook(id: string, orgId?: string): Promise<boolean> {
  if (!isDbEnabled()) return false;
  const db = getDb();
  const res = await db.query(
    `DELETE FROM webhooks WHERE id=$1 ${orgId ? "AND (org_id=$2 OR org_id IS NULL)" : ""}`,
    orgId ? [id, orgId] : [id]
  );
  return (res.rowCount ?? 0) > 0;
}

async function deliverWebhook(webhook: WebhookRecord, event: WebhookEvent, job: JobStatus): Promise<void> {
  const body = JSON.stringify(buildWebhookPayload(event, job));
  const signal = AbortSignal.timeout(10_000);
  const res = await fetch(webhook.url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-spidercrawl-event": event,
      "x-spidercrawl-signature": signWebhookPayload(webhook.secret, body),
    },
    body,
    signal,
  });

  if (!res.ok) {
    throw new Error(`Webhook ${webhook.id} failed with HTTP ${res.status}`);
  }
}

export async function deliverJobWebhooks(event: WebhookEvent, job: JobStatus, orgId?: string): Promise<void> {
  const webhooks = await listWebhooks(orgId, event);
  await Promise.allSettled(webhooks.map(async (webhook) => {
    try {
      await deliverWebhook(webhook, event, job);
      logger.info({ webhookId: webhook.id, event, jobId: job.id }, "Webhook delivered");
    } catch (err: any) {
      logger.warn({ webhookId: webhook.id, event, jobId: job.id, err: err.message }, "Webhook delivery failed");
    }
  }));
}
