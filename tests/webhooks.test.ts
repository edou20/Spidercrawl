import { describe, expect, it } from "vitest";
import {
  assertDeliverableWebhookUrl,
  buildWebhookPayload,
  signWebhookPayload,
  toPublicWebhookRecord,
} from "../src/lib/webhooks.js";
import type { JobStatus } from "../src/types/schemas.js";

const job: JobStatus = {
  id: "job_123",
  rootUrl: "https://example.com",
  status: "completed",
  progress: 100,
  totalPages: 2,
  completedPages: 2,
  maxDepth: 2,
  maxPages: 10,
  results: [],
  createdAt: "2026-05-03T00:00:00.000Z",
  updatedAt: "2026-05-03T00:01:00.000Z",
};

describe("webhooks", () => {
  it("signs webhook payloads with a stable sha256 prefix", () => {
    const signature = signWebhookPayload("secret", JSON.stringify({ ok: true }));

    expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(signature).toBe(signWebhookPayload("secret", JSON.stringify({ ok: true })));
  });

  it("builds compact terminal job payloads", () => {
    const payload = buildWebhookPayload("job.completed", job);

    expect(payload.event).toBe("job.completed");
    expect(payload.job.id).toBe("job_123");
    expect(payload.job.completedPages).toBe(2);
    expect(payload.job.status).toBe("completed");
    expect(payload.sentAt).toBeTruthy();
  });

  it("redacts webhook secrets from list responses", () => {
    const publicRecord = toPublicWebhookRecord({
      id: "wh_123",
      event: "job.completed",
      url: "https://example.com/hook",
      secret: "secret",
      createdAt: "2026-05-03T00:00:00.000Z",
    });

    expect("secret" in publicRecord).toBe(false);
    expect(publicRecord.hasSecret).toBe(true);
  });

  it("only accepts http and https delivery urls", () => {
    expect(() => assertDeliverableWebhookUrl("https://example.com/hook")).not.toThrow();
    expect(() => assertDeliverableWebhookUrl("ftp://example.com/hook")).toThrow(/http or https/);
  });
});
