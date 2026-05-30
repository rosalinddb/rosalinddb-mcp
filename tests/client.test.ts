import { describe, it, expect } from "vitest";
import { RosalindClient, USER_AGENT } from "../src/client.js";
import { RosalindApiError } from "../src/errors.js";

/** Build a fake fetch returning a fixed response. */
function fakeFetch(
  status: number,
  body: string,
  capture?: (url: string, init: RequestInit) => void,
): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    capture?.(url, init);
    // 204/205/304 must not carry a body per the Response spec.
    const nullBody = status === 204 || status === 205 || status === 304;
    return new Response(nullBody ? null : body, { status });
  }) as unknown as typeof fetch;
}

describe("RosalindClient", () => {
  it("constructs without an API key (OSS-default backend mode)", () => {
    expect(
      () => new RosalindClient({ baseUrl: "http://x" }),
    ).not.toThrowError();
  });

  it("attaches the bearer auth header when a key is configured", async () => {
    let seenInit: RequestInit | undefined;
    const client = new RosalindClient({
      apiKey: "rb_live_secret",
      baseUrl: "http://localhost:8080",
      fetchImpl: fakeFetch(200, "{}", (_u, init) => (seenInit = init)),
    });
    await client.get("/v1/datasets");
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer rb_live_secret");
  });

  it("omits the Authorization header when no key is configured", async () => {
    let seenInit: RequestInit | undefined;
    const client = new RosalindClient({
      baseUrl: "http://localhost:8080",
      fetchImpl: fakeFetch(200, "{}", (_u, init) => (seenInit = init)),
    });
    await client.get("/v1/datasets");
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });

  it("sets a User-Agent header pinned to the package version", async () => {
    let seenInit: RequestInit | undefined;
    const client = new RosalindClient({
      apiKey: "rb_live_x",
      baseUrl: "http://x",
      fetchImpl: fakeFetch(200, "{}", (_u, init) => (seenInit = init)),
    });
    await client.get("/v1/datasets");
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers["User-Agent"]).toBe(USER_AGENT);
    expect(USER_AGENT).toMatch(/^@rosalinddb\/mcp\/\d+\.\d+\.\d+/);
  });

  it("strips a trailing slash from the base URL", async () => {
    let seenUrl = "";
    const client = new RosalindClient({
      apiKey: "rb_live_x",
      baseUrl: "http://localhost:8080/",
      fetchImpl: fakeFetch(200, "{}", (u) => (seenUrl = u)),
    });
    await client.get("/v1/datasets");
    expect(seenUrl).toBe("http://localhost:8080/v1/datasets");
  });

  it("parses a JSON body on success", async () => {
    const client = new RosalindClient({
      apiKey: "rb_live_x",
      baseUrl: "http://x",
      fetchImpl: fakeFetch(200, JSON.stringify({ datasets: [] })),
    });
    const out = await client.get<{ datasets: unknown[] }>("/v1/datasets");
    expect(out.datasets).toEqual([]);
  });

  it("returns undefined for a 204 response", async () => {
    const client = new RosalindClient({
      apiKey: "rb_live_x",
      baseUrl: "http://x",
      fetchImpl: fakeFetch(204, ""),
    });
    await expect(client.delete("/v1/datasets/products")).resolves.toBeUndefined();
  });

  it("maps a failing response onto a RosalindApiError", async () => {
    const client = new RosalindClient({
      apiKey: "rb_live_x",
      baseUrl: "http://x",
      fetchImpl: fakeFetch(
        404,
        JSON.stringify({
          error: { code: "dataset_not_found", message: "nope" },
        }),
      ),
    });
    await expect(client.get("/v1/datasets/missing")).rejects.toBeInstanceOf(
      RosalindApiError,
    );
  });

  it("serializes NDJSON one object per line with a terminal newline", async () => {
    let seenInit: RequestInit | undefined;
    const client = new RosalindClient({
      apiKey: "rb_live_x",
      baseUrl: "http://x",
      fetchImpl: fakeFetch(202, "{}", (_u, init) => (seenInit = init)),
    });
    await client.postNdjson("/v1/datasets/d/vectors", [
      { id: "a", values: [1] },
      { id: "b", values: [2] },
    ]);
    const headers = seenInit?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/x-ndjson");
    expect(seenInit?.body).toBe(
      '{"id":"a","values":[1]}\n{"id":"b","values":[2]}\n',
    );
  });

  it("propagates a fetch-level network failure (fetch rejects)", async () => {
    // Not an HTTP error response: fetch itself throws (DNS failure, ECONNREFUSED).
    const rejectingFetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const client = new RosalindClient({
      apiKey: "rb_live_x",
      baseUrl: "http://x",
      fetchImpl: rejectingFetch,
    });
    await expect(client.get("/v1/datasets")).rejects.toThrow("fetch failed");
  });
});
