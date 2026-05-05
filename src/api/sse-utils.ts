import type { CrawlEventRow } from "../lib/job-store.js";

export function resolveReplayLimit(
  replayLimitRaw: string | undefined,
  envDefaultRaw: string | undefined,
): number {
  const defaultReplay = Number(envDefaultRaw ?? 100);
  const replay = replayLimitRaw ? Number(replayLimitRaw) : defaultReplay;
  if (!Number.isFinite(replay)) return Math.max(0, Math.min(defaultReplay, 1000));
  return Math.max(0, Math.min(Math.floor(replay), 1000));
}

export function toReplayPayload(event: CrawlEventRow): string {
  return JSON.stringify({
    id: event.id,
    type: event.eventType,
    jobId: event.jobId,
    url: event.url,
    data: event.data,
    ts: event.createdAt,
  });
}

