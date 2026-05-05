# Spidercrawl Reliability Checklist (Code-Mapped)

This checklist turns the audit in `PROJECT_CAPABILITIES.md` into concrete implementation work mapped to this codebase.

## 1) API Consistency & Normalization (P0)

### Tasks
- [ ] Add a single response normalization layer for all `v1` routes (camelCase output, stable status fields).
- [ ] Remove ad-hoc snake_case compatibility transforms from dashboard client once API responses are normalized.
- [ ] Normalize job status source-of-truth behavior between Redis cache and DB fallback.

### Primary files
- `src/api/routes.ts`
- `src/api/server.ts`
- `src/lib/job-store.ts`
- `src/core/orchestrator.ts`
- `dashboard/src/api.ts`
- `src/types/schemas.ts`

### Tests
- [ ] Add API contract tests asserting camelCase for pages/jobs/search responses.
- [ ] Add regression tests for Redis-empty fallback path returning same shape as warm-cache path.

---

## 2) SSE Replay & Real-Time Robustness (P0)

### Tasks
- [ ] Extend `/v1/crawl/:id/stream` to replay recent persisted events before live stream.
- [ ] Add configurable replay window (e.g., last `N` events, default 100).
- [ ] Include deterministic event IDs and timestamps in replay + live messages.
- [ ] Keep heartbeat and `stream.end` behavior unchanged.

### Primary files
- `src/api/routes.ts`
- `src/lib/job-store.ts` (read/write `crawl_events`)
- `src/lib/crawl-events.ts`
- `dashboard/src/hooks/useCrawlStream.ts`
- `dashboard/src/components/CrawlEventLog.tsx`

### Tests
- [ ] Add integration test: disconnect/reconnect mid-crawl returns recent history.
- [ ] Add ordering test: replayed events are chronological and deduplicated in UI state.

---

## 3) Extraction Reliability & Fallbacks (P0)

### Tasks
- [ ] Add structured extraction retry policy by failure class:
  - JSON parse/format failure
  - provider error/rate limit
  - empty/low-signal extraction
- [ ] Add provider fallback path (Gemini <-> OpenAI) with explicit telemetry.
- [ ] Add deep-inspect retry mode (browser-first extraction path) for failed/empty results.
- [ ] Persist extraction failure reason + retry attempts in event/log metadata.

### Primary files
- `src/core/scraper.ts`
- `src/ai/structured-extractor.ts`
- `src/ai/provider.ts`
- `src/core/orchestrator.ts`
- `src/lib/job-store.ts`

### Tests
- [ ] Unit tests for retry matrix and fallback selection.
- [ ] Integration test for non-fatal failure recording and eventual successful fallback extraction.

---

## 4) Entity Resolution: Incremental + Confidence (P1)

### Tasks
- [ ] Move entity resolution from batch-only to per-page incremental updates during crawl.
- [ ] Add confidence score on entity relationships/links.
- [ ] Store enough provenance (source page/alias match reason) for debugging.
- [ ] Expose confidence + provenance to dashboard and export endpoints.

### Primary files
- `src/ai/entity-resolver.ts`
- `src/core/orchestrator.ts`
- `src/core/knowledge-graph.ts`
- `src/export/graph.ts`
- `src/api/routes.ts`
- `db/schema.sql` (relationship confidence fields/tables as needed)
- `dashboard/src/pages/JobDetailPage.tsx`

### Tests
- [ ] DB migration test for new confidence/provenance fields.
- [ ] Graph export tests verifying confidence is present and stable.

---

## 5) RAG Retrieval Quality (P1)

### Tasks
- [ ] Apply hybrid retrieval (keyword + vector) for both job-scoped and cross-job search.
- [ ] Add a re-ranking stage for top candidates before final response.
- [ ] Return per-hit scoring breakdown (keyword, vector, rerank) for observability.
- [ ] Tune snippet generation to prioritize reranked top results.

### Primary files
- `src/api/routes.ts`
- `src/export/search.ts`
- `src/export/rag.ts`
- `src/mcp/server.ts`
- `dashboard/src/pages/SearchPage.tsx`
- `dashboard/src/pages/JobDetailPage.tsx`

### Tests
- [ ] Expand `tests/search.test.ts` with hybrid + rerank ranking expectations.
- [ ] Add regression test ensuring cross-job search is not keyword-only.

---

## 6) Dashboard Reliability & Debuggability (P1)

### Tasks
- [ ] Surface worker health and last error in Job Detail (not only system-wide).
- [ ] Add “Re-run Extraction” action for completed jobs without full recrawl.
- [ ] Improve failure UX in events/errors tabs with actionable error summaries.

### Primary files
- `dashboard/src/pages/JobDetailPage.tsx`
- `dashboard/src/components/SystemStatusBar.tsx`
- `dashboard/src/components/CrawlEventLog.tsx`
- `dashboard/src/api.ts`
- `src/api/routes.ts` (new extraction rerun endpoint)
- `src/core/orchestrator.ts` (rerun extraction flow)

### Tests
- [ ] Dashboard behavior tests for extraction rerun action states.
- [ ] API tests for rerun endpoint validation and job updates.

---

## Suggested Delivery Sequence

1. P0-1 API normalization
2. P0-2 SSE replay
3. P0-3 extraction fallback hardening
4. P1-5 retrieval quality
5. P1-6 dashboard reliability
6. P1-4 incremental entity confidence model

## Definition of Done (Release Gate)

- [ ] No snake_case fields in public v1 JSON responses.
- [ ] SSE reconnect preserves recent event history.
- [ ] Extraction success rate improves under provider/transient failures.
- [ ] Search relevance improves with measurable top-3 quality lift.
- [ ] Job Detail exposes actionable failure signals and extraction rerun workflow.
