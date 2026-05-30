import { describe, it, expect, vi } from "vitest";
import { loadConfig, DEFAULT_API_URL } from "../src/config.js";

describe("loadConfig", () => {
  it("accepts a missing API key (OSS-default backend, RB_REQUIRE_AUTH=false)", () => {
    const cfg = loadConfig({});
    expect(cfg.apiKey).toBeUndefined();
    expect(cfg.apiUrl).toBe(DEFAULT_API_URL);
  });

  it("warns but accepts a key without the rb_live_ prefix", () => {
    const writeSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    const cfg = loadConfig({ ROSALINDDB_API_KEY: "wrong_prefix_abc" });
    expect(cfg.apiKey).toBe("wrong_prefix_abc");
    expect(writeSpy).toHaveBeenCalled();
    const warning = writeSpy.mock.calls.map((c) => c[0]).join("");
    expect(warning).toMatch(/rb_live_/);
    writeSpy.mockRestore();
  });

  it("accepts a valid rb_live_ key and uses the default URL", () => {
    const cfg = loadConfig({ ROSALINDDB_API_KEY: "rb_live_abc123" });
    expect(cfg.apiKey).toBe("rb_live_abc123");
    expect(cfg.apiUrl).toBe(DEFAULT_API_URL);
  });

  it("honours an explicit ROSALINDDB_API_URL", () => {
    const cfg = loadConfig({
      ROSALINDDB_API_KEY: "rb_live_abc123",
      ROSALINDDB_API_URL: "https://api.example.com",
    });
    expect(cfg.apiUrl).toBe("https://api.example.com");
  });

  it("trims surrounding whitespace from env values", () => {
    const cfg = loadConfig({
      ROSALINDDB_API_KEY: "  rb_live_abc123  ",
      ROSALINDDB_API_URL: "  http://localhost:9999  ",
    });
    expect(cfg.apiKey).toBe("rb_live_abc123");
    expect(cfg.apiUrl).toBe("http://localhost:9999");
  });

  it("defaults to the OSS docker-compose backend port (8080)", () => {
    expect(DEFAULT_API_URL).toBe("http://localhost:8080");
  });
});
