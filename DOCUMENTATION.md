# Spidercrawl Documentation And Status

Spidercrawl is an AI-native web intelligence engine for converting unstructured web content into clean, structured knowledge for LLM and RAG systems.

This document is the current status and operator map. For day-to-day commands and examples, start with `README.md`.

## Product Purpose

Spidercrawl exists to solve a specific problem: reliable structured web data for LLM applications is usually manual, brittle, and custom-coded per site.

The project addresses that with:

- A simple HTTP API for scraping, crawling, mapping, extracting, searching, and exporting.
- Fast static parsing for ordinary HTML pages.
- Browser rendering for JS-heavy pages and screenshots.
- AI-assisted structured extraction and vision enrichment.
- Queue-backed crawl orchestration with persisted status and page storage.
- Dashboard workflows for starting crawls, inspecting pages, searching, and managing integrations.

## Current Architecture

| Layer | Implementation | Responsibility |
| --- | --- | --- |
| API gateway | Fastify in `src/api` | Validation, routing, rate limiting, auth hooks, response normalization. |
| Scraper | `src/core/scraper.ts` | Fetch HTML, strip noise, extract links/tables, produce Markdown/HTML/JSON. |
| Markdown engine | `src/core/markdown-engine.ts` | LLM-friendly Markdown conversion with table/code preservation. |
| Crawl orchestrator | `src/core/orchestrator.ts` | BullMQ queue, BFS crawl loop, job status, DB persistence, webhooks, stale-job reconciliation. |
| Browser worker | `workers/scraper_worker.py` | Playwright rendering and screenshots for JS-heavy pages. |
| Storage | `src/lib/db.ts`, `src/lib/job-store.ts`, Redis | Postgres persistence plus Redis queue/status cache. |
| AI layer | `src/ai` | Structured extraction, vision descriptions, goal scoring, entity resolution. |
| Exports/search | `src/export` | JSON, CSV, JSONL, RAG, graph, JSON-LD, keyword/vector/hybrid search. |
| Dashboard | `dashboard` | React/Vite UI for crawl management, pages, search, schedules, settings. |
| SDKs | `sdk/typescript`, `sdk/python` | Client libraries, CLI, LangChain and LlamaIndex integration helpers. |

## Runtime Services

| Service | Required For | Default |
| --- | --- | --- |
| Node API | All API/dashboard operations | `http://127.0.0.1:3200` |
| Redis | Crawl queue/status cache | `127.0.0.1:6379` |
| Postgres | Persistent jobs/pages/events/API keys/schedules | `127.0.0.1:5432` |
| Python worker | Browser rendering/screenshots/self-healing fallback | `http://127.0.0.1:8400` |
| Dashboard dev server | Frontend development | `http://127.0.0.1:5173/app/` |

## Implemented API Surface

Core:

- `GET /health`
- `GET /v1/system/health`
- `GET /v1/stats`
- `POST /v1/scrape`
- `POST /v1/crawl`
- `GET /v1/crawl/:id`
- `GET /v1/crawl/:id/stream`
- `POST /v1/map`
- `POST /v1/extract`

Jobs and pages:

- `GET /v1/jobs`
- `DELETE /v1/jobs/:id`
- `POST /v1/jobs/:id/retry`
- `GET /v1/jobs/:id/pages`
- `GET /v1/jobs/:id/pages/*`
- `GET /v1/jobs/:id/events`
- `GET /v1/jobs/:id/links`
- `GET /v1/jobs/:id/entities`
- `GET /v1/jobs/:id/extracted`
- `POST /v1/jobs/:id/extraction/rerun`
- `GET /v1/jobs/:id/summary`
- `POST /v1/jobs/:id/ask`

Exports/search:

- `GET /v1/export/json/:id`
- `GET /v1/export/csv/:id`
- `GET /v1/export/jsonl/:id`
- `GET /v1/export/fine-tune-jsonl/:id`
- `GET /v1/export/jsonld/:id`
- `GET /v1/export/cytoscape/:id`
- `GET /v1/export/graphml/:id`
- `GET /v1/export/rag/:id`
- `POST /v1/export/rag/:id/search`
- `POST /v1/search`

Operations/integrations:

- `GET /v1/ai/status`
- `GET /v1/apikeys`
- `POST /v1/apikeys`
- `DELETE /v1/apikeys/:keyId`
- `GET /v1/schedules`
- `POST /v1/schedules`
- `PATCH /v1/schedules/:id`
- `DELETE /v1/schedules/:id`
- `GET /v1/webhooks`
- `POST /v1/webhooks`
- `DELETE /v1/webhooks/:id`

## Reliability Notes

Recent reliability work added or verified:

- Dedicated BullMQ Redis connections without command timeouts, so blocking worker reads do not time out while idle.
- In-process crawl fallback in `CRAWL_EXECUTION_MODE=auto` when a queued job is not picked up quickly.
- Startup reconciliation for stale queued jobs, marking old orphaned jobs failed with a retryable message instead of keeping the dashboard permanently active.
- Dashboard dev proxy alignment with API port `3200`.
- Table-to-Markdown regression coverage for DOM collections that do not expose `.forEach`.
- Python SDK syntax and URL-encoding fixes.

## Verification

Primary check:

```bash
npm run verify
```

Manual runtime checks:

```bash
curl http://127.0.0.1:3200/health
curl http://127.0.0.1:3200/v1/system/health
curl http://127.0.0.1:5173/v1/stats
```

Expected healthy local system:

- API: `true`
- DB: `true` when `DATABASE_URL` points to a running Postgres
- Redis: `true`
- Worker: `true` when `npm run worker:dev` or Docker worker is running
- AI: `true` when at least one supported AI provider key is configured

## Known Weak Spots

These are product/ops clarity risks rather than missing core architecture:

- Some external sites block automated requests even with browser rendering. Better user-facing blocked-site guidance would help.
- Browser worker setup is inherently heavier than the Node-only path because Playwright must install Chromium.
- Advanced extraction quality depends on provider availability and target-page quality.
- Dashboard should continue surfacing job-level failure context so users do not need to read logs.
- More regression coverage is useful around Redis-empty DB fallback and long-running SSE/event replay flows.

## Recommended Next Work

Priority order:

1. Add more targeted tests around crawl queue fallback, stale queued reconciliation, and DB reconstruction paths.
2. Improve dashboard failure UX for blocked sites, worker errors, and extraction failures.
3. Add cookbook examples for common workflows: docs indexing, e-commerce extraction, news/blog ingestion, RAG export.
4. Tighten auth/protected-site documentation: headers, cookies, browser mode, and proxy strategy.
5. Avoid major new features until the reliability and onboarding loop feels boringly dependable.
