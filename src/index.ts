#!/usr/bin/env node
/**
 * Cin7 Omni MCP server.
 *
 * Exposes the full Cin7 Omni v1/v2 API (Contacts, Products, Stock, Sales
 * Orders, Purchase Orders, and every other API resource) to MCP clients
 * such as Claude Desktop and Claude Code, over stdio.
 *
 * Required environment variables:
 *   CIN7_API_USERNAME  API connection username (Cin7 Omni → Settings → Integrations → API v1)
 *   CIN7_API_KEY       API connection key
 * Optional:
 *   CIN7_READ_ONLY     "true" to expose only read tools (list/get/describe)
 *   CIN7_BASE_URL      Override the API base URL (default https://api.cin7.com/api)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./client.js";
import { registerTools } from "./tools.js";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(`ERROR: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const readOnly = /^(true|1|yes)$/i.test(process.env.CIN7_READ_ONLY ?? "");

  const server = new McpServer({
    name: "cin7-omni-mcp-server",
    version: "1.0.0",
  });

  registerTools(server, config, readOnly);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `Cin7 Omni MCP server running (stdio${readOnly ? ", read-only mode" : ""}; API: ${config.baseUrl})`,
  );
}

main().catch((err) => {
  console.error("Fatal server error:", err);
  process.exit(1);
});
