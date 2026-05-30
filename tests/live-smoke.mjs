/**
 * Best-effort LIVE smoke test against a running RosalindDB stack.
 *
 * Requires ROSALINDDB_API_KEY (a real rb_live_ key) and a reachable API at
 * ROSALINDDB_API_URL (default http://localhost:8080). Exercises a couple of
 * MCP tools end to end via the in-process MCP client: create_dataset ->
 * ingest_vectors -> get_usage -> query_vectors -> delete_dataset.
 *
 * This is NOT part of the hard test requirement; it is skipped if no key is
 * provided or the stack is unreachable.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { RosalindClient } from "../dist/client.js";
import { buildServer } from "../dist/server.js";

const apiKey = process.env.ROSALINDDB_API_KEY;
const apiUrl = process.env.ROSALINDDB_API_URL ?? "http://localhost:8080";

if (!apiKey || !apiKey.startsWith("rb_live_")) {
  console.log("LIVE SMOKE: skipped (no ROSALINDDB_API_KEY)");
  process.exit(0);
}

function unwrap(res, label) {
  const text = res.content?.[0]?.text ?? "";
  if (res.isError) {
    throw new Error(`${label} failed: ${text}`);
  }
  console.log(`  ${label}: ${text.replace(/\s+/g, " ").slice(0, 200)}`);
  return text;
}

const apiClient = new RosalindClient({ apiKey, baseUrl: apiUrl });
const server = buildServer({ client: apiClient });
const [ct, st] = InMemoryTransport.createLinkedPair();
const client = new Client({ name: "live-smoke", version: "0.0.0" });
await Promise.all([server.connect(st), client.connect(ct)]);

const ds = `mcp_smoke_${Date.now()}`;
try {
  unwrap(
    await client.callTool({
      name: "create_dataset",
      arguments: { name: ds, dimension: 4 },
    }),
    "create_dataset",
  );
  unwrap(
    await client.callTool({
      name: "ingest_vectors",
      arguments: {
        dataset: ds,
        records: [
          { id: "a", values: [0.1, 0.2, 0.3, 0.4], metadata: { tag: "x" } },
          { id: "b", values: [0.9, 0.8, 0.7, 0.6], metadata: { tag: "y" } },
        ],
      },
    }),
    "ingest_vectors",
  );
  unwrap(await client.callTool({ name: "get_usage", arguments: {} }), "get_usage");
  unwrap(
    await client.callTool({
      name: "query_vectors",
      arguments: { dataset: ds, vector: [0.1, 0.2, 0.3, 0.4], top_k: 2 },
    }),
    "query_vectors",
  );
  console.log("LIVE SMOKE: PASS");
} catch (err) {
  console.error("LIVE SMOKE: FAIL");
  console.error(err.message);
  process.exitCode = 1;
} finally {
  try {
    await client.callTool({ name: "delete_dataset", arguments: { name: ds } });
    console.log(`  cleaned up dataset ${ds}`);
  } catch {
    // best-effort cleanup
  }
  await client.close();
}
