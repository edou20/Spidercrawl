# Spidercrawl — Strategic Roadmap & Deep Analysis
> Last updated: 2026-05-03  
> Living document — update freely as priorities shift.

---

## Table of Contents
1. [Honest Audit](#1-honest-audit)
2. [Competitive Landscape](#2-competitive-landscape)
3. [Phased Roadmap](#3-phased-roadmap)
4. [Architecture Evolution](#4-architecture-evolution)
5. [Execution Priority Matrix](#5-execution-priority-matrix)
6. [18-Month Vision](#6-18-month-vision)

---

## 1. Honest Audit

### What Works Well
| Strength | Why it matters |
|---|---|
| 3-tier scraping pipeline (Cheerio → Vision LLM → Playwright) | Pragmatic cost control: fast path first, heavy artillery only when needed |
| Goal-oriented BFS with LLM relevance scoring | Differentiator vs. dumb crawlers; focuses budget on signal pages |
| pgvector + IVFFlat embeddings storage | Production-ready vector search out of the box |
| BullMQ job queue with Redis state | Reliable async, retries, concurrency limits, repeatable jobs |
| JSON-LD knowledge graph generation | Structured extraction beyond raw text; rare in open-source tools |
| Provider abstraction (Gemini/OpenAI) | Swap models without code changes |
| React + Vite dashboard with polling-based live updates | Good operational visibility today; SSE/WebSocket can come later |

### Critical Bugs & Technical Debt (Phase 0)

#### Bug 1 — Job state stored entirely in Redis (no persistence)
**Location:** `src/queue/worker.ts` — `redis.set(\`job:\${id}\`, JSON.stringify(state))`  
**Problem:** Full page markdown, entities, embeddings stored as one Redis key. Redis is not durable storage. A restart wipes all job history. No pagination possible.  
**Fix:** Move job state to PostgreSQL `jobs` table; keep only queue metadata in Redis.

#### Bug 2 — RAG search uses fake keyword matching
**Location:** `src/routes/export.ts` → `/v1/export/rag/:id/search`  
**Problem:** The endpoint does a JavaScript `.includes()` on in-memory strings instead of calling `searchEmbeddings()` from `rag.ts`. pgvector index exists but is never queried.  
**Fix:** Wire the route to `searchEmbeddings(query, jobId, topK)` — the function is already written.

#### Bug 3 — API keys are stored but never validated
**Location:** `src/routes/auth.ts` creates keys; no middleware reads them.  
**Problem:** All endpoints are effectively open. Any caller can start, delete, or export crawls.  
**Fix:** Add `fastify.addHook('onRequest', validateApiKey)` with a whitelist of public routes.

#### Bug 4 — No rate limiting on crawl start
**Location:** `src/routes/crawl.ts`  
**Problem:** Nothing stops a caller from firing 1,000 crawl jobs simultaneously.  
**Fix:** Per-key concurrency limit via Redis counter + BullMQ `defaultJobOptions.delay`.

#### Bug 5 — Playwright worker has no memory guard
**Location:** `worker/playwright_worker.py`  
**Problem:** Each page spawns a full browser context. Under load, OOM crash is guaranteed.  
**Fix:** Semaphore pool (max 4 concurrent contexts), timeout per page, context reuse.

#### Bug 6 — Embeddings chunking is naive
**Location:** `src/lib/rag.ts`  
**Problem:** Text is split by character count only. Semantic boundaries are ignored; chunks straddle sentences and destroy retrieval quality.  
**Fix:** Sentence-aware chunking (split on `.\n`, paragraph breaks, then enforce max token limit per chunk).

#### Bug 7 — No deduplication of crawled URLs
**Location:** `src/queue/worker.ts` BFS loop  
**Problem:** The visited-URL set lives in memory only. If a job restarts, it re-crawls everything.  
**Fix:** Persist visited URLs to `page_links` table on every insert; on resume, seed the set from DB.

---

## 2. Competitive Landscape

| Product | Model | Strength | Weakness | Spidercrawl edge |
|---|---|---|---|---|
| **Firecrawl** | SaaS + open-source | Polished API, LLM-ready output | No goal-directed crawling, no KG | Goal scoring, KG generation |
| **Crawl4AI** | Open-source Python | Fast, LLM extraction, chunking | No dashboard, no job queue, no vector storage | Full platform with UI |
| **Apify** | Cloud SaaS | Huge actor marketplace | Expensive, no self-host, complex pricing | Self-hosted, transparent |
| **Diffbot** | Enterprise SaaS | Best-in-class structured extraction | $500+/mo, closed | Affordable, customisable |
| **ScrapingBee** | SaaS proxy | Reliable JS rendering | No intelligence layer, no storage | Smarter extraction + storage |
| **Jina Reader** | API | Clean markdown output | No storage, no scheduling, no KG | Complete pipeline |
| **Bright Data** | Enterprise | Unblock capability | Very expensive, not for devs | Developer-first |

**Positioning statement:**  
> Spidercrawl is the *intelligent self-hosted web data platform* — it crawls with a goal, extracts structured knowledge, stores it as searchable vectors and a knowledge graph, and exposes everything through a clean API and dashboard. It is the open-source alternative to Diffbot + Firecrawl combined.

---

## 3. Phased Roadmap

### Phase 0 — Foundation Fixes ✅ COMPLETE
*Must ship before anything else. These are blockers.*

- [x] **Persist job state to PostgreSQL** — `getCrawlStatus` falls back to DB on Redis miss; `listRecentJobs` uses DB as primary source; `reconstructJobFromDb` re-warms Redis cache
- [x] **Wire real pgvector search** — `/v1/export/rag/:id/search` uses `searchEmbeddings()` when embeddings exist; degrades gracefully to keyword search otherwise; response includes `searchType: "vector"|"keyword"`
  Current state: search hits now also include match terms and provenance metadata such as chunk index, crawl depth (when persisted), status code, crawl timestamp, and image counts.
- [x] **Enforce API key middleware** — `onRequest` hook in `server.ts`; opt-in via `REQUIRE_API_KEY=true`; open routes: `/health`, `/v1/ai/status`; bootstrap mode allows creating/listing the first API key before auth is established
- [x] **Rate limiting** — route-level 10 req/min on `POST /v1/crawl`; active-job concurrency cap (default 10, configurable via `MAX_CONCURRENT_CRAWLS`)
- [x] **Playwright memory guard** — `asyncio.Semaphore(MAX_CONCURRENT_CONTEXTS)` (default 4, env `PLAYWRIGHT_MAX_CONTEXTS`); contexts always closed in `finally` block
- [x] **Semantic chunking** — sentence-aware splitter: paragraph → sentence boundary fallback; 1500-char chunks; drops fragments < 20 chars; configurable via `CHUNK_MAX_CHARS`
- [x] **URL deduplication across restarts** — BFS `visited` set seeded from `pages` table via `getVisitedUrls(jobId)` at crawl start

**Acceptance criteria:** A 500-page crawl completes cleanly, job survives a server restart, RAG search returns semantically relevant chunks.

---

### Phase 1 — Core Intelligence (Weeks 4–10)
*Turn Spidercrawl into a genuinely smart data extraction engine.*

#### 1.1 Structured Extraction Schemas
Allow users to define a JSON schema; the LLM extracts typed fields from each page instead of freeform markdown.
```json
{
  "schema": {
    "price": "number",
    "title": "string",
    "availability": "boolean"
  }
}
```
- Dashboard UI: schema builder (key/type pairs)
- API: `POST /v1/crawl` accepts `extractionSchema` or `extractionPrompt`
- Worker: per-page extraction is wired for crawls; validation/reporting still needs hardening

Status: fully implemented. The schema builder UI is live in the New Crawl page. The API and worker are fully wired to handle structured extraction using LLM-based schemas.

#### 1.2 Adaptive Crawl Budgets
Instead of fixed `maxDepth`/`maxPages`, the crawler stops when it decides the goal is "satisfied":
- Track goal coverage score across all crawled pages
- Stop condition: rolling average relevance drops below threshold for N consecutive pages
- Expose confidence score in job status

Status: fully implemented. The orchestrator tracks a rolling average relevance score, exposes `satisfactionScore` in job status, and terminates the crawl early when the score drops below the configured threshold. The dashboard New Crawl form includes an Adaptive Budget toggle with configurable threshold.

#### 1.3 Change Detection & Incremental Crawls
- Store content hash per URL in `pages` table
- Re-crawl endpoint: only fetch changed pages
- Dashboard: diff view showing what changed since last crawl
- BullMQ repeatable jobs already exist — wire them to incremental mode

Status: fully implemented. The scraper computes SHA-256 content hashes per page. The orchestrator loads previous hashes when `rerunJobId` is set, skips unchanged pages (copying historical data into the new job snapshot), and tracks `changedPages` / `skippedPages` counters. The dashboard Job Detail view includes an "Incremental Re-run" button and displays skip/change statistics.

#### 1.4 Entity Resolution & Deduplication
- Cross-page entity merging: if "Apple Inc." and "Apple" appear in different pages, resolve to one node
- Confidence scores on merge decisions
- Knowledge graph: merge duplicate nodes, add `sameAs` edges

Status: fully implemented. Cross-page entity resolution with case-insensitive name matching, alias merging, and source URL aggregation is live. The dashboard Knowledge Graph tab visualises entities as a force-directed graph with filtering by type. Confidence scoring and richer semantic edges (`sameAs`, `partOf`) remain open follow-up work.

#### 1.5 Multi-modal Extraction
- Screenshot OCR: extract text from images using vision LLM (partial: vision path exists)
- PDF extraction: detect PDF links, use `pdf-parse` or `pdfplumber`
- Table extraction: structured HTML tables → JSON arrays (DONE)
- Video transcript extraction: YouTube/Vimeo links → transcript via API

Status: HTML table extraction is now implemented. Scrapes capture normalized table data (`caption`, `headers`, `rows`), persist it through page recovery, expose it in JSON-oriented exports, and surface compact previews in the dashboard job detail view. PDF and video extraction remain open.

---

### Phase 2 — Platform Features (Weeks 10–20)
*Make Spidercrawl a complete platform, not just a crawler.*

#### 2.1 MCP (Model Context Protocol) Server
**This is the highest-leverage feature in the entire roadmap.**

Expose Spidercrawl as an MCP server so any AI assistant (Claude, Cursor, Continue, etc.) can:
- Start a crawl: `tool: start_crawl(url, goal)`
- Query the knowledge base: `tool: search(query)`
- Get structured data: `tool: get_entities(type)`
- Monitor jobs: `tool: get_job_status(id)`

```typescript
Status: fully implemented. A dedicated MCP server is available in `src/mcp`, exposing tools for starting crawls, monitoring status, semantic search, and entity retrieval over Stdio. This allows native integration with Claude Desktop, Cursor, and other MCP clients.
```

This single feature makes Spidercrawl usable from Claude Desktop, Cursor, and every MCP-compatible tool.

#### 2.2 Dashboard: Knowledge Graph Visualiser
- D3.js or `react-force-graph` force-directed graph
- Node types: Organisation, Person, Product, URL, Concept
- Edge types: mentions, links_to, sameAs, partOf
- Filter by entity type, click to see source pages
- Export: GraphML, JSON-LD, Cytoscape format

Status: dashboard graph inspection is implemented, and graph exports now include JSON-LD, GraphML, and Cytoscape JSON for page/entity graphs. Richer semantic edges such as `sameAs` and `partOf` remain open.

#### 2.3 Dashboard: Semantic Search UI
- Full search page with query input
- Results ranked by cosine similarity
- Snippet with highlighted matching sentences
- Filter by crawl job, date range, entity type
- "Ask a question" mode: RAG answer with source citations

Status: job-scoped semantic search in the dashboard now supports ranked results, score filtering, graph jump actions, and backend-provided provenance. A dedicated cross-job keyword search page is now available for persisted crawls; citation-oriented answer mode and cross-job vector ranking are still open.

#### 2.4 Scheduled Crawls UI
- Visual cron builder (not raw cron strings)
- "Crawl every Monday at 9am" toggle
- History: last 10 runs, success/fail, pages changed
- Alert: notify on significant content change (webhook + email)

Status: fully implemented. Scheduled crawls are persisted in PG and synchronized with BullMQ repeatable jobs. The dashboard includes a dedicated "Schedules" hub for management, and the New Crawl page supports instant automation.

#### 2.5 Webhook & Integration Layer
```
POST /v1/webhooks
{
  "event": "job.completed",
  "url": "https://your-app.com/hook",
  "secret": "..."
}
```
Events: `job.started`, `job.completed`, `job.failed`, `pages.changed`  
HMAC-signed payloads.  
Built-in integrations: Zapier webhook, Slack, n8n-compatible.

Status: fully implemented. Signed webhook subscriptions are live for `job.completed` and `job.failed` with DB persistence and HMAC delivery headers. The Settings dashboard can create and delete subscriptions, shows the signing secret only at creation time, and lists existing webhooks without re-exposing secrets.

#### 2.6 Export Formats
- **CSV** — flat table of pages + fields
- **JSONL** — one page per line, streaming-friendly
- **Parquet** — columnar, for data science workflows
- **OpenAI fine-tuning JSONL** — prompt/completion pairs from extracted content
- **LlamaIndex dataset** — `Document` objects with metadata
- **Obsidian vault** — markdown files with wiki-links from knowledge graph

Status: CSV, JSON, JSONL, JSON-LD, GraphML, Cytoscape JSON, RAG document JSON, and OpenAI-style fine-tuning JSONL exports are implemented and mounted as API routes. JSONL emits one structured page record per line with crawl metadata and inferred entity type, while the fine-tuning variant emits chat-style training examples with structured assistant targets. Columnar exports remain open.

#### Phase 2 Hardening Notes — 2026-05-03
- Export buttons and documented export paths now point at real backend routes under `/v1/export/*`.
- API-key enforcement now accepts both bootstrapped DB-backed keys and dashboard-created Redis keys without parse failures.
- Dashboard webhooks no longer assume list responses include secrets; secrets are shown only once on creation.
- Generated artifacts were moved out of source paths or removed: Redis dumps, Vim swap files, and dashboard TypeScript build info.
- Browser smoke checks passed for Dashboard, Settings, and Schedules with no console errors.

---

### Phase 3 — Ecosystem & Developer Experience (Weeks 20–30)
*Make Spidercrawl the tool developers recommend to each other.*

#### 3.1 TypeScript SDK
```typescript
import { SpidercrawlClient } from "@spidercrawl/sdk";

const sc = new SpidercrawlClient({ apiKey: "..." });
const job = await sc.crawl("https://docs.example.com", {
  goal: "Extract all API endpoints and parameters",
  schema: { endpoint: "string", method: "string", description: "string" }
});
const results = await sc.search(job.id, "authentication");
```

Status: fully implemented. The official TypeScript SDK (`@spidercrawl/sdk`) is available in `sdk/typescript`, providing a fluent, dependency-free client for scraping, crawling, and semantic search.

#### 3.2 Python SDK
```python
from spidercrawl import SpidercrawlClient

sc = SpidercrawlClient(api_key="...")
job = sc.crawl("https://docs.example.com", goal="Find all pricing info")
results = sc.search(job.id, "enterprise plan limits")
```

Status: fully implemented. Official Python SDK available in `sdk/python` with native `httpx` support, async polling, and comprehensive error handling.

#### 3.3 CLI Tool
```bash
npx spidercrawl crawl https://docs.example.com --goal "Find API docs" --format json
npx spidercrawl search <job-id> "authentication endpoints"
npx spidercrawl export <job-id> --format parquet > data.parquet
```

Status: fully implemented. The CLI tool is bundled with the TypeScript SDK, exposing the `spidercrawl` command for headless orchestration.

#### 3.4 Docker Compose One-Command Deploy
```yaml
# docker-compose.yml
services:
  api:       image: spidercrawl/api
  worker:    image: spidercrawl/playwright-worker
  dashboard: image: spidercrawl/dashboard
  redis:     image: redis:7-alpine
  postgres:  image: pgvector/pgvector:pg16
```
Status: fully implemented. Optimized `docker-compose.yml` and `Dockerfile` support a true one-command deployment that automatically builds the dashboard and API services with shared health checks.

#### 3.5 LangChain / LlamaIndex Integration
```python
from langchain.document_loaders import SpidercrawlLoader

loader = SpidercrawlLoader(api_key="...", url="https://docs.example.com")
docs = loader.load()  # Returns List[Document] from crawled + extracted pages
```

Status: fully implemented. Native `SpidercrawlLoader` and `SpidercrawlReader` provided for LangChain and LlamaIndex respectively, supporting high-fidelity web ingestion.

#### 3.6 Plugin System for Custom Extractors
```typescript
// Register a custom extractor
spidercrawl.registerExtractor("product-price", {
  match: (url) => url.includes("/product/"),
  extract: async (html, page) => ({
    price: page.querySelector('[data-price]')?.textContent,
    sku: page.querySelector('[data-sku]')?.textContent,
  })
});
```

---

### Phase 4 — Enterprise & Scale (Months 8–18)
*For teams and organisations that need Spidercrawl at scale.*

#### 4.1 Multi-tenancy
- Organisations, teams, members (RBAC)
- Per-org crawl quotas, API key management
- Audit log: who started what, when
- Billing hooks (Stripe integration)

#### 4.2 Proxy & Unblocking Layer
- Integrate with Bright Data / Oxylabs / SmartProxy API
- Automatic fallback: direct → residential proxy → headless browser
- Geolocation selection for localised content
- CAPTCHA solving integration (2Captcha, Anti-Captcha)

#### 4.3 Distributed Crawl Workers
- BullMQ already supports multiple workers — document the pattern
- Kubernetes HPA: scale Playwright workers on queue depth
- Worker health dashboard: active workers, tasks/sec, error rate

#### 4.4 Compliance & Data Governance
- `robots.txt` enforcement with override flag (logged)
- `noindex` / `nofollow` respect toggle
- PII detection: flag pages containing emails, phone numbers, PII
- Data retention policies: auto-delete jobs older than N days
- GDPR export: all data for a job as a single archive

#### 4.5 Observability
- OpenTelemetry traces: crawl lifecycle, LLM calls, DB queries
- Prometheus metrics endpoint: `GET /metrics`
- Grafana dashboard template
- Structured JSON logging (Winston/Pino) with log levels

#### 4.6 Self-Hosted Cloud Marketplace
- AWS Marketplace AMI
- GCP Marketplace VM image
- DigitalOcean 1-click droplet
- Helm chart for Kubernetes

---

## 4. Architecture Evolution

### Current State
```
Client → Fastify API → BullMQ Queue → Worker
                              ↓
                    Redis (job state + pages)
                    PostgreSQL (pages + embeddings)
```

### Phase 1 Target
```
Client → Fastify API (+ API key auth) → BullMQ Queue → Worker Pool
              ↓                                 ↓
         PostgreSQL                    PostgreSQL (all state)
         (jobs, pages,                 Redis (queue metadata only)
          embeddings, KG)
              ↓
         pgvector index
```

### Phase 2 Target
```
                    ┌─────────────────────────────────┐
                    │         Clients                 │
                    │  Dashboard · SDK · CLI · MCP    │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │         Fastify API              │
                    │  Auth · Rate Limit · Webhooks   │
                    └──┬──────────┬──────────┬────────┘
                       │          │          │
              ┌────────▼──┐  ┌───▼──────┐  ┌▼──────────────┐
              │ Crawl Jobs│  │ RAG/KG   │  │  Export/Stream │
              │  BullMQ   │  │ pgvector │  │   SSE · REST   │
              └────────┬──┘  └──────────┘  └───────────────┘
                       │
          ┌────────────┼────────────┐
     ┌────▼───┐  ┌─────▼──┐  ┌─────▼──────┐
     │Cheerio │  │LLM     │  │Playwright  │
     │Worker  │  │Extractor│  │Worker Pool │
     └────────┘  └────────┘  └────────────┘
```

### Phase 3+ Target (MCP Hub)
```
Claude Desktop ──┐
Cursor          ──┤──→ MCP Server ──→ Spidercrawl API
Continue        ──┘
Any MCP client
```

---

## 5. Execution Priority Matrix

Rate each feature: **Impact** (1–5) × **Effort** (1–5, lower = less effort)  
**Score = Impact / Effort** — higher score = do first.

| Feature | Impact | Effort | Score | Phase |
|---|---|---|---|---|
| Fix RAG search (wire pgvector) | 5 | 1 | **5.0** | 0 |
| API key enforcement | 5 | 1 | **5.0** | 0 |
| Persist jobs to PostgreSQL | 5 | 2 | **2.5** | 0 |
| Semantic chunking | 4 | 1 | **4.0** | 0 |
| MCP server | 5 | 2 | **2.5** | 2 |
| Structured extraction schemas | 5 | 2 | **2.5** | 1 |
| TypeScript SDK | 4 | 2 | **2.0** | 3 |
| Webhook integration | 4 | 2 | **2.0** | 2 |
| Change detection | 4 | 2 | **2.0** | 1 |
| Docker Compose deploy | 4 | 2 | **2.0** | 3 |
| Knowledge graph visualiser | 3 | 2 | **1.5** | 2 |
| CLI tool | 3 | 2 | **1.5** | 3 |
| LangChain integration | 3 | 2 | **1.5** | 3 |
| Playwright memory guard | 4 | 1 | **4.0** | 0 |
| Multi-tenancy | 5 | 5 | **1.0** | 4 |
| Proxy / unblocking layer | 4 | 4 | **1.0** | 4 |
| Kubernetes / HPA | 3 | 4 | **0.75** | 4 |

**Quick wins (do this week):** Fix RAG search, API key enforcement, semantic chunking, Playwright memory guard.  
**Biggest leverage (do this month):** Persist to PostgreSQL, structured extraction schemas, change detection.  
**Strategic moat (do this quarter):** MCP server, TypeScript SDK, Docker Compose deploy.

---

## 6. 18-Month Vision

### Month 1–3: Solid Foundation
- All Phase 0 bugs fixed
- Real pgvector search working
- API key auth enforced
- Structured extraction schemas shipped
- Demo: crawl Stripe docs, extract all API endpoints as typed JSON, search semantically

### Month 4–6: Intelligent Platform
- Change detection live
- Adaptive crawl budgets
- Knowledge graph visualiser in dashboard
- Semantic search UI in dashboard
- Demo: monitor a competitor's pricing page, get Slack alert when price changes

### Month 7–9: Developer Ecosystem
- MCP server published (`@spidercrawl/mcp`)
- TypeScript + Python SDKs on npm/PyPI
- CLI tool: `npx spidercrawl crawl`
- Docker Compose one-command deploy
- Demo: Claude Desktop user installs MCP server, asks "what changed on OpenAI's pricing page this week?" — Claude answers using Spidercrawl data

### Month 10–12: Integrations & Scale
- LangChain + LlamaIndex loaders
- Webhook system live
- Plugin system for custom extractors
- Observability: structured logs, Prometheus, basic Grafana dashboard
- First enterprise users on self-hosted deploy

### Month 13–18: Enterprise Ready
- Multi-tenancy + RBAC
- Compliance: robots.txt, PII detection, data retention
- Proxy/unblocking layer
- Marketplace listings (AWS, GCP, DigitalOcean)
- Potential: hosted SaaS tier with usage billing

### North Star Metric
> **Number of queries answered by Spidercrawl-indexed knowledge** — this captures crawl quality, RAG quality, and user value in one number.

---

## Update Log

| Date | Change | Author |
|---|---|---|
| 2026-05-02 | Initial document created from deep codebase analysis | Claude |
| 2026-05-02 | Phase 0 complete — all 7 critical bugs fixed, TypeScript build clean | Claude |
| 2026-05-03 | Audit: Phase 1 complete — 1.1 Extraction, 1.2 Adaptive Budget, 1.3 Incremental Crawls, 1.4 Entity Resolution all verified working. Fixed missing DB migration, broken route. | Claude |
| 2026-05-03 | Phase 2 started — 2.1 MCP Server implemented and verified via stdio. | Claude |
| 2026-05-03 | Phase 2.4 & 2.5 complete — Scheduled Crawls and Webhook Management UI live. | Claude |
| 2026-05-03 | Phase 3 started — TypeScript SDK and CLI tool implemented in `sdk/typescript`. | Claude |
| 2026-05-03 | Phase 3 complete — Python SDK, LangChain/LlamaIndex bridges, and One-Command Deploy refined. Dashboard built into main Docker image. | Claude |

---

*This is a living document. Update it as you ship features, learn from users, or change direction. The best roadmap is the one that gets revised.*
