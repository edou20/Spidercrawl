import { z } from "zod";

// ─── Scrape Request ──────────────────────────────────────────────
export const ScrapeRequestSchema = z.object({
  url: z.string().url("Must be a valid URL"),
  formats: z
    .array(z.enum(["markdown", "html", "json", "screenshot"]))
    .default(["markdown"]),
  waitFor: z.number().int().min(0).max(30000).optional(),
  headers: z.record(z.string()).optional(),
  includeTags: z.array(z.string()).optional(),
  excludeTags: z.array(z.string()).optional(),
  extractSchema: z.record(z.unknown()).optional(),
  extractPrompt: z.string().optional(), // Natural language extraction
  enableVision: z.boolean().default(false), // Phase 2: Vision LLM
  useBrowser: z.boolean().default(false), // Phase 3: Playwright JS rendering
  proxyUrl: z.string().url().optional(), // Phase 3: Proxy support
  timeout: z.number().int().min(1000).max(120000).default(30000),
  previousHash: z.string().optional(), // Phase 1.3: Incremental hash
});

export type ScrapeRequest = z.infer<typeof ScrapeRequestSchema>;

// ─── Crawl Request ───────────────────────────────────────────────
export const CrawlRequestSchema = z.object({
  url: z.string().url("Must be a valid URL"),
  maxDepth: z.number().int().min(1).max(100).default(3),
  maxPages: z.number().int().min(1).max(10000).default(50),
  formats: z
    .array(z.enum(["markdown", "html", "json", "screenshot"]))
    .default(["markdown"]),
  includePatterns: z.array(z.string()).optional(),
  excludePatterns: z.array(z.string()).optional(),
  goal: z.string().optional(),

  // Phase 1.1: Per-page structured extraction applied to every crawled page
  extractionSchema: z.record(z.unknown()).optional(),
  extractionPrompt: z.string().optional(),

  // Phase 1.4: Named Entity Resolution (LLM-intensive)
  enableEntities: z.boolean().default(false),

  // Phase 1.2: Adaptive budget — stop when rolling relevance drops below threshold
  adaptiveBudget: z.boolean().default(false),
  satisfactionThreshold: z.number().min(0).max(1).default(0.3),

  // Phase 1.3: Incremental re-crawl — base this job on a previous one,
  //            skip pages whose content hash hasn't changed
  rerunJobId: z.string().optional(),

  waitFor: z.number().int().min(0).max(30000).optional(),
  timeout: z.number().int().min(1000).max(600000).default(120000),
});

export type CrawlRequest = z.infer<typeof CrawlRequestSchema>;

// ─── Map Request ─────────────────────────────────────────────────
export const MapRequestSchema = z.object({
  url: z.string().url("Must be a valid URL"),
  maxDepth: z.number().int().min(1).max(50).default(3),
  includePatterns: z.array(z.string()).optional(),
  excludePatterns: z.array(z.string()).optional(),
});

export type MapRequest = z.infer<typeof MapRequestSchema>;

// ─── Shared Result Types ─────────────────────────────────────────
export interface PageResult {
  url: string;
  statusCode: number;
  title: string;
  markdown?: string;
  html?: string;
  json?: Record<string, unknown>;
  screenshot?: string; // base64
  tables?: Array<{
    caption?: string;
    headers: string[];
    rows: string[][];
  }>;
  extractedData?: Record<string, unknown>; // Phase 2: structured extraction
  imageDescriptions?: Array<{
    src: string;
    alt: string;
    description: string;
    type: string;
    confidence: number;
  }>; // Phase 2: vision descriptions
  metadata: {
    description?: string;
    language?: string;
    ogImage?: string;
    crawledAt: string;
    elapsedMs: number;
    aiTokensUsed?: number; // Phase 2: track AI cost
  };
  contentHash?: string; // Phase 1.3
  unchanged?: boolean;  // Phase 1.3
  links: string[];      // Phase 1.0 discovered links
}

export interface JobStatus {
  id: string;
  orgId?: string;
  rootUrl: string;
  goal?: string;
  maxDepth: number;
  maxPages: number;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number; // 0-100
  totalPages: number;
  completedPages: number;
  results: PageResult[];
  error?: string;
  createdAt: string;
  updatedAt: string;

  // crawl format config (echoed from request)
  formats?: Array<"markdown" | "html" | "json" | "screenshot">;
  // Phase 1.1: extraction stats
  extractedCount?: number;   // pages with successful structured extraction
  extractionPrompt?: string;
  extractionSchema?: Record<string, unknown>;
  enableEntities?: boolean;
  // Phase 1.2: adaptive budget
  adaptiveBudget?: boolean;
  satisfactionThreshold?: number;
  satisfactionScore?: number; // rolling avg relevance (0-1); set when adaptiveBudget=true
  // Phase 1.3: change detection
  changedPages?: number;      // pages that changed vs. rerunJobId
  skippedPages?: number;      // pages skipped (unchanged vs. rerunJobId)
}

// ─── Entity (Phase 1.4) ──────────────────────────────────────────
export interface Entity {
  id: string;
  jobId: string;
  name: string;
  type: string;
  description?: string;
  aliases: string[];
  sourceUrls: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
}

// ─── Search (RAG / keyword) ────────────────────────────────────
export interface SearchHit {
  url: string;
  title: string;
  content: string;
  similarity: number;
  searchType: "vector" | "keyword" | "hybrid";
  description?: string;
  entityType?: string;
  matchedTerms: string[];
  provenance: {
    chunkIndex?: number;
    depth?: number;
    statusCode?: number;
    crawledAt?: string;
    imageCount?: number;
  };
  scoreBreakdown?: {
    keyword?: number;
    vector?: number;
    rerank?: number;
  };
  job?: {
    id: string;
    rootUrl: string;
    goal?: string;
  };
}

// ─── Schedule (Phase 2.4) ─────────────────────────────────────────
export const ScheduleRequestSchema = z.object({
  name: z.string().min(1, "Name is required"),
  cron: z.string().min(1, "Cron expression is required"),
  active: z.boolean().default(true),
  // Embed a full crawl request
  crawlRequest: CrawlRequestSchema,
});

export type ScheduleRequest = z.infer<typeof ScheduleRequestSchema>;

export interface Schedule {
  id: string;
  name: string;
  url: string;
  goal?: string;
  maxDepth: number;
  maxPages: number;
  cron: string;
  extractionSchema?: Record<string, unknown>;
  extractionPrompt?: string;
  adaptiveBudget: boolean;
  satisfactionThreshold: number;
  active: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
  updatedAt: string;
}

// ─── Fastify Extensions ──────────────────────────────────────────
declare module "fastify" {
  interface FastifyRequest {
    orgId?: string;
  }
}
