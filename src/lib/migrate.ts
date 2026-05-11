/**
 * DB Migration Runner
 * ====================
 * Applies idempotent schema changes on startup so existing databases are
 * upgraded automatically without requiring manual SQL execution.
 *
 * Every statement uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS so it
 * is safe to run on both fresh and existing databases.
 */

import { getDb, isDbEnabled } from "./db.js";
import { logger } from "./logger.js";

export async function runMigrations(): Promise<void> {
  if (!isDbEnabled()) {
    logger.info("DATABASE_URL not set — skipping migrations");
    return;
  }

  const db = getDb();

  try {
    // ── Phase 1.1: Core Tables ────────────────────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS jobs (
        id                TEXT PRIMARY KEY,
        root_url          TEXT NOT NULL,
        status            TEXT NOT NULL,
        goal              TEXT,
        max_depth         INT NOT NULL DEFAULT 1,
        max_pages         INT NOT NULL DEFAULT 100,
        total_pages       INT NOT NULL DEFAULT 0,
        completed_pages   INT NOT NULL DEFAULT 0,
        progress          FLOAT NOT NULL DEFAULT 0,
        error             TEXT,
        extraction_prompt TEXT,
        extraction_schema JSONB,
        satisfaction_score FLOAT,
        created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS schedules (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name        TEXT NOT NULL,
        url         TEXT NOT NULL,
        cron        TEXT NOT NULL,
        goal        TEXT,
        max_depth   INT NOT NULL DEFAULT 1,
        max_pages   INT NOT NULL DEFAULT 100,
        active      BOOLEAN NOT NULL DEFAULT TRUE,
        last_run_at TIMESTAMPTZ,
        next_run_at TIMESTAMPTZ,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // ── Phase 1.2: pages table ────────────────────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS pages (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        url         TEXT NOT NULL,
        title       TEXT,
        status_code INT,
        depth       INT,
        markdown    TEXT,
        html        TEXT,
        metadata    JSONB NOT NULL DEFAULT '{}',
        crawled_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS pages_job_url_idx ON pages (job_id, url)`);

    // ── Phase 1.3: content hash for change detection ────────────
    await db.query(
      `ALTER TABLE pages ADD COLUMN IF NOT EXISTS content_hash TEXT`
    );
    await db.query(
      `CREATE INDEX IF NOT EXISTS pages_hash_idx ON pages (content_hash)`
    );

    // ── Phase 1.3: incremental crawl counters ─────────────────────
    await db.query(
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS changed_pages INT`
    );
    await db.query(
      `ALTER TABLE jobs ADD COLUMN IF NOT EXISTS skipped_pages INT`
    );

    // ── Phase 1.4: entities table for cross-page entity resolution ─
    await db.query(`
      CREATE TABLE IF NOT EXISTS entities (
        id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        job_id      TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        type        TEXT NOT NULL,
        description TEXT,
        aliases     JSONB NOT NULL DEFAULT '[]',
        source_urls JSONB NOT NULL DEFAULT '[]',
        metadata    JSONB NOT NULL DEFAULT '{}',
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(
      `CREATE INDEX IF NOT EXISTS entities_job_idx  ON entities (job_id)`
    );
    await db.query(
      `CREATE INDEX IF NOT EXISTS entities_type_idx ON entities (job_id, type)`
    );

    // ── Phase 2.5: webhook subscriptions ────────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS webhooks (
        id         TEXT PRIMARY KEY,
        event      TEXT NOT NULL,
        url        TEXT NOT NULL,
        secret     TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(
      `CREATE INDEX IF NOT EXISTS webhooks_event_idx ON webhooks (event)`
    );
    
    // ── Phase 4.1: Multi-tenancy ──────────────────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name          TEXT NOT NULL,
        slug          TEXT NOT NULL UNIQUE,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    
    await db.query(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        org_id        UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name          TEXT NOT NULL,
        key           TEXT NOT NULL UNIQUE,
        last_used_at  TIMESTAMPTZ,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE SET NULL`);
    await db.query(`ALTER TABLE schedules ADD COLUMN IF NOT EXISTS org_id UUID REFERENCES organizations(id) ON DELETE CASCADE`);

    // ── Phase 3 (diagnostics): crawl_events ──────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS crawl_events (
        id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        job_id     TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        url        TEXT,
        data       JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS crawl_events_job_idx ON crawl_events (job_id, created_at)`);

    // ── Pages: unique constraint for deduplication ────────────────
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS pages_job_url_unique ON pages (job_id, url)
    `);

    // ── Pages: json_data + extracted_data + image_descriptions ───
    await db.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS json_data JSONB`);
    await db.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS extracted_data JSONB`);
    await db.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS image_descriptions JSONB`);
    await db.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS links JSONB`);
    await db.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS jsonld JSONB`);
    await db.query(`ALTER TABLE pages ADD COLUMN IF NOT EXISTS entity_type TEXT`);

    // ── Jobs: additional columns ──────────────────────────────────
    await db.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS request JSONB`);
    await db.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS max_depth INT NOT NULL DEFAULT 3`);
    await db.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS max_pages INT NOT NULL DEFAULT 50`);

    // ── Entities: unique constraint ───────────────────────────────
    await db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS entities_job_name_type ON entities (job_id, name, type)
    `);

    // ── page_links table ──────────────────────────────────────────
    await db.query(`
      CREATE TABLE IF NOT EXISTS page_links (
        from_page_id UUID NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
        to_url       TEXT NOT NULL,
        PRIMARY KEY (from_page_id, to_url)
      )
    `);

    // ── Phase 1 (MCP/Answer): job summary cache ──────────────
    await db.query(`ALTER TABLE jobs ADD COLUMN IF NOT EXISTS summary TEXT`);

    logger.info("DB migrations applied");
  } catch (err: any) {
    // Non-fatal — log and continue. The app can run without new columns
    // (features degrade gracefully when columns are absent).
    logger.warn({ err: err.message }, "DB migration step failed (non-fatal)");
  }
}
