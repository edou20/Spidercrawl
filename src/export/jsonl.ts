import type { JobStatus, PageResult } from "../types/schemas.js";
import { detectEntityType } from "./jsonld.js";

export interface JsonlPageRecord {
  job_id: string;
  root_url: string;
  url: string;
  title: string;
  status_code: number;
  entity_type: string;
  depth: number | null;
  goal?: string;
  markdown?: string;
  html?: string;
  tables?: PageResult["tables"];
  extracted_data?: Record<string, unknown>;
  image_descriptions?: PageResult["imageDescriptions"];
  links: string[];
  metadata: PageResult["metadata"];
  crawled_at: string;
}

export interface FineTuneJsonlRecord {
  messages: Array<{
    role: "system" | "user" | "assistant";
    content: string;
  }>;
  metadata: {
    job_id: string;
    root_url: string;
    url: string;
    title: string;
    entity_type: string;
    depth: number | null;
    crawled_at: string;
  };
}

function summarizeMarkdown(markdown?: string): string | undefined {
  const normalized = markdown?.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  return normalized.slice(0, 400);
}

export function pageToJsonlRecord(
  job: JobStatus,
  page: PageResult,
  depth: number | null
): JsonlPageRecord {
  return {
    job_id: job.id,
    root_url: job.rootUrl,
    url: page.url,
    title: page.title,
    status_code: page.statusCode,
    entity_type: detectEntityType(page),
    depth,
    goal: job.goal,
    markdown: page.markdown,
    html: page.html,
    tables: page.tables,
    extracted_data: page.extractedData,
    image_descriptions: page.imageDescriptions,
    links: page.links,
    metadata: page.metadata,
    crawled_at: page.metadata.crawledAt,
  };
}

export function jobToJsonl(job: JobStatus, depthByUrl?: Map<string, number>): string {
  return job.results
    .map((page, index) => {
      const depth = depthByUrl?.get(page.url) ?? (page.url === job.rootUrl ? 0 : (index === 0 ? 0 : null));
      return JSON.stringify(pageToJsonlRecord(job, page, depth));
    })
    .join("\n");
}

export function pageToFineTuneJsonlRecord(
  job: JobStatus,
  page: PageResult,
  depth: number | null
): FineTuneJsonlRecord {
  const record = pageToJsonlRecord(job, page, depth);
  const assistantPayload = {
    url: record.url,
    title: record.title,
    entity_type: record.entity_type,
    depth: record.depth,
    summary: summarizeMarkdown(record.markdown),
    extracted_data: record.extracted_data,
    tables: record.tables,
  };

  return {
    messages: [
      {
        role: "system",
        content: "You convert crawled web pages into faithful structured knowledge records.",
      },
      {
        role: "user",
        content: [
          "Create a structured page record from this crawl result.",
          `URL: ${record.url}`,
          `Title: ${record.title || "Untitled"}`,
          `Entity type: ${record.entity_type}`,
          `Depth: ${record.depth ?? "unknown"}`,
          record.markdown ? `Markdown:\n${record.markdown}` : undefined,
          record.tables?.length ? `Tables:\n${JSON.stringify(record.tables)}` : undefined,
          record.extracted_data ? `Existing extracted data:\n${JSON.stringify(record.extracted_data)}` : undefined,
        ].filter(Boolean).join("\n\n"),
      },
      {
        role: "assistant",
        content: JSON.stringify(assistantPayload),
      },
    ],
    metadata: {
      job_id: record.job_id,
      root_url: record.root_url,
      url: record.url,
      title: record.title,
      entity_type: record.entity_type,
      depth: record.depth,
      crawled_at: record.crawled_at,
    },
  };
}

export function jobToFineTuneJsonl(job: JobStatus, depthByUrl?: Map<string, number>): string {
  return job.results
    .map((page, index) => {
      const depth = depthByUrl?.get(page.url) ?? (page.url === job.rootUrl ? 0 : (index === 0 ? 0 : null));
      return JSON.stringify(pageToFineTuneJsonlRecord(job, page, depth));
    })
    .join("\n");
}
