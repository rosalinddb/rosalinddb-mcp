import { describe, it, expect } from "vitest";
import {
  TOOLS,
  createDatasetSchema,
  queryVectorsSchema,
  ingestVectorsSchema,
} from "../src/tools.js";
import { RosalindClient } from "../src/client.js";

function fakeFetch(
  status: number,
  body: string,
  capture?: (url: string, init: RequestInit) => void,
): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    capture?.(url, init);
    return new Response(body, { status });
  }) as unknown as typeof fetch;
}

describe("tool registry", () => {
  it("registers the full management surface", () => {
    const names = TOOLS.map((t) => t.name).sort();
    const required = [
      "create_dataset",
      "delete_dataset",
      "get_dataset",
      "get_usage",
      "ingest_vectors",
      "list_api_keys",
      "list_datasets",
      "query_vectors",
    ].sort();
    // forward-compatible: required tools must all be present, additional
    // tools (e.g. a future import_dataset) are allowed.
    for (const name of required) {
      expect(names).toContain(name);
    }
    expect(TOOLS.length).toBeGreaterThanOrEqual(8);
  });

  it("every tool has a non-trivial description", () => {
    for (const t of TOOLS) {
      expect(t.description.length).toBeGreaterThan(20);
    }
  });
});

describe("createDatasetSchema", () => {
  it("accepts a valid name and dimension", () => {
    const out = createDatasetSchema.parse({ name: "products", dimension: 768 });
    expect(out.name).toBe("products");
  });

  it("rejects names with invalid characters", () => {
    expect(() =>
      createDatasetSchema.parse({ name: "Bad Name", dimension: 8 }),
    ).toThrowError();
  });

  it("rejects a non-positive dimension", () => {
    expect(() =>
      createDatasetSchema.parse({ name: "ok", dimension: 0 }),
    ).toThrowError();
  });
});

describe("queryVectorsSchema", () => {
  it("accepts a flat metadata filter", () => {
    const out = queryVectorsSchema.parse({
      dataset: "products",
      vector: [0.1, 0.2],
      top_k: 5,
      filter: { category: "books", year: 2024 },
    });
    expect(out.filter).toEqual({ category: "books", year: 2024 });
  });

  it("rejects a top_k above the 1000 max", () => {
    expect(() =>
      queryVectorsSchema.parse({ dataset: "d", vector: [1], top_k: 1001 }),
    ).toThrowError();
  });

  it("rejects a nested filter value", () => {
    expect(() =>
      queryVectorsSchema.parse({
        dataset: "d",
        vector: [1],
        filter: { meta: { nested: true } },
      }),
    ).toThrowError();
  });
});

describe("ingestVectorsSchema", () => {
  it("requires at least one record", () => {
    expect(() =>
      ingestVectorsSchema.parse({ dataset: "d", records: [] }),
    ).toThrowError();
  });

  it("accepts records with optional metadata", () => {
    const out = ingestVectorsSchema.parse({
      dataset: "d",
      records: [{ id: "x", values: [1, 2], metadata: { t: "A" } }],
    });
    expect(out.records[0].id).toBe("x");
  });
});

describe("tool handlers hit the right endpoint", () => {
  it("create_dataset POSTs to /v1/datasets", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const client = new RosalindClient({
      apiKey: "rb_live_x",
      baseUrl: "http://x",
      fetchImpl: fakeFetch(201, "{}", (u, init) => {
        seenUrl = u;
        seenInit = init;
      }),
    });
    const tool = TOOLS.find((t) => t.name === "create_dataset")!;
    await tool.handler(client, { name: "products", dimension: 768 });
    expect(seenUrl).toBe("http://x/v1/datasets");
    expect(seenInit?.method).toBe("POST");
  });

  it("query_vectors POSTs to /v1/query and omits absent optionals", async () => {
    let seenInit: RequestInit | undefined;
    const client = new RosalindClient({
      apiKey: "rb_live_x",
      baseUrl: "http://x",
      fetchImpl: fakeFetch(200, "{}", (_u, init) => (seenInit = init)),
    });
    const tool = TOOLS.find((t) => t.name === "query_vectors")!;
    await tool.handler(client, { dataset: "products", vector: [0.1, 0.2] });
    const body = JSON.parse(seenInit?.body as string);
    expect(body).toEqual({ dataset: "products", vector: [0.1, 0.2] });
    expect(body.top_k).toBeUndefined();
  });

  it("ingest_vectors POSTs NDJSON to the vectors endpoint", async () => {
    let seenUrl = "";
    let seenInit: RequestInit | undefined;
    const client = new RosalindClient({
      apiKey: "rb_live_x",
      baseUrl: "http://x",
      fetchImpl: fakeFetch(202, "{}", (u, init) => {
        seenUrl = u;
        seenInit = init;
      }),
    });
    const tool = TOOLS.find((t) => t.name === "ingest_vectors")!;
    await tool.handler(client, {
      dataset: "products",
      records: [{ id: "a", values: [1, 2] }],
    });
    expect(seenUrl).toBe("http://x/v1/datasets/products/vectors");
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/x-ndjson");
  });

  it("get_usage GETs /auth/usage", async () => {
    let seenUrl = "";
    const client = new RosalindClient({
      apiKey: "rb_live_x",
      baseUrl: "http://x",
      fetchImpl: fakeFetch(200, "{}", (u) => (seenUrl = u)),
    });
    const tool = TOOLS.find((t) => t.name === "get_usage")!;
    await tool.handler(client, {});
    expect(seenUrl).toBe("http://x/auth/usage");
  });
});
