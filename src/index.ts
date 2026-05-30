#!/usr/bin/env node
/**
 * Entrypoint for the RosalindDB MCP server.
 *
 * Run via `npx @rosalinddb/mcp` (or the `rosalinddb-mcp` bin). Reads config
 * from the environment, builds the server, and serves over stdio - the
 * standard transport for a locally-launched MCP server.
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { RosalindClient } from "./client.js";
import { loadConfig } from "./config.js";
import { buildServer } from "./server.js";

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    // Fail clearly and early on a missing/invalid API key.
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[rosalinddb-mcp] startup failed: ${message}\n`);
    process.exit(1);
    return;
  }

  const client = new RosalindClient({
    apiKey: config.apiKey,
    baseUrl: config.apiUrl,
  });
  const server = buildServer({ client });

  const transport = new StdioServerTransport();
  await server.connect(transport);

  const authMode = config.apiKey ? "key" : "no-auth";
  process.stderr.write(
    `[rosalinddb-mcp] connected over stdio (api: ${config.apiUrl}, auth: ${authMode})\n`,
  );
}

main().catch((err) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`[rosalinddb-mcp] fatal: ${message}\n`);
  process.exit(1);
});
