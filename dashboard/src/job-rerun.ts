export interface RerunnableJobConfig {
  rootUrl: string;
  goal?: string;
  maxDepth?: number;
  maxPages?: number;
  formats?: string[];
  extractionPrompt?: string;
  extractionSchema?: Record<string, unknown>;
  enableEntities?: boolean;
  adaptiveBudget?: boolean;
  satisfactionThreshold?: number;
}

export function buildRerunRequest(jobId: string, job: RerunnableJobConfig) {
  return {
    url: job.rootUrl,
    ...(job.goal ? { goal: job.goal } : {}),
    maxDepth: job.maxDepth ?? 3,
    maxPages: job.maxPages ?? 50,
    formats: job.formats?.length ? job.formats : ["markdown"],
    ...(job.extractionPrompt ? { extractionPrompt: job.extractionPrompt } : {}),
    ...(job.extractionSchema ? { extractionSchema: job.extractionSchema } : {}),
    enableEntities: job.enableEntities ?? false,
    adaptiveBudget: job.adaptiveBudget ?? false,
    satisfactionThreshold: job.satisfactionThreshold ?? 0.3,
    rerunJobId: jobId,
  };
}
