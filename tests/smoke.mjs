/**
 * Stdio smoke test: spawns the built server as a child process exactly as an
 * MCP client would (`node dist/index.js`), then drives a real MCP handshake
 * and a `tools/list` call over stdio. Exits non-zero on any failure.
 *
 * Run with: npm run smoke
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "..", "dist", "index.js");

// Pass-through env. We deliberately do NOT inject a fake API key any more:
// the MCP server now starts cleanly with no key set (OSS-default backend
// mode) and tools/list makes no network call, so this exercises the same
// no-auth path a self-hoster would hit.
const childEnv = { ...process.env };
if (!childEnv.ROSALINDDB_API_URL) {
  childEnv.ROSALINDDB_API_URL = "http://localhost:8080";
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [entry],
  env: childEnv,
});

const client = new Client({ name: "smoke-client", version: "0.0.0" });

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  console.log(`tools/list returned ${tools.length} tools: ${names.join(", ")}`);
  if (tools.length < 8) {
    throw new Error(`expected at least 8 tools, got ${tools.length}`);
  }
  console.log("STDIO SMOKE TEST: PASS");
  await client.close();
  process.exit(0);
} catch (err) {
  console.error("STDIO SMOKE TEST: FAIL");
  console.error(err);
  process.exit(1);
}
