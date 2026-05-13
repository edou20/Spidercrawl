import { joinApiUrl, resolveApiBaseUrl } from "./api-base";

export interface JobRow {
  id: string;
  rootUrl: string;
  status: string;
  goal?: string;
  maxDepth?: number;
  maxPages?: number;
  formats?: string[];
  totalPages: number;
  completedPages: number;
  progress: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
  changedPages?: number;
  skippedPages?: number;
  satisfactionScore?: number;
  adaptiveBudget?: boolean;
  satisfactionThreshold?: number;
  enableEntities?: boolean;
  extractionPrompt?: string;
  extractionSchema?: any;
}

export interface Stats {
  totalJobs: number;
  activeJobs: number;
  completedJobs: number;
  failedJobs: number;
  totalPages: number;
  aiAvailable: boolean;
}

export interface PageRow {
  id: string;
  url: string;
  title: string;
  statusCode: number;
  depth: number | null;
  entityType?: string;
  markdown?: string;
  html?: string;
  markdownPreview?: string;
  tableCount?: number;
  metadata: any;
  crawledAt: string;
  // Full detail fields (only populated by getPageDetail)
  extractedData?: any;
  tables?: Array<{ headers: string[]; rows: string[][] }>;
  imageDescriptions?: Array<{ src: string; alt: string; description: string; type: string; confidence: number }>;
  links?: string[];
}

export interface SystemHealth {
  api: boolean;
  db: boolean;
  redis: boolean;
  worker: boolean;
  ai: boolean;
  /** When set, chat uses this backend (e.g. openrouter vs api.openai.com). */
  activeProvider?: string | null;
  openAi?: { gateway: string; chatModel: string };
  lastWorkerError?: string;
}

export interface EntityRow {
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

export interface ApiKey {
  id: string;
  name: string;
  prefix?: string;
  key?: string;
  createdAt: string;
}

export interface ScheduleRow {
  id: string;
  name: string;
  url: string;
  goal?: string;
  cron: string;
  active: boolean;
  lastRunAt?: string;
  nextRunAt?: string;
  createdAt: string;
}

export interface WebhookRow {
  id: string;
  event: string;
  url: string;
  hasSecret: boolean;
  createdAt: string;
}

export interface CreatedWebhookRow extends WebhookRow {
  secret?: string;
}

/**
 * Helper to get the API key from local storage.
 */
export function getStoredApiKey(): string | null {
  return localStorage.getItem("spidercrawl_api_key");
}

export function setStoredApiKey(key: string | null) {
  if (key) localStorage.setItem("spidercrawl_api_key", key);
  else localStorage.removeItem("spidercrawl_api_key");
}

const API_BASE = resolveApiBaseUrl(
  typeof window !== "undefined" ? window.location.origin : "http://localhost:3200",
  import.meta.env.VITE_BACKEND_URL
);

function withAuthHeaders(options: RequestInit = {}): HeadersInit {
  const apiKey = getStoredApiKey();
  return {
    ...(options.headers as any),
    ...(apiKey ? { "Authorization": `Bearer ${apiKey}` } : {}),
  };
}

async function request(path: string, options: RequestInit = {}) {
  const res = await fetch(joinApiUrl(API_BASE, path), { ...options, headers: withAuthHeaders(options) });

  if (res.status === 401) {
    setStoredApiKey(null);
    throw new Error("Authentication failed. Please check your API key.");
  }
  if (!res.ok) {
    throw new Error(await readErrorMessage(res));
  }
  return res;
}

async function readErrorMessage(res: Response) {
  if (res.headers.get("content-type")?.includes("application/json")) {
    const body = await res.json().catch(() => null);
    return body?.error || `Request failed with ${res.status}`;
  }
  return (await res.text()) || `Request failed with ${res.status}`;
}

async function fetchApi<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await request(path, options);

  if (res.headers.get("content-type")?.includes("application/json")) {
    const data = await res.json();
    if (!data.success) {
      throw new Error(data.error || "API Request failed");
    }
    return data.data;
  }
  
  return res.text() as Promise<T>;
}

async function fetchText(path: string, options: RequestInit = {}): Promise<string> {
  return (await request(path, options)).text();
}

export async function listJobs(): Promise<JobRow[]> {
  const raw = await fetchApi("/v1/jobs");
  return raw.map((j: any) => ({
    id: j.id,
    rootUrl: j.rootUrl,
    status: j.status,
    goal: j.goal,
    maxDepth: j.maxDepth,
    maxPages: j.maxPages,
    totalPages: j.totalPages,
    completedPages: j.completedPages,
    progress: j.progress,
    error: j.error,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
    changedPages: j.changedPages,
    skippedPages: j.skippedPages,
    satisfactionScore: j.satisfactionScore,
  }));
}

