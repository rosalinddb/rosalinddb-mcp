import { describe, it, expect } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  InMemoryTransport,
} from "@modelcontextprotocol/sdk/inMemory.js";
import { RosalindClient } from "../src/client.js";
import { buildServer } from "../src/server.js";

function fakeFetch(status: number, body: string): typeof fetch {
  return (async () => new Response(body, { status })) as unknown as typeof fetch;
}

/** Wire an in-process MCP client to the built server. */
async function connect(fetchImpl: typeof fetch) {
  const apiClient = new RosalindClient({
    apiKey: "rb_live_test",
    baseUrl: "http://localhost:8080",
    fetchImpl,
  });
  const server = buildServer({ client: apiClient });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([
    server.connect(serverTransport),
    client.connect(clientTransport),
  ]);
  return client;
}

describe("MCP server", () => {
  it("answers tools/list with the full tool surface", async () => {
    const client = await connect(fakeFetch(200, "{}"));
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toContain("list_datasets");
    expect(names).toContain("create_dataset");
    expect(names).toContain("query_vectors");
    expect(names).toContain("get_usage");
    expect(tools.length).toBeGreaterThanOrEqual(8);
    await client.close();
  });

  it("returns a tool result on a successful call", async () => {
    const client = await connect(
      fakeFetch(200, JSON.stringify({ datasets: [] })),
    );
    const res = await client.callTool({ name: "list_datasets", arguments: {} });
    expect(res.isError).toBeFalsy();
    const content = res.content as { type: string; text: string }[];
    expect(content[0].text).toContain("datasets");
    await client.close();
  });

  it("maps an API 404 to a clean tool error, not a stack trace", async () => {
    const client = await connect(
      fakeFetch(
        404,
        JSON.stringify({
          error: { code: "dataset_not_found", message: "missing" },
        }),
      ),
    );
    const res = await client.callTool({
      name: "get_dataset",
      arguments: { name: "missing" },
    });
    expect(res.isError).toBe(true);
    const content = res.content as { type: string; text: string }[];
    expect(content[0].text).toContain("dataset_not_found");
    expect(content[0].text).not.toContain("at ");
    await client.close();
  });

  it("surfaces a fetch-level network failure as a clean tool error", async () => {
    // fetch rejects outright (e.g. ECONNREFUSED) - not an HTTP error response.
    const rejectingFetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const client = await connect(rejectingFetch);
    const res = await client.callTool({
      name: "list_datasets",
      arguments: {},
    });
    expect(res.isError).toBe(true);
    const content = res.content as { type: string; text: string }[];
    expect(content[0].text).toContain("RosalindDB MCP error");
    expect(content[0].text).toContain("fetch failed");
    // Must be a clean message, not a raw stack trace.
    expect(content[0].text).not.toContain("at ");
    await client.close();
  });

  it("rejects invalid tool input with a clear validation error", async () => {
    const client = await connect(fakeFetch(200, "{}"));
    const res = await client.callTool({
      name: "create_dataset",
      arguments: { name: "Bad Name", dimension: -1 },
    });
    expect(res.isError).toBe(true);
    await client.close();
  });

  // Regression: bad tool input previously surfaced as a JSON-RPC -32602
  // with a multi-line zod blob; we want a single-line isError tool-result
  // envelope ("Invalid tool input: <field>: <msg>") instead.
  it("emits a single-line tool-result envelope (not JSON-RPC -32602) on bad input", async () => {
    const client = await connect(fakeFetch(200, "{}"));
    // callTool must resolve (tool-result), not reject (JSON-RPC error).
    const res = await client.callTool({
      name: "create_dataset",
      // empty name fails both min(1) and the regex.
      arguments: { name: "", dimension: 4 },
    });
    expect(res.isError).toBe(true);
    const content = res.content as { type: string; text: string }[];
    expect(content).toHaveLength(1);
    expect(content[0].type).toBe("text");
    const text = content[0].text;
    // Documented envelope: single-line "Invalid tool input: <field>: <msg>; ..."
    expect(text.startsWith("Invalid tool input:")).toBe(true);
    expect(text.includes("\n")).toBe(false);
    // Must name the failing field.
    expect(text).toContain("name");
    // Must NOT be the SDK's pre-validation JSON-RPC envelope.
    expect(text).not.toContain("-32602");
    expect(text).not.toContain("Input validation error: Invalid arguments");
    // Must NOT be a raw zod issue dump (no JSON object braces with "code").
    expect(text).not.toContain('"code":');
    expect(text).not.toContain('"path":');
    await client.close();
  });

  it("uses the same envelope for whitespace-only dataset names", async () => {
    const client = await connect(fakeFetch(200, "{}"));
    const res = await client.callTool({
      name: "create_dataset",
      arguments: { name: " ", dimension: 4 },
    });
    expect(res.isError).toBe(true);
    const content = res.content as { type: string; text: string }[];
    expect(content[0].text.startsWith("Invalid tool input:")).toBe(true);
    expect(content[0].text).toContain("name");
    await client.close();
  });
});
