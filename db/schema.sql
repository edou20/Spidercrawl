CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Multi-tenancy (Phase 4.1) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS organizations (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  key           TEXT NOT NULL UNIQUE,
  last_used_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS api_keys_org_idx ON api_keys (org_id);
CREATE INDEX IF NOT EXISTS api_keys_lookup_idx ON api_keys (key);

-- ── Core Domain ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS jobs (
  id            TEXT PRIMARY KEY,
  org_id        UUID REFERENCES organizations(id) ON DELETE SET NULL, -- Null for legacy or public jobs
  root_url      TEXT NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('queued','processing','completed','failed')),
  goal          TEXT,
  satisfaction_score FLOAT,
  max_depth     INT  NOT NULL,
  max_pages     INT  NOT NULL,
  total_pages   INT  NOT NULL DEFAULT 0,
  completed_pages INT NOT NULL DEFAULT 0,
  changed_pages   INT,
  skipped_pages   INT,
  progress      INT  NOT NULL DEFAULT 0,
  error         TEXT,
  request       JSONB NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS jobs_status_created_idx ON jobs (status, created_at DESC);

CREATE TABLE IF NOT EXISTS pages (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  url           TEXT NOT NULL,
  title         TEXT,
  status_code   INT,
  depth         INT NOT NULL DEFAULT 0,
  markdown      TEXT,
  html          TEXT,
  json_data     JSONB,
  extracted_data JSONB,
  image_descriptions JSONB,
  links         JSONB,
  metadata      JSONB,
  jsonld        JSONB,
  entity_type   TEXT,
  content_hash  TEXT,         -- SHA-256 of markdown (change detection)
  crawled_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, url)
);

CREATE INDEX IF NOT EXISTS pages_job_idx    ON pages (job_id);
CREATE INDEX IF NOT EXISTS pages_url_idx    ON pages (url);
CREATE INDEX IF NOT EXISTS pages_entity_idx ON pages (entity_type);
CREATE INDEX IF NOT EXISTS pages_hash_idx   ON pages (content_hash);

CREATE TABLE IF NOT EXISTS page_links (
  from_page_id  UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  to_url        TEXT NOT NULL,
  PRIMARY KEY (from_page_id, to_url)
);

-- Vector store for RAG export (1536 dims = text-embedding-3-small)
CREATE TABLE IF NOT EXISTS embeddings (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id        TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  page_id       UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  chunk_index   INT NOT NULL,
  content       TEXT NOT NULL,
  embedding     vector(1536),
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS embeddings_job_idx ON embeddings (job_id);
CREATE INDEX IF NOT EXISTS embeddings_vector_idx
  ON embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ── Entities (Phase 1: entity resolution across pages) ─────────────────
-- Stores canonical named entities extracted and de-duplicated across a job.
CREATE TABLE IF NOT EXISTS entities (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,            -- canonical display name
  type        TEXT NOT NULL,            -- Person, Organisation, Product, Concept, Location, etc.
  description TEXT,
  aliases     JSONB NOT NULL DEFAULT '[]',    -- alternate names found across pages
  source_urls JSONB NOT NULL DEFAULT '[]',    -- pages where this entity appears
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (job_id, name, type)
);

CREATE INDEX IF NOT EXISTS entities_job_idx  ON entities (job_id);
CREATE INDEX IF NOT EXISTS entities_type_idx ON entities (job_id, type);

-- ── Schedules (Phase 2: Recurring Jobs) ─────────────────────────────────
CREATE TABLE IF NOT EXISTS schedules (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    goal TEXT,
    max_depth INTEGER DEFAULT 3,
    max_pages INTEGER DEFAULT 100,
    cron TEXT NOT NULL,
    extraction_schema JSONB,
    extraction_prompt TEXT,
    adaptive_budget BOOLEAN DEFAULT FALSE,
    satisfaction_threshold FLOAT DEFAULT 0.3,
    active BOOLEAN DEFAULT TRUE,
    last_run_at TIMESTAMP WITH TIME ZONE,
    next_run_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS schedules_active_idx ON schedules (active);

-- ── Webhooks (Phase 2.5) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhooks (
    id         TEXT PRIMARY KEY,
    org_id     UUID REFERENCES organizations(id) ON DELETE CASCADE,
    event      TEXT NOT NULL,
    url        TEXT NOT NULL,
    secret     TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS webhooks_event_idx ON webhooks (event);