export async function getStats(): Promise<Stats> {
  return fetchApi("/v1/stats");
}

export async function deleteJob(id: string): Promise<void> {
  await fetchApi(`/v1/jobs/${id}`, { method: "DELETE" });
}

export async function retryJob(id: string): Promise<void> {
  await fetchApi(`/v1/jobs/${id}/retry`, { method: "POST" });
}

export async function getJobStatus(id: string): Promise<JobRow> {
  const j = await fetchApi(`/v1/crawl/${id}`);
  return {
    id: j.id,
    rootUrl: j.rootUrl,
    status: j.status,
    goal: j.goal,
    maxDepth: j.maxDepth,
    maxPages: j.maxPages,
    formats: Array.isArray(j.formats) ? j.formats : undefined,
    totalPages: j.totalPages,
    completedPages: j.completedPages,
    progress: j.progress,
    error: j.error,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
    changedPages: j.changedPages,
    skippedPages: j.skippedPages,
    satisfactionScore: j.satisfactionScore,
    adaptiveBudget: j.adaptiveBudget,
    satisfactionThreshold: j.satisfactionThreshold,
    enableEntities: j.enableEntities,
    extractionPrompt: j.extractionPrompt,
    extractionSchema: j.extractionSchema,
  };
}

export async function getJobPages(id: string): Promise<PageRow[]> {
  const raw = await fetchApi(`/v1/jobs/${id}/pages`);
  return raw.map((p: any) => ({
    id: p.id,
    url: p.url,
    title: p.title,
    statusCode: p.statusCode,
    depth: p.depth,
    entityType: p.entityType,
    tableCount: p.tableCount,
    markdownPreview: p.markdownPreview,
    metadata: p.metadata,
    crawledAt: p.crawledAt,
  }));
}

export async function getPageDetail(jobId: string, url: string): Promise<PageRow> {
  const encodedUrl = encodeURIComponent(url);
  const raw = await fetchApi(`/v1/jobs/${jobId}/pages/${encodedUrl}`);
  const jsonData = raw.jsonData;
  return {
    id: raw.id,
    url: raw.url,
    title: raw.title,
    statusCode: raw.statusCode,
    depth: raw.depth,
    markdown: raw.markdown,
    html: raw.html,
    metadata: raw.metadata,
    crawledAt: raw.crawledAt,
    extractedData: raw.extractedData ?? undefined,
    tables: jsonData?.tables ?? undefined,
    imageDescriptions: raw.imageDescriptions ?? undefined,
    links: Array.isArray(raw.links) ? raw.links : [],
  };
}

export async function getSystemHealth(): Promise<SystemHealth> {
  return fetchApi("/v1/system/health");
}

export async function getJobEntities(id: string): Promise<EntityRow[]> {
  return fetchApi(`/v1/jobs/${id}/entities`);
}

export async function rerunJobEntities(
  id: string
): Promise<{ pagesProcessed: number; entitiesFound: number; entitiesAfterMerge: number }> {
  return fetchApi(`/v1/jobs/${id}/entities/rerun`, { method: "POST" });
}

export async function getJobLinks(id: string): Promise<Array<{ from: string; to: string }>> {
  return fetchApi(`/v1/jobs/${id}/links`);
}

