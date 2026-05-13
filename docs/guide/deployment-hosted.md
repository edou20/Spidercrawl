# Hosted deployment (Railway, Render, Fly.io, Vercel)

Spidercrawl is a **long-running Node.js service** with a **Redis-backed job queue** (BullMQ) and **PostgreSQL** for durable jobs, pages, and search. Plan hosting around that shape: one always-on API container (or VM), managed Redis, and managed Postgres.

## What fits where

| Platform | API + queue + DB | Notes |
| --- | --- | --- |
| **Railway** | Yes | One project: API service from `Dockerfile`, plus Railway Redis + Postgres (or Docker add-ons). Set env vars in the dashboard. |
| **Render** | Yes | **Web Service** for the API (`Dockerfile` root), **Key Value** (Redis) and **Postgres** instances; wire `REDIS_HOST`, `DATABASE_URL`, etc. |
| **Fly.io** | Yes | `fly launch` with the same `Dockerfile`; attach Fly Redis + Fly Postgres (or Upstash). |
| **Vercel** | **Not** the primary API | Vercel is serverless/short-lived HTTP: **no in-process BullMQ worker**, no long crawl loops, no guaranteed WebSocket/SSE behavior for production crawls. Use Vercel only for a **static dashboard** build that calls an API hosted elsewhere (`VITE_BACKEND_URL`). |

**Python Playwright worker** (`workers/`) is optional (browser rendering, screenshots). For hosted API-only, set `useBrowser: false` unless you also deploy the worker image and point `WORKER_HOST` / `WORKER_URL` at it.

## Recommended path: Docker image on Railway or Render

The repo root **`Dockerfile`** builds the dashboard and API and runs `node dist/index.js` on port **3200**.

1. **Provision Postgres** (with `pgvector` if you use embeddings — match `docker-compose` image locally, or enable the `vector` extension on your provider if supported).
2. **Provision Redis** and copy host, port, password.
3. **Deploy** the Git repository as a **Docker** web service, port **3200**.
4. **Set environment variables** (minimum):

| Variable | Purpose |
| --- | --- |
| `PORT` | `3200` (or your platform’s assigned `$PORT` — map if the platform injects a different port). |
| `HOST` | `0.0.0.0` so the process accepts external connections. |
| `DATABASE_URL` | Postgres connection string from the provider. |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | Redis connection (use the provider’s internal hostname in private networks). |
| `REDIS_URL` | **Optional but recommended on Railway-style hosts:** if set, it overrides `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` with a single connection URL. |
| `OPENAI_API_KEY` and/or `GOOGLE_AI_API_KEY` | AI features; for **OpenRouter** add `OPENAI_BASE_URL=https://openrouter.ai/api/v1` and `OPENAI_CHAT_MODEL` (see `.env.example`). |
| `REQUIRE_API_KEY` | Set to `true` on any public URL; create keys via `/v1/apikeys` after bootstrap, or use **`POST /auth/register`** for self-serve signup (see **[LAUNCH_GUIDE](./LAUNCH_GUIDE.md)**). |

5. **Health checks**: point HTTP health to `GET /health` or `GET /v1/system/health`.

6. **Landing page**: when `landing/index.html` is present in the image (Dockerfile copies `landing/`), **`GET /`** serves that static HTML before `/app/`.

7. **Dashboard**: after deploy, open **`https://<your-host>/app/`** — the API serves the built SPA from `dashboard/dist`.

### Auth, billing, and quotas (production SaaS-style)

Optional but typical for a public hosted instance:

| Variable | Purpose |
| --- | --- |
| `APP_URL` | Public base URL of this API (Stripe success/cancel URLs, email links). No trailing slash required. |
| `RESEND_API_KEY` / `FROM_EMAIL` | Welcome email after **`POST /auth/register`** (no-op if unset). |
| `STRIPE_SECRET_KEY` | Stripe server SDK for Checkout + webhooks. |
| `STRIPE_WEBHOOK_SECRET` | Verifies **`POST /billing/webhook`** signatures. |
| `STRIPE_PRICE_STARTER` / `STRIPE_PRICE_PRO` | Price IDs for **`POST /billing/checkout`** with JSON body `plan` set to `starter` or `pro`. |
| `PAGES_QUOTA_FREE` / `PAGES_QUOTA_STARTER` / `PAGES_QUOTA_PRO` | Default page quotas per plan tier (see `.env.example`). |
| `DATABASE_KEEPALIVE_MS` | Interval for a lightweight **`SELECT 1`** against Postgres (default 24h). Set `DISABLE_DATABASE_KEEPALIVE=true` to turn off. |

With **`REQUIRE_API_KEY=true`**, these paths stay **unauthenticated** so onboarding and billing work: **`/auth/register`**, **`/billing/webhook`**, plus **`/health`**, **`/v1/ai/status`**, and the first-time **`/v1/apikeys`** bootstrap rule. Everything else needs **`Authorization: Bearer sk-sc-…`**.

Configure Stripe’s webhook endpoint to **`https://<your-host>/billing/webhook`** (the server registers raw-body handling on that route only so signatures verify correctly).

Full operator checklist: **[LAUNCH_GUIDE](./LAUNCH_GUIDE.md)**.

### Separate dashboard origin (optional)

If you host the static UI on another domain (e.g. Vercel):

- Build with `VITE_BACKEND_URL=https://your-api.example.com` so browser calls go to the API.
- Tighten CORS on the API for production (today the server may use permissive defaults — review `src/api/server.ts` before going wide on the internet).

## Fly.io (outline)

- Create `fly.toml` with `internal_port = 3200` and deploy the same Docker image.
- Attach Fly Postgres + Upstash Redis (or Fly Redis); set the same env vars as above.
- Scale to at least one machine always on for the queue worker.

## Vercel: static dashboard only

1. Build: `npm run dashboard:build` with `VITE_BACKEND_URL` set to your **Railway/Render/Fly** API URL.
2. Deploy the `dashboard/dist` folder as a static site.
3. Never put database or Redis credentials in `VITE_*` vars — only public API base URL.

## Security checklist (production)

- `REQUIRE_API_KEY=true` and store dashboard keys in the UI (localStorage) or your SSO proxy.
- Do not commit `.env`; rotate keys if leaked.
- Prefer private networking between API ↔ Redis ↔ Postgres on the same platform.
- Restrict outbound crawling if you expose a public API (rate limits already exist — tune `API_RATE_LIMIT_MAX`).

## Local parity

For a single-machine stack identical to production shape:

```bash
docker compose up --build
```

See **`README.md`** for ports and **`DOCUMENTATION.md`** for architecture. This page covers hosted platforms; **[LAUNCH_GUIDE](./LAUNCH_GUIDE.md)** covers registration, Stripe, email, and quotas.
