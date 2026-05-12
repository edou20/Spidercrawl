# Spidercrawl — Monetization Plan
> Fastest path to first dollar. Total infrastructure cost before first paying customer: $5/mo.

---

## Pricing Tiers

| Plan | Price | Pages/month | Features |
|------|-------|-------------|---------|
| Free | $0 | 1,000 | API access, all export formats |
| Starter | $29/mo | 50,000 | + AI extraction, RAG search |
| Pro | $99/mo | 500,000 | + Vision, entity resolution, priority support |
| Enterprise | Custom | Unlimited | Self-hosted license + SLA |

---

## Infrastructure Stack (Researched May 2026)

### Verdict: Railway Hobby ($5/mo) + Vercel (you have it) + Supabase (free)

This is the stack. Here is why each decision was made.

---

### API + Worker + Redis — Railway Hobby ($5/mo flat)

**Why Railway over Fly.io:**
- Fly.io free tier is complex to set up (CLI-heavy, requires credit card, VMs need manual sizing)
- Fly.io real cost starts at ~$10.70/mo for a usable VM
- Railway Hobby at $5/mo includes $5 of compute credits — if usage stays under $5, your net bill is $5 flat
- Railway has built-in Redis and PostgreSQL plugins — everything in one dashboard
- GitHub integration: push to main → auto-deploy. No CLI required after setup
- Far better developer experience for a solo builder

**Why not Render:**
- Free tier spins down after inactivity (your API goes cold, first request takes 30–60s)
- $7/mo starter has no Redis included — you'd pay more total

**Railway gives you:**
- API server (Node.js/Fastify) — auto-detected, no Dockerfile needed
- Redis — add the Railway Redis plugin, get `REDIS_URL` instantly
- Auto-deploys from GitHub
- Built-in logs and metrics

**Cost:** $5/mo fixed until you scale past ~$50/mo usage

---

### PostgreSQL + pgvector — Supabase (Free)

**Why Supabase over Railway Postgres:**
- Supabase free tier includes pgvector — Railway Postgres does not have pgvector by default
- Supabase gives you a visual SQL editor, table browser, and instant REST API for free
- 500 MB storage — more than enough to validate

**One real limitation:** Supabase free projects pause after 7 days of zero database activity.
**Fix:** Add a daily ping from the Railway worker (one SQL query on a cron). Prevents pausing permanently with zero cost.

**Cost:** $0 until you need more than 500 MB or want no-pause guarantee ($25/mo Pro)

---

### Redis / Job Queue — Railway Redis Plugin (included in $5/mo)

**Why not Upstash free tier:**
- Upstash free tier is 500K commands/month — sounds like a lot
- BullMQ (what Spidercrawl uses) aggressively polls Redis even when idle
- A real crawl job generates thousands of Redis commands per minute
- Upstash themselves warn against using BullMQ on the free tier
- Upstash fixed plan that works for BullMQ starts at $10/mo — more expensive than Railway total

**Railway Redis is the right call:** included in your $5/mo Hobby plan, no polling limits, no surprises.

---

### Dashboard + Landing Page — Vercel (you already have it, $0)

Your Vercel account covers both:
- **Landing page** — one HTML file or simple Vite app, deploy in 5 minutes
- **Dashboard** (`dashboard/`) — builds to static files, Vercel serves it

Set one env var in Vercel: `VITE_BACKEND_URL=https://your-railway-api.up.railway.app`

---

### Payments — Stripe ($0 until first sale)

- No monthly fee
- 2.9% + $0.30 per transaction
- First $500 MRR = ~$15 in fees
- Stripe Checkout handles the payment UI — you build nothing

---

### Email — Resend (Free)

- 3,000 emails/month free, 100/day
- One call sends "here is your API key" on sign-up
- No credit card required

---

### DNS + SSL — Cloudflare (Free)

- Free DNS management, DDoS protection, SSL certificate
- Point your domain → Cloudflare → Railway API

---

## Full Cost Summary

| Service | Purpose | Cost |
|---------|---------|------|
| Railway Hobby | API server + worker + Redis | $5/mo |
| Supabase | PostgreSQL + pgvector | $0 |
| Vercel | Dashboard + landing page | $0 (you have it) |
| Cloudflare | DNS + SSL | $0 |
| Stripe | Payments | $0 (% per sale) |
| Resend | API key emails | $0 |
| Google Gemini | AI extraction | $0 (1,500 req/day free) |
| **Total** | | **$5/mo** |

**First customer at $29/mo = immediately profitable.**

---

## Build Plan — 3 Weeks to First Sale

### Week 1 — Deploy & Sign-up

**Day 1 — Schema + register endpoint**
```sql
ALTER TABLE organizations ADD COLUMN email TEXT UNIQUE;
ALTER TABLE organizations ADD COLUMN plan TEXT NOT NULL DEFAULT 'free';
ALTER TABLE organizations ADD COLUMN pages_used INT NOT NULL DEFAULT 0;
ALTER TABLE organizations ADD COLUMN period_reset_at TIMESTAMPTZ DEFAULT NOW();
```
Build `POST /auth/register` → creates org + API key → sends key via Resend email → returns key in response.

