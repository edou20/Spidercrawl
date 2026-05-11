import type { CrawlEventRow } from "../lib/job-store.js";
import { parseIntegerSetting } from "../lib/env-utils.js";

export function resolveReplayLimit(
  replayLimitRaw: string | undefined,
  envDefaultRaw: string | undefined,
): number {
  const defaultReplay = parseIntegerSetting(envDefaultRaw, 100, { min: 0, max: 1000 });
  return parseIntegerSetting(replayLimitRaw, defaultReplay, { min: 0, max: 1000 });
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
