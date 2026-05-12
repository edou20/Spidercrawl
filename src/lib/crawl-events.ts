import { EventEmitter } from "events";
import { insertCrawlEvent } from "./job-store.js";

export type CrawlEventType =
  | "job.started"
  | "job.progress"
  | "job.completed"
  | "job.failed"
  | "page.crawled"
  | "page.skipped"
  | "page.failed"
  | "link.scored";

export interface CrawlStreamEvent {
  type: CrawlEventType;
  jobId: string;
  url?: string;
  data: Record<string, unknown>;
  ts: string;
}

// Single in-process emitter — orchestrator and SSE route share the same process
const emitter = new EventEmitter();
emitter.setMaxListeners(500); // One listener per active SSE subscriber per job

export function emitCrawlEvent(event: CrawlStreamEvent): void {
  emitter.emit(`job:${event.jobId}`, event);
  // Persist asynchronously — never block the hot crawl path
  insertCrawlEvent(event.jobId, event.type, event.url ?? null, event.data).catch(() => {});
}

/**
 * Subscribe to all events for a job. Returns an unsubscribe function.
 */
export function onCrawlEvent(
  jobId: string,
  handler: (event: CrawlStreamEvent) => void
): () => void {
  const key = `job:${jobId}`;
  emitter.on(key, handler);
  return () => emitter.off(key, handler);
}