**Day 2 — Railway setup**
1. Create Railway account at railway.com
2. New project → Deploy from GitHub repo
3. Add Redis plugin (one click)
4. Set env vars: `DATABASE_URL` (from Supabase), `REDIS_URL` (from Railway), `GOOGLE_AI_API_KEY`
5. Railway gives you a public URL instantly

**Day 3 — Supabase setup**
1. Create Supabase project
2. Run `db/schema.sql` in Supabase SQL editor
3. Copy `DATABASE_URL` to Railway env vars
4. Add daily ping query to prevent pausing (one cron in the worker)

**Day 4 — Landing page on Vercel**
One HTML file with:
- Headline: "AI web crawling API. $29/mo for 50k pages."
- curl demo snippet
- Pricing table
- Email form → calls `POST /auth/register` on Railway → shows API key in page

Deploy: `vercel deploy` from a new `/landing` folder.

**Day 5 — End-to-end test**
Sign up → get key → make a crawl call → see results. Fix anything broken.

**Milestone:** Live URL, anyone can get an API key and crawl.

---

### Week 2 — Billing

**Day 6 — Stripe setup**
1. Create Stripe account
2. Create two prices: Starter $29/mo, Pro $99/mo
3. Add env vars to Railway: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`

**Day 7 — Stripe columns**
```sql
ALTER TABLE organizations ADD COLUMN stripe_customer_id TEXT;
ALTER TABLE organizations ADD COLUMN stripe_subscription_id TEXT;
```

**Day 8 — Billing endpoints**
- `POST /billing/checkout` → Stripe Checkout session → redirect URL
- `POST /billing/webhook` → handles `customer.subscription.updated` → updates `plan` column
- `GET /billing/portal` → Stripe Customer Portal URL

**Day 9 — Quota enforcement**
In orchestrator before starting crawl:
```
free:    1,000 pages → 429 with upgrade link
starter: 50,000 pages → 429 with upgrade link
pro:     500,000 pages → 429 with upgrade link
```
Increment `pages_used + 1` after each successful page crawl.

**Day 10 — Monthly reset**
Railway cron (or worker schedule): on 1st of month, reset `pages_used = 0` for all orgs.

**Milestone:** User hits limit → upgrades → pays → continues crawling automatically.

---

### Week 3 — Dashboard Billing UI + Launch

**Day 11–12 — Usage bar in Settings page**
```
Pages this month  ████████░░  800 / 1,000 (80%)
Plan: Free        [Upgrade to Starter →]
```
Upgrade button → calls `/billing/checkout` → redirects to Stripe.

**Day 13 — Upgrade warning banner**
When `pages_used > 80%`, show dismissable banner at top of dashboard.

**Day 14 — Write Show HN post**
Title options:
- "Show HN: Open-source AI web crawling API — self-hostable Firecrawl alternative"
- "Show HN: Spidercrawl – crawl any site, extract structured data, $29/mo or self-host free"

**Day 15 — Post**
Post on Tuesday or Wednesday morning (9am US Eastern = peak HN traffic).
Also post to: X/Twitter, Reddit (r/SideProject, r/selfhosted, r/MachineLearning), IndieHackers.

**Day 16–21 — Close first customers**
- Reply to every HN/Reddit comment personally
- DM anyone asking follow-up questions
- Offer free Starter trial to first 5 users who ask
- Find Firecrawl complaints on X: "anyone know a cheaper alternative to Firecrawl?" — reply with your link

---

## Revenue Model

| Month | Free | Starter ($29) | Pro ($99) | MRR | Cost | Profit |
|-------|------|--------------|----------|-----|------|--------|
| 1 | 150 | 10 | 2 | $488 | $5 | $483 |
| 2 | 400 | 25 | 5 | $1,220 | $15 | $1,205 |
| 3 | 800 | 60 | 15 | $3,225 | $40 | $3,185 |

Break-even: your very first Starter customer covers 6× your monthly infrastructure cost.

---

## Upgrade Path (when to spend more)

| Trigger | Action | New cost |
|---------|--------|---------|
| Supabase pausing becomes annoying | Supabase Pro | +$25/mo |
| Railway usage exceeds $5 credit | Pay Railway overage | ~$10–20/mo |
| 1,000+ users | Railway Pro ($20/mo) for better limits | +$15/mo |
| Need more DB storage | Supabase Pro | +$25/mo |

**Rule: don't upgrade any service until you have paying customers covering it.**

---

## What NOT to spend money on (ever, at this stage)

- A custom domain SSL cert (Cloudflare handles it free)
- Monitoring tools (Railway has built-in logs; add Sentry free tier later if needed)
- A design agency for the landing page (one HTML file converts fine)
- Ads (organic HN/Reddit traffic is free and better quality)
- Hiring anyone (build alone until $3k MRR)
