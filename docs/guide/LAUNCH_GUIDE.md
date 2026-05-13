# Hosted launch guide (auth, billing, quotas)

This guide matches the **optional** production features in the Node API: self-serve registration, Stripe subscriptions, Resend welcome mail, per-organization page quotas, managed Redis via URL, a static landing page at `/`, and a periodic Postgres keepalive.

For platform fit (Railway, Render, Fly, Vercel), start with **[Hosted deployment](./deployment-hosted.md)**.

## Prerequisites

- **PostgreSQL** with `DATABASE_URL` set (registration and org billing fields live in Postgres).
- **Redis** for BullMQ and for fast `apikey:lookup:*` mirrors. Prefer **`REDIS_URL`** on managed hosts; otherwise `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD`.
- **Docker** or equivalent running the root **`Dockerfile`**, which copies **`landing/`** into the image so **`GET /`** can serve `landing/index.html` when present.

Apply or migrate the schema so `organizations` includes billing columns (`email`, `plan`, Stripe ids, `pages_used`, `pages_quota`). The app’s migrate path aligns with **`db/schema.sql`** / **`src/lib/migrate.ts`**.

## Environment variables

See **`.env.example`** for defaults. Launch-relevant entries:

| Variable | Role |
| --- | --- |
| `APP_URL` | Public API base (Stripe redirect URLs, email links). Example: `https://api.example.com` |
| `RESEND_API_KEY` | Send welcome email via Resend; omit to skip mail. |
| `FROM_EMAIL` | Sender address Resend accepts for your domain. |
| `STRIPE_SECRET_KEY` | Server-side Stripe SDK. |
| `STRIPE_WEBHOOK_SECRET` | Verifies webhook signatures. |
| `STRIPE_PRICE_STARTER` / `STRIPE_PRICE_PRO` | Subscription **Price** IDs used by Checkout. |
| `PAGES_QUOTA_FREE` / `PAGES_QUOTA_STARTER` / `PAGES_QUOTA_PRO` | Default page quotas when plan tier is assigned. |
| `DATABASE_KEEPALIVE_MS` | Milliseconds between `SELECT 1` pings (default 24h). |
| `DISABLE_DATABASE_KEEPALIVE` | Set `true` to disable keepalive. |

## HTTP routes

### `POST /auth/register`

Public when `REQUIRE_API_KEY=true` (listed in server open routes).

JSON body:

```json
{ "name": "My Team", "email": "you@example.com" }
```

- **201** — Returns `orgId`, `slug`, and **`apiKey`** once (not retrievable later from this endpoint).
- **409** — Email (case-insensitive) already registered.
- **503** — Postgres not configured.

Registers the org, stores the key in Redis for lookups, and sends the welcome email when Resend is configured.

### `GET /auth/me`

Requires a resolvable organization: either the normal **`REQUIRE_API_KEY`** hook attached `orgId`, or **`Authorization: Bearer sk-sc-…`** with Redis/DB resolution.

Returns plan, `pagesUsed`, `pagesQuota`, Stripe customer id, etc.

### `POST /billing/checkout`

Authenticated the same way as **`/auth/me`**. Body:

```json
{ "plan": "starter" }
```

or `"pro"`. Requires `STRIPE_SECRET_KEY` and the matching `STRIPE_PRICE_*` env var. Response includes `{ "data": { "url": "…" } }` for the Stripe-hosted Checkout page.

### `POST /billing/webhook`

Stripe webhook URL: **`https://<your-host>/billing/webhook`**

- Public (no API key) when `REQUIRE_API_KEY=true`.
- Uses **raw body** verification for the `Stripe-Signature` header.

Handled events update org `plan`, subscription id, and quota; canceled/unpaid states can reset toward free tier (see `src/api/billing-routes.ts`).

## API key enforcement

When **`REQUIRE_API_KEY=true`**, unauthenticated paths include:

- `/health`
- `/v1/ai/status`
- `/auth/register`
- `/billing/webhook`
- First-time bootstrap: **`GET`/`POST /v1/apikeys`** when no keys exist yet in Redis

All other routes require **`Authorization: Bearer <api-key>`**.

## Usage metering

- Successful **persisted page** inserts during crawls increment **`pages_used`** for the job’s organization when `orgId` is known.
- **`POST /v1/crawl`** checks quota before starting; over quota returns **402** (payment required semantics) when an org is resolved.

## Stripe dashboard checklist

1. Create Products/Prices; copy Price IDs into `STRIPE_PRICE_STARTER` and `STRIPE_PRICE_PRO`.
2. Add webhook endpoint pointing at **`/billing/webhook`**; subscribe at least to customer subscription created/updated/deleted events.
3. Copy signing secret into `STRIPE_WEBHOOK_SECRET`.
4. Set `APP_URL` to the exact public origin customers use for return URLs.

## Static landing

Place marketing HTML at **`landing/index.html`**. The API serves it at **`GET /`** if the file exists. The dashboard remains at **`/app/`**.

## Verification

```bash
npm run verify
```

Or minimally: `npm run build`, `npm test -- --run`, `npm run dashboard:build`.
