import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { nanoid } from "nanoid";
import { startCrawl, getCrawlStatus, listRecentJobs } from "../core/orchestrator.js";
import { getEntities, getJobExtractedData, getJobSummary, setJobSummary } from "../lib/job-store.js";
import {
  keywordSearchPages,
  keywordSearchAcrossJobs
} from "../export/search.js";
import { buildKeywordHitFromRow, mergeAndRerankHybridHits } from "../api/hybrid-search.js";
import { isDbEnabled, getDb } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { CrawlRequestSchema } from "../types/schemas.js";
import { synthesizeAnswer } from "../api/routes.js";

/**
 * Spidercrawl MCP Server
 * Exposes crawling and knowledge graph tools to AI assistants.
 */
export class SpidercrawlMcpServer {
  private server: Server;

  constructor() {
    this.server = new Server(
      {
        name: "spidercrawl",
        version: "0.1.0",
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupTools();
  }

  private setupTools() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: "start_crawl",
            description: "Starts a new asynchronous crawl job for a given URL and goal.",
            inputSchema: {
              type: "object",
              properties: {
                url: { type: "string", description: "The root URL to start crawling from." },
                goal: { type: "string", description: "The goal of the crawl (e.g., 'Find all pricing information')." },
                maxDepth: { type: "number", description: "Maximum crawl depth (default: 3)." },
                maxPages: { type: "number", description: "Maximum number of pages to crawl (default: 50)." },
                adaptiveBudget: { type: "boolean", description: "Stop when goal relevance drops (default: false)." },
              },
              required: ["url"],
            },
          },
          {
            name: "get_job_status",
            description: "Retrieves the current status, progress, and results of a crawl job.",
            inputSchema: {
              type: "object",
              properties: {
                jobId: { type: "string", description: "The ID of the job to check." },
              },
              required: ["jobId"],
            },
          },
          {
            name: "search_knowledge",
            description: "Performs a semantic or keyword search across crawled data.",
            inputSchema: {
              type: "object",
              properties: {
                query: { type: "string", description: "The search query." },
                jobId: { type: "string", description: "Optional: limit search to a specific job ID." },
                limit: { type: "number", description: "Maximum number of results (default: 8)." },
              },
              required: ["query"],
            },
          },
          {
            name: "get_entities",
            description: "Retrieves structured entities (Organizations, People, etc.) extracted during a crawl.",
            inputSchema: {
              type: "object",
              properties: {
                jobId: { type: "string", description: "The ID of the job." },
                type: { type: "string", description: "Optional: filter by entity type (e.g., 'Organization')." },
              },
              required: ["jobId"],
            },
          },
          {
            name: "list_jobs",
            description: "Lists recent crawl jobs with their status and progress.",
            inputSchema: {
              type: "object",
              properties: {
                limit: { type: "number", description: "Maximum number of jobs to return (default: 20)." },
              },
            },
          },
          {
            name: "get_extracted_data",
            description: "Returns structured JSON data extracted from pages in a crawl job. Useful when the job used an extraction prompt or schema.",
            inputSchema: {
              type: "object",
              properties: {
                jobId: { type: "string", description: "The ID of the job." },
                limit: { type: "number", description: "Maximum number of page results to return (default: 50)." },
              },
              required: ["jobId"],
            },
          },
          {
            name: "ask_job",
            description: "Ask a natural language question about the content crawled in a specific job. Returns a synthesized answer with source URLs.",
            inputSchema: {
              type: "object",
              properties: {
                jobId: { type: "string", description: "The ID of the crawl job to query." },
                question: { type: "string", description: "The question to answer using the crawled content." },
                limit: { type: "number", description: "Number of source pages to use for context (default: 5)." },
              },
              required: ["jobId", "question"],
            },
          },
          {
            name: "get_job_summary",
            description: "Returns a concise AI-generated summary of what was found in a crawl job. Generates and caches on first call.",
            inputSchema: {
              type: "object",
              properties: {
                jobId: { type: "string", description: "The ID of the crawl job." },
              },
              required: ["jobId"],
            },
          },
        ],
      };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case "start_crawl":
            return await this.handleStartCrawl(args);
          case "get_job_status":
            return await this.handleGetJobStatus(args);
          case "search_knowledge":
            return await this.handleSearchKnowledge(args);
          case "get_entities":
            return await this.handleGetEntities(args);
          case "list_jobs":
            return await this.handleListJobs(args);
          case "get_extracted_data":
            return await this.handleGetExtractedData(args);
          case "ask_job":
            return await this.handleAskJob(args);
          case "get_job_summary":
            return await this.handleGetJobSummary(args);
          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error: any) {
        return {
          content: [{ type: "text", text: `Error: ${error.message}` }],
          isError: true,
        };
      }
    });
  }

  private async handleStartCrawl(args: any) {
    const jobId = nanoid(12);
    const parsed = CrawlRequestSchema.parse({
      url: args.url,
      goal: args.goal,
      maxDepth: args.maxDepth ?? 3,
      maxPages: args.maxPages ?? 50,
      adaptiveBudget: args.adaptiveBudget ?? false,
      formats: ["markdown"],
    });

    await startCrawl(jobId, parsed);
    return {
      content: [
        {
          type: "text",
          text: `Crawl job started with ID: ${jobId}. You can monitor it using get_job_status.`,
        },
      ],
    };
  }

  private async handleGetJobStatus(args: any) {
    const status = await getCrawlStatus(args.jobId);
    if (!status) {
      throw new Error(`Job ${args.jobId} not found.`);
    }

    const summary = {
      id: status.id,
      status: status.status,
      progress: `${status.progress}%`,
      completedPages: status.completedPages,
      totalPages: status.totalPages,
      rootUrl: status.rootUrl,
      goal: status.goal,
      error: status.error,
    };

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(summary, null, 2),
        },
      ],
    };
  }

  private async handleSearchKnowledge(args: any) {
    const { query, jobId, limit = 8 } = args;
    
    if (jobId) {
      const status = await getCrawlStatus(jobId);
      if (!status) throw new Error(`Job ${jobId} not found.`);

      // Keyword fallback logic similar to routes.ts
      // If we have embeddings, use vector search (simplified for MCP)
      if (isDbEnabled() && process.env.OPENAI_API_KEY) {
        const db = getDb();
        const countRes = await db.query<{ count: string }>(
          `SELECT COUNT(*)::text AS count FROM embeddings WHERE job_id = $1`,
          [jobId]
        );
        if (parseInt(countRes.rows[0]?.count ?? "0", 10) > 0) {
          const terms: string[] = query.toLowerCase().split(/\s+/).filter(Boolean);
          const patterns: string[] = terms.length ? terms.map((term: string) => `%${term}%`) : [`%${query}%`];
          const clauses = patterns.map((_: string, index: number) => `(markdown ILIKE $${index + 2} OR title ILIKE $${index + 2})`);
          const scoreSql = patterns
            .map((_: string, index: number) => `CASE WHEN markdown ILIKE $${index + 2} OR title ILIKE $${index + 2} THEN 1 ELSE 0 END`)
            .join(" + ");
          const keywordRes = await db.query(
            `SELECT url, title, markdown,
                    (${scoreSql})::float as similarity,
                    status_code, depth, crawled_at
             FROM pages
             WHERE job_id = $1 AND (${clauses.join(" OR ")})
             ORDER BY similarity DESC, crawled_at DESC
             LIMIT $${patterns.length + 2}`,
            [jobId, ...patterns, limit * 3]
          );
          const keywordHits = keywordRes.rows.map((row) => buildKeywordHitFromRow(row, query, terms, patterns.length));
          const { searchEmbeddings } = await import("../export/rag.js");
          const vectorHits = await searchEmbeddings(jobId, query, limit * 3);
          const enriched = mergeAndRerankHybridHits(keywordHits, vectorHits, query, limit);
          return {
            content: [{ type: "text", text: JSON.stringify(enriched, null, 2) }],
          };
        }
      }

      const results = keywordSearchPages(status.results, query, limit);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    } else {
      // Cross-job search
      if (!isDbEnabled()) throw new Error("Database required for cross-job search.");
      const db = getDb();
      const res = await db.query<any>(
        `SELECT j.id AS job_id, j.root_url, j.goal,
                p.url, p.title, p.status_code, p.depth, p.markdown, p.html,
                p.metadata, p.image_descriptions, p.crawled_at
         FROM pages p
         JOIN jobs j ON j.id = p.job_id
         WHERE p.markdown IS NOT NULL OR p.title IS NOT NULL
         ORDER BY p.crawled_at DESC
         LIMIT 2000`
      );

      const entries = res.rows.map((row: any) => ({
        job: { id: row.job_id, rootUrl: row.root_url, goal: row.goal },
        page: {
          url: row.url,
          statusCode: row.status_code,
          title: row.title,
          markdown: row.markdown,
          metadata: row.metadata,
        },
      }));

      const results = keywordSearchAcrossJobs(entries, query, limit);
      return {
        content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
      };
    }
  }

  private async handleGetEntities(args: any) {
    if (!isDbEnabled()) {
      return { content: [{ type: "text", text: "Database not enabled; no entities available." }] };
    }

    const entities = await getEntities(args.jobId, args.type);
    return {
      content: [{ type: "text", text: JSON.stringify(entities, null, 2) }],
    };
  }

  private async handleListJobs(args: any) {
    const limit = args?.limit ?? 20;
    const jobs = await listRecentJobs();
    const summary = jobs.slice(0, limit).map((j: any) => ({
      id: j.id,
      rootUrl: j.rootUrl,
      status: j.status,
      goal: j.goal,
      progress: j.progress,
      completedPages: j.completedPages,
      totalPages: j.totalPages,
      createdAt: j.createdAt,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
    };
  }

  private async handleGetExtractedData(args: any) {
    if (!isDbEnabled()) {
      return { content: [{ type: "text", text: "Database not enabled; no extracted data available." }] };
    }
    const limit = args?.limit ?? 50;
    const data = await getJobExtractedData(args.jobId, limit);
    return {
      content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
    };
  }

  private async handleAskJob(args: any) {
    const { jobId, question, limit = 5 } = args;
    if (!question?.trim()) throw new Error("question is required");
    const result = await synthesizeAnswer(jobId, question.trim(), Number(limit));
    const text = `${result.answer}\n\nSources:\n${result.sources.map((s: string) => `- ${s}`).join("\n")}`;
    return {
      content: [{ type: "text", text }],
    };
  }

  private async handleGetJobSummary(args: any) {
    const { jobId } = args;
    const status = await getCrawlStatus(jobId);
    if (!status) throw new Error(`Job ${jobId} not found.`);

    const cached = await getJobSummary(jobId);
    if (cached) {
      return { content: [{ type: "text", text: cached }] };
    }

    const { aiComplete } = await import("../ai/provider.js");
    const pages = (status.results ?? []).slice(0, 20);
    if (pages.length === 0) {
      return { content: [{ type: "text", text: "No pages crawled yet." }] };
    }

    const pageList = pages
      .map((p: any) => `• ${p.title || p.url}: ${(p.markdown ?? "").slice(0, 200)}`)
      .join("\n");

    const response = await aiComplete({
      systemPrompt: "You are a research analyst. Summarize web crawl results concisely in bullet points.",
      prompt: `Crawl of: ${status.rootUrl}\nGoal: ${status.goal || "Breadth-first exploration"}\n\nPage excerpts:\n${pageList}\n\nWrite exactly 3 bullet points covering key findings.`,
      temperature: 0.2,
      maxTokens: 512,
    });
    const summary = response.text.trim();

    await setJobSummary(jobId, summary).catch(() => {});
    return { content: [{ type: "text", text: summary }] };
  }

  public async connect(transport: any) {
    await this.server.connect(transport);
    logger.info("Spidercrawl MCP Server connected");
  }
}
