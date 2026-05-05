import "dotenv/config";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SpidercrawlMcpServer } from "./server.js";
import { logger } from "../lib/logger.js";

async function main() {
  const server = new SpidercrawlMcpServer();
  const transport = new StdioServerTransport();

  try {
    await server.connect(transport);
    logger.info("Spidercrawl MCP Server running on stdio");
  } catch (error) {
    logger.error(error, "Failed to start MCP server");
    process.exit(1);
  }
}

main();
