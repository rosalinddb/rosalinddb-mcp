/**
 * Environment-driven configuration for the RosalindDB MCP server.
 *
 *   ROSALINDDB_API_KEY  (optional) - the rb_live_ API key; omit when pointing at
 *                                    an OSS-default backend with RB_REQUIRE_AUTH=false.
 *   ROSALINDDB_API_URL  (optional) - API base URL; defaults to local dev.
 */

export const DEFAULT_API_URL = "http://localhost:8080";

export interface ServerConfig {
  /** The configured API key, or undefined when running against an OSS-default backend. */
  apiKey: string | undefined;
  apiUrl: string;
}

/**
 * Resolve config from environment.
 *
 * The API key is optional: a self-hoster pointing the MCP at an OSS-default
 * backend (RB_REQUIRE_AUTH=false) doesn't have one, and the backend ignores
 * the Authorization header in that mode. When the key is set but doesn't
 * look like an rb_live_ key we warn but continue, since the user is almost
 * certainly mis-configured but might be using a custom auth backend.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const rawKey = (env.ROSALINDDB_API_KEY ?? "").trim();
  const apiUrl = (env.ROSALINDDB_API_URL ?? DEFAULT_API_URL).trim();

  if (!rawKey) {
    return { apiKey: undefined, apiUrl };
  }

  if (!rawKey.startsWith("rb_live_")) {
    process.stderr.write(
      "[rosalinddb-mcp] warning: ROSALINDDB_API_KEY is set but does not start " +
        "with 'rb_live_'. This is almost certainly a misconfiguration; the " +
        "hosted and auth-on self-host backends both issue rb_live_ keys.\n",
    );
  }

  return { apiKey: rawKey, apiUrl };
}