export async function searchRag(jobId: string, query: string, limit?: number): Promise<SearchHit[]> {
  const hits = await fetchApi<SearchHit[]>(`/v1/export/rag/${jobId}/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit }),
  });
  return hits.map((hit) => ({
    ...hit,
    matchedTerms: hit.matchedTerms ?? [],
    provenance: hit.provenance ?? {},
  }));
}

export async function exportRag(jobId: string): Promise<any> {
  return fetchApi(`/v1/export/rag/${jobId}`);
}

export async function searchAllJobs(query: string, limit?: number): Promise<SearchHit[]> {
  const hits = await fetchApi<SearchHit[]>("/v1/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, limit }),
  });
  return hits.map((hit) => ({
    ...hit,
    matchedTerms: hit.matchedTerms ?? [],
    provenance: hit.provenance ?? {},
  }));
}

export async function exportJobAsCsv(id: string): Promise<string> {
  return fetchText(`/v1/export/csv/${id}`);
}

export async function exportJobAsJson(id: string): Promise<any> {
  return fetchApi(`/v1/export/json/${id}`);
}

export async function exportJobAsJsonl(id: string): Promise<string> {
  return fetchText(`/v1/export/jsonl/${id}`);
}

export async function exportJobAsFineTuneJsonl(id: string): Promise<string> {
  return fetchText(`/v1/export/fine-tune-jsonl/${id}`);
}

export async function startCrawl(data: any): Promise<{ id: string }> {
  return fetchApi("/v1/crawl", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function listApiKeys(): Promise<ApiKey[]> {
  return fetchApi("/v1/apikeys");
}

export async function createApiKey(name: string): Promise<ApiKey> {
  return fetchApi("/v1/apikeys", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export async function revokeApiKey(id: string): Promise<void> {
  await fetchApi(`/v1/apikeys/${id}`, { method: "DELETE" });
}

export async function listSchedules(): Promise<ScheduleRow[]> {
  return fetchApi("/v1/schedules");
}

export async function createSchedule(data: any): Promise<ScheduleRow> {
  return fetchApi("/v1/schedules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function toggleSchedule(id: string, active: boolean): Promise<void> {
  await fetchApi(`/v1/schedules/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active }),
  });
}

export async function deleteSchedule(id: string): Promise<void> {
  await fetchApi(`/v1/schedules/${id}`, { method: "DELETE" });
}

export async function listWebhooks(): Promise<WebhookRow[]> {
  return fetchApi("/v1/webhooks");
}

export async function createWebhook(data: any): Promise<CreatedWebhookRow> {
  return fetchApi("/v1/webhooks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function deleteWebhook(id: string): Promise<void> {
  await fetchApi(`/v1/webhooks/${id}`, { method: "DELETE" });
}

export async function testExtraction(
  url: string,
  schema?: Record<string, unknown>,
  prompt?: string,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = { url };
  if (schema) body.schema = schema;
  else if (prompt) body.prompt = prompt;
  return fetchApi("/v1/extract", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

export interface CrawlEvent {
  id?: string;
  jobId: string;
  type: string;
  url?: string;
  data: Record<string, unknown>;
  ts: string;
}

export async function getJobEvents(jobId: string, limit = 500): Promise<CrawlEvent[]> {
  const raw = await fetchApi(`/v1/jobs/${jobId}/events?limit=${limit}`);
  return (raw as any[]).map((e: any) => ({
    id: e.id,
    jobId: e.jobId,
    type: e.type ?? e.eventType,
    url: e.url ?? undefined,
    data: e.data ?? {},
    ts: e.ts ?? e.createdAt,
  }));
}

export async function getJobSummary(jobId: string): Promise<{ summary: string; cached: boolean }> {
  return fetchApi(`/v1/jobs/${jobId}/summary`);
}

export async function askJob(
  jobId: string,
  question: string,
  limit = 5
): Promise<{ answer: string; sources: string[] }> {
  return fetchApi(`/v1/jobs/${jobId}/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question, limit }),
  });
}

export async function rerunJobExtraction(
  jobId: string,
  prompt: string,
): Promise<{ processed: number; extracted: number; failed: number; failures: Array<{ url: string; error: string }> }> {
  return fetchApi(`/v1/jobs/${jobId}/extraction/rerun`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
}

export async function getJobExtractedData(
  jobId: string,
  limit = 50
): Promise<Array<{ url: string; extractedData: any }>> {
  const res = await fetchApi(`/v1/jobs/${jobId}/extracted?limit=${limit}`);
  return Array.isArray(res) ? res : [];
}

export interface OrgBilling {
  id: string;
  name: string;
  slug: string;
  plan: string;
  pagesUsed: number;
  pagesQuota: number;
  stripeCustomerId: string | null;
}

export async function getOrgBilling(): Promise<OrgBilling> {
  const raw = await fetchApi("/auth/me");
  return {
    id: raw.id,
    name: raw.name,
    slug: raw.slug,
    plan: raw.plan,
    pagesUsed: raw.pages_used ?? raw.pagesUsed ?? 0,
    pagesQuota: raw.pages_quota ?? raw.pagesQuota ?? 0,
    stripeCustomerId: raw.stripe_customer_id ?? raw.stripeCustomerId ?? null,
  };
}

export async function startCheckout(plan: "starter" | "pro"): Promise<string> {
  const res = await fetchApi("/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
  });
  return res.url;
}

export async function getBillingPortalUrl(): Promise<string> {
  const res = await fetchApi("/billing/portal", { method: "POST" });
  return res.url;
}
