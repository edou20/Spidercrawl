#!/usr/bin/env node
import { SpidercrawlClient } from "./index.js";
import { parseArgs } from "node:util";

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      url: { type: "string", short: "u" },
      goal: { type: "string", short: "g" },
      limit: { type: "string", short: "l" },
      depth: { type: "string", short: "d" },
      pages: { type: "string", short: "p" },
      apiKey: { type: "string", short: "k" },
      baseUrl: { type: "string", short: "b" },
      format: { type: "string", short: "f" },
      wait: { type: "boolean", short: "w" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  const command = positionals[0];

  if (values.help || !command) {
    console.log(`
Spidercrawl CLI — Intelligent Web Data Platform

Usage:
  spidercrawl <command> [options]

Commands:
  scrape <url>        Scrape a single page and output markdown
  crawl <url>         Start a new crawl job
  status <job-id>     Check status of a job
  search <query>      Search across all jobs
  search <job-id> <q> Search within a specific job
  jobs                List recent jobs
  entities <job-id>   List entities extracted from a job

Options:
  -u, --url <url>      Target URL
  -g, --goal <goal>    Crawl goal (e.g. "Find pricing")
  -d, --depth <n>      Max depth (default 3)
  -p, --pages <n>      Max pages (default 50)
  -w, --wait           Wait for crawl to complete
  -k, --apiKey <key>   API key (or use SPIDERCRAWL_API_KEY env)
  -b, --baseUrl <url>  API base URL (default http://localhost:3200)
  -f, --format <fmt>   Output format (json, text)
    `);
    process.exit(0);
  }

  const client = new SpidercrawlClient({
    apiKey: (values.apiKey as string),
    baseUrl: (values.baseUrl as string),
  });

  try {
    switch (command) {
      case "scrape": {
        const url = positionals[1] || (values.url as string);
        if (!url) throw new Error("URL required");
        const res = await client.scrape(url);
        console.log(values.format === "json" ? JSON.stringify(res, null, 2) : res.markdown);
        break;
      }

      case "crawl": {
        const url = positionals[1] || (values.url as string);
        if (!url) throw new Error("URL required");
        const { id } = await client.crawl(url, {
          goal: (values.goal as string),
          maxDepth: values.depth ? parseInt(values.depth as string) : undefined,
          maxPages: values.pages ? parseInt(values.pages as string) : undefined,
        });
        console.log(`Crawl started! Job ID: ${id}`);
        
        if (values.wait) {
          process.stdout.write("Crawling...");
          const status = await client.waitForJob(id, 2000, 3600000);
          console.log("\nDone!");
          if (status.status === "failed") {
            console.error(`Crawl failed: ${status.error}`);
            process.exit(1);
          }
          console.log(`Successfully crawled ${status.completedPages} pages.`);
        }
        break;
      }

      case "status": {
        const id = positionals[1];
        if (!id) throw new Error("Job ID required");
        const res = await client.getJob(id);
        console.log(JSON.stringify(res, null, 2));
        break;
      }

      case "search": {
        let query = positionals[1];
        let jobId: string | undefined;
        
        if (positionals.length > 2) {
          jobId = positionals[1];
          query = positionals[2];
        }

        if (!query) throw new Error("Search query required");
        const res = await client.search(query, jobId, values.limit ? parseInt(values.limit as string) : 5);
        console.log(JSON.stringify(res, null, 2));
        break;
      }

      case "jobs": {
        const res = await client.listJobs();
        console.table(res.map(j => ({
          id: j.id,
          rootUrl: j.rootUrl,
          status: j.status,
          progress: `${j.progress}%`,
          pages: `${j.completedPages}/${j.totalPages}`,
          createdAt: new Date(j.createdAt).toLocaleString(),
        })));
        break;
      }

      case "entities": {
        const id = positionals[1];
        if (!id) throw new Error("Job ID required");
        const res = await client.getEntities(id);
        console.log(JSON.stringify(res, null, 2));
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        process.exit(1);
    }
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

main();
