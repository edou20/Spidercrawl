# Configuration

Spidercrawl reads **environment variables** from the process environment. Locally, `npm run dev` loads a root **`.env`** via `dotenv`.

## Source of truth

- **`.env.example`** — every variable with short comments (copy to `.env` and edit).
- **[README](https://github.com/edou20/Spidercrawl/blob/main/README.md)** — full **Environment variables** table and operational notes.

## Common setups

| Goal | Variables to set |
| --- | --- |
| Minimal local API | `PORT`, `REDIS_HOST`, `REDIS_PORT` |
| Persisted jobs + Ask AI context | Add `DATABASE_URL` (Postgres) |
| OpenAI or OpenRouter | `OPENAI_API_KEY`; for OpenRouter also `OPENAI_BASE_URL`, `OPENAI_CHAT_MODEL` (see `.env.example`) |
| Gemini | `GOOGLE_AI_API_KEY` (takes priority over OpenAI path if both are set) |
| Lock down HTTP API | `REQUIRE_API_KEY=true` |
| Browser rendering | Python worker + `WORKER_HOST` / `WORKER_PORT` or `WORKER_URL` |
| Managed Redis URL (Railway, etc.) | `REDIS_URL` (overrides host/port/password when set) |
| Self-serve signup + billing | `DATABASE_URL`, `APP_URL`, Resend + Stripe vars, quotas — see **[LAUNCH_GUIDE](./LAUNCH_GUIDE.md)** |

## Dashboard dev server

Vite defaults to proxying API calls to port **3200**. Override with:

```bash
VITE_BACKEND_URL=https://your-api.example.com npm run dashboard:dev
```

See **[Hosted deployment](./deployment-hosted.md)** for production URLs and split frontend/API.
