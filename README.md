<div align="center">
  <img src="assets/hero.png" alt="Spidercrawl Hero" width="100%" />

  # 🕷️ Spidercrawl
  **The AI-Native Web Intelligence Engine**

  [![Spidercrawl CI](https://github.com/<YOUR_USERNAME>/spidercrawl/actions/workflows/ci.yml/badge.svg)](https://github.com/<YOUR_USERNAME>/spidercrawl/actions/workflows/ci.yml)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
  [![Version](https://img.shields.io/badge/version-0.1.0-blue.svg)](#)
  [![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://makeapullrequest.com)

  <p align="center">
    <b>Transform messy web pages into clean, structured knowledge for LLM apps, agents, and RAG systems.</b>
  </p>

  [Explore Docs](#) • [View Demo](#) • [Report Bug](https://github.com/<YOUR_USERNAME>/spidercrawl/issues) • [Request Feature](https://github.com/<YOUR_USERNAME>/spidercrawl/issues)
</div>

<hr />

Spidercrawl is a comprehensive, production-grade platform designed to orchestrate complex web data extraction at scale. It seamlessly blends high-speed static parsing with robust browser rendering and advanced AI reasoning to deliver LLM-ready data with zero friction.

## Ports

| Service | URL | Notes |
| --- | --- | --- |
| API | `http://127.0.0.1:3200` | Fastify backend. |
| Built dashboard | `http://127.0.0.1:3200/app/` | Served by the backend after `npm run dashboard:build`. |
| Dashboard dev server | `http://127.0.0.1:5173/app/` | Vite dev server with `/v1` and `/health` proxied to the API. |
| Python worker | `http://127.0.0.1:8400/health` | Optional for JS-heavy pages and screenshots. |
| Redis | `127.0.0.1:6379` | Required for BullMQ crawl queue and status cache. |
| Postgres | `127.0.0.1:5432` | Required when `DATABASE_URL` is set. Stores jobs/pages/entities/events. |

## Quick Start: Local Development

1. Install Node dependencies.

```bash
npm install
npm run dashboard:install
```

2. Configure the environment.

```bash
cp .env.example .env
```

For the default local stack, keep `PORT=3200`, `REDIS_HOST=127.0.0.1`, and `DATABASE_URL=postgresql://spidercrawl:spidercrawl@localhost:5432/spidercrawl`.

3. Start Redis and Postgres.

```bash
docker compose up -d redis postgres
```

4. Start the optional Playwright worker.

```bash
npm run worker:install
npm run worker:dev
```

The worker is only required for `useBrowser: true`, screenshots, and self-healing extraction fallback. Static scraping and basic crawling can run without it.

5. Start the API.

```bash
npm run dev
```

6. Start the dashboard dev server in another terminal.

```bash
npm run dashboard:dev
```

Open `http://127.0.0.1:5173/app/`.

## Quick Start: Docker

To run the API, Redis, Postgres, and Python worker together:

```bash
docker compose up --build
```

Then open:

- API: `http://127.0.0.1:3200/health`
- Dashboard: `http://127.0.0.1:3200/app/`
- System health: `http://127.0.0.1:3200/v1/system/health`

## Verify The Project

Run the full local verification suite:

```bash
npm run verify
```

This runs the TypeScript build, backend lint, backend tests, dashboard build, TypeScript SDK build, and Python syntax checks.

## Environment Variables

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `PORT` | Yes | `3200` | API port. |
| `HOST` | Yes | `0.0.0.0` | API bind host. |
| `REDIS_HOST` | Yes | `127.0.0.1` | Redis host for BullMQ/status cache. |
| `REDIS_PORT` | Yes | `6379` | Redis port. |
| `REDIS_PASSWORD` | No | empty | Redis password if needed. |
| `DATABASE_URL` | Recommended | local Postgres URL | Enables persisted jobs, pages, events, schedules, API keys, and exports. Unset for Redis-only operation. |
| `WORKER_HOST` | No | `127.0.0.1` | Python worker host. Use `worker` in Docker. |
| `WORKER_PORT` | No | `8400` | Python worker port. |
| `WORKER_URL` | No | derived | Full worker scrape URL override. |
| `OPENAI_API_KEY` | Optional | empty | Used for OpenAI extraction/embeddings/search features. |
| `GOOGLE_AI_API_KEY` | Optional | empty | Used for Gemini extraction/link scoring/vision features. |
| `REQUIRE_API_KEY` | Optional | `false` | Set to `true` to require `Authorization: Bearer sk-sc-...`. |
| `MAX_CONCURRENT_CRAWLS` | Optional | `10` | Limits active crawl jobs. |
| `CRAWL_EXECUTION_MODE` | Optional | `auto` | `auto` uses BullMQ with fallback, `queue` disables fallback, `inline` skips BullMQ for local debugging. |
| `CRAWL_QUEUE_FALLBACK_MS` | Optional | `5000` | In `auto`, queued jobs run in-process if BullMQ does not pick them up in time. |
| `STALE_QUEUED_JOB_MS` | Optional | `600000` | Startup reconciliation window for old queued jobs. |

## API Basics

All `/v1/*` JSON endpoints return this shape:

```json
{
  "success": true,
  "data": {}
}
```

Errors use:

```json
{
  "success": false,
  "error": "Message",
  "details": {}
}
```

### Scrape One Page

```bash
curl -X POST http://127.0.0.1:3200/v1/scrape \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","formats":["markdown","json"]}'
```

Useful options:

- `formats`: `markdown`, `html`, `json`, `screenshot`
- `useBrowser`: render with the Python Playwright worker
- `enableVision`: describe meaningful images with an AI provider
- `extractSchema`: extract structured JSON from the page
- `extractPrompt`: natural-language extraction instruction
- `includeTags` / `excludeTags`: CSS selectors for content shaping
- `timeout`: request timeout in milliseconds

### Start A Crawl

```bash
curl -X POST http://127.0.0.1:3200/v1/crawl \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","maxDepth":1,"maxPages":5,"formats":["markdown"]}'
```

The response contains a job id:

```json
{
  "success": true,
  "data": {
    "id": "job_id",
    "message": "Crawl job started",
    "statusUrl": "/v1/crawl/job_id"
  }
}
```

Poll status:

```bash
curl http://127.0.0.1:3200/v1/crawl/job_id
```

Fetch pages:

```bash
curl http://127.0.0.1:3200/v1/jobs/job_id/pages
```

Fetch one page detail. URL-encode the page URL:

```bash
curl "http://127.0.0.1:3200/v1/jobs/job_id/pages/https%3A%2F%2Fexample.com"
```

### Extract Structured Data

```bash
curl -X POST http://127.0.0.1:3200/v1/extract \
  -H "Content-Type: application/json" \
  -d '{
    "url":"https://example.com",
    "schema":{
      "type":"object",
      "properties":{"title":{"type":"string"}},
      "required":["title"]
    }
  }'
```

### Map A Site

```bash
curl -X POST http://127.0.0.1:3200/v1/map \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","maxDepth":2}'
```

### Health And Operations

```bash
curl http://127.0.0.1:3200/health
curl http://127.0.0.1:3200/v1/system/health
curl http://127.0.0.1:3200/v1/stats
```

`/v1/system/health` reports API, DB, Redis, Python worker, AI availability, and the latest worker/page failure snippet.

## How Scraping Modes Work

| Mode | Trigger | Best for | Tradeoff |
| --- | --- | --- | --- |
| Fast Cheerio scrape | Default | Static HTML, docs, blogs, product pages that render server-side | Fastest, but does not run JavaScript. |
| Playwright worker | `useBrowser: true`, screenshots, or self-healing retry | JS-heavy apps, pages needing rendered DOM, screenshots | Slower and requires the Python worker. |
| Vision enrichment | `enableVision: true` | Pages where images carry important semantic information | Requires an AI provider and adds model cost. |
| Structured extraction | `extractSchema` or `extractPrompt` | JSON-ready data for agents/RAG pipelines | Requires an AI provider. May self-heal through Playwright if extraction is mostly empty. |

## Dashboard

Development dashboard:

```bash
npm run dashboard:dev
```

Open `http://127.0.0.1:5173/app/`. Vite proxies API calls to `http://127.0.0.1:3200` by default. Override with:

```bash
VITE_BACKEND_URL=http://127.0.0.1:3200 npm run dashboard:dev
```

Production/built dashboard:

```bash
npm run dashboard:build
npm run build
npm start
```

Open `http://127.0.0.1:3200/app/`.

## Authentication

Local development defaults to no API key requirement. To require API keys:

```bash
REQUIRE_API_KEY=true npm run dev
```

When enabled, pass keys as:

```bash
Authorization: Bearer sk-sc-...
```

Use the dashboard Settings page or `/v1/apikeys` to create and manage keys. On first DB-backed startup, the API can bootstrap a default organization/key.

## Troubleshooting

| Symptom | Check | Fix |
| --- | --- | --- |
| API will not start | `lsof -nP -iTCP:3200 -sTCP:LISTEN` | Stop the old process or change `PORT`. |
| Dashboard loads but API calls fail | `curl http://127.0.0.1:5173/v1/stats` | Start the API on `3200` or set `VITE_BACKEND_URL`. |
| Crawls stay queued | `curl http://127.0.0.1:3200/v1/stats` and Redis logs | Keep Redis running. Default `CRAWL_EXECUTION_MODE=auto` will fall back in-process if BullMQ stalls. |
| `worker: false` in health | `curl http://127.0.0.1:8400/health` | Run `npm run worker:install` then `npm run worker:dev`. |
| Screenshots fail | Worker health and Playwright install | Re-run `python3 -m playwright install chromium`. |
| Structured extraction fails | `/v1/ai/status` | Set `OPENAI_API_KEY` or `GOOGLE_AI_API_KEY`. |
| Many 429 responses | Local rate limit was hit | Wait one minute or reduce repeated polling/requests. |
| Some websites fail | Job events and `lastWorkerError` | The target may block bots, require auth, or need a proxy/browser mode. Retry with `useBrowser` where applicable. |

## Project Layout

| Path | Purpose |
| --- | --- |
| `src/api` | Fastify server, routes, serialization helpers. |
| `src/core` | Scraper, crawler/orchestrator, mapper, Markdown/table extraction. |
| `src/ai` | Provider abstraction, extraction, vision, entity/link scoring. |
| `src/lib` | Redis, Postgres, job/schedule/webhook stores, event persistence. |
| `src/export` | JSONL, RAG, search, graph, JSON-LD exports. |
| `dashboard` | React/Vite dashboard. |
| `workers` | Python Playwright worker. |
| `sdk/typescript` | TypeScript SDK and CLI. |
| `sdk/python` | Python SDK and LangChain/LlamaIndex helpers. |
| `tests` | Backend unit/regression tests. |

## Current Product Focus

The project already has the major product surfaces in place. The next best work is reliability and clarity, not feature sprawl:

- Keep setup and operator docs accurate.
- Improve failure messages for blocked/hostile websites.
- Add targeted regression tests for crawl queue and DB fallback behavior.
- Keep the dashboard focused on job health, crawl output, and retry/extraction workflows.

## License

MIT
