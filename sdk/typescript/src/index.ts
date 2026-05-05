/**
 * Official Spidercrawl TypeScript SDK
 * ===================================
 * 
 * Usage:
 * const sc = new SpidercrawlClient({ apiKey: 'sk-sc-...' });
 * const job = await sc.crawl('https://example.com', { goal: 'Find pricing' });
 */

export interface ClientOptions {
  apiKey?: string;
  baseUrl?: string;
}

export interface ScrapeOptions {
  formats?: ("markdown" | "html" | "json" | "screenshot")[];
  enableVision?: boolean;
  useBrowser?: boolean;
  timeout?: number;
}

export interface CrawlOptions extends ScrapeOptions {
  maxDepth?: number;
  maxPages?: number;
  goal?: string;
  extractionSchema?: Record<string, any>;
  extractionPrompt?: string;
  adaptiveBudget?: boolean;
  satisfactionThreshold?: number;
}

export interface JobStatus {
  id: string;
  rootUrl: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  totalPages: number;
  completedPages: number;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export class SpidercrawlClient {
  private apiKey: string | undefined;
  private baseUrl: string;

  constructor(options: ClientOptions = {}) {
    this.apiKey = options.apiKey || process?.env?.SPIDERCRAWL_API_KEY;
    this.baseUrl = (options.baseUrl || "http://localhost:3200").replace(/\/$/, "");
  }

  private async request(path: string, options: RequestInit = {}) {
    const url = `${this.baseUrl}${path}`;
    const headers = new Headers(options.headers);
    
    if (this.apiKey) {
      headers.set("Authorization", `Bearer ${this.apiKey}`);
    }
    
    if (options.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }

    const res = await fetch(url, { ...options, headers });
    
    if (!res.ok) {
      const errorData = await res.json().catch(() => ({ error: res.statusText }));
      throw new Error(errorData.error || `Request failed with status ${res.status}`);
    }

    const data = await res.json();
    if (data.success === false) {
      throw new Error(data.error || "API Request failed");
    }
    
    return data.data !== undefined ? data.data : data;
  }

  /**
   * Scrape a single URL.
   */
  async scrape(url: string, options: ScrapeOptions = {}) {
    return this.request("/v1/scrape", {
      method: "POST",
      body: JSON.stringify({ url, ...options }),
    });
  }

  /**
   * Start a crawl job.
   */
  async crawl(url: string, options: CrawlOptions = {}): Promise<{ id: string }> {
    return this.request("/v1/crawl", {
      method: "POST",
      body: JSON.stringify({ url, ...options }),
    });
  }

  /**
   * Get job status.
   */
  async getJob(id: string): Promise<JobStatus> {
    return this.request(`/v1/crawl/${id}`);
  }

  /**
   * Wait for a job to complete.
   */
  async waitForJob(id: string, intervalMs = 2000, timeoutMs = 600000): Promise<JobStatus> {
    const start = Date.now();
    while (true) {
      const status = await this.getJob(id);
      if (status.status === "completed" || status.status === "failed") {
        return status;
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Job ${id} timed out after ${timeoutMs}ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  /**
   * List recent jobs.
   */
  async listJobs(): Promise<JobStatus[]> {
    return this.request("/v1/jobs");
  }

  /**
   * Search across all jobs or within a specific job.
   */
  async search(query: string, jobId?: string, limit = 10) {
    if (jobId) {
      return this.request(`/v1/export/rag/${jobId}/search`, {
        method: "POST",
        body: JSON.stringify({ query, limit }),
      });
    }
    return this.request("/v1/search", {
      method: "POST",
      body: JSON.stringify({ query, limit }),
    });
  }

  /**
   * Get entities extracted during a job.
   */
  async getEntities(jobId: string, type?: string) {
    const path = `/v1/jobs/${jobId}/entities${type ? `?type=${type}` : ""}`;
    return this.request(path);
  }

  /**
   * Create a webhook subscription.
   */
  async createWebhook(url: string, event: "job.completed" | "job.failed") {
    return this.request("/v1/webhooks", {
      method: "POST",
      body: JSON.stringify({ url, event }),
    });
  }

  /**
   * List active webhooks.
   */
  async listWebhooks() {
    return this.request("/v1/webhooks");
  }

  /**
   * Delete a webhook subscription.
   */
  async deleteWebhook(id: string) {
    return this.request(`/v1/webhooks/${id}`, {
      method: "DELETE",
    });
  }
}
