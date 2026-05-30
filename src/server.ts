/**
 * Builds the RosalindDB MCP server: registers every tool from the tool
 * registry, validates inputs with zod, calls the API client, and maps
 * RosalindDB API errors onto clean MCP tool errors (never a raw stack trace).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { RosalindClient } from "./client.js";
import { RosalindApiError } from "./errors.js";
import { TOOLS } from "./tools.js";
import { PACKAGE_VERSION } from "./version.js";

export interface BuildServerOptions {
  client: RosalindClient;
}

/**
 * Convert any thrown error into a clean MCP tool result with isError set.
 * RosalindApiError -> actionable message; everything else -> generic message.
 */
function toErrorResult(err: unknown) {
  let message: string;
  if (err instanceof RosalindApiError) {
    message = err.toToolMessage();
  } else if (err instanceof z.ZodError) {
    message = `Invalid tool input: ${err.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ")}`;
  } else if (err instanceof Error) {
    message = `RosalindDB MCP error: ${err.message}`;
  } else {
    message = `RosalindDB MCP error: ${String(err)}`;
  }
  return {
    isError: true,
    content: [{ type: "text" as const, text: message }],
  };
}

/** Build and return a configured McpServer instance. */
export function buildServer(opts: BuildServerOptions): McpServer {
  const server = new McpServer({
    name: "rosalinddb-mcp",
    version: PACKAGE_VERSION,
  });

  // A permissive inputSchema used at registration time. The MCP SDK's pre-call
  // validator runs against whatever schema is registered and, on failure,
  // throws a JSON-RPC -32602 error BEFORE our handler runs — which clients
  // then surface as a multi-line zod issue dump inside content[0].text instead
  // of the documented single-line `isError:true` tool-result envelope. To
  // keep the handler in charge of validation (so a ZodError flows through
  // `toErrorResult` and becomes "Invalid tool input: <field>: <msg>; ..."),
  // we register an "accept anything object" inputSchema and re-validate
  // against the tool's real schema inside the handler. `.passthrough()` is
  // required so unknown keys are not stripped before the handler sees them
  // (otherwise the handler validates an empty object and reports every field
  // as Required). Side effect: tools/list no longer advertises per-tool input
  // shapes to clients — acceptable, since most MCP clients don't surface
  // inputSchema to the model and our tool descriptions call out required
  // fields explicitly. The server-side schema remains authoritative.
  const passthroughObject = z.object({}).passthrough();

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: passthroughObject as unknown as z.ZodRawShape,
      },
      async (args: unknown) => {
        try {
          const parsed = tool.schema.parse(args ?? {});
          const result = await tool.handler(opts.client, parsed);
          return {
            content: [
              {
                type: "text" as const,
                text:
                  result === undefined
                    ? "OK"
                    : JSON.stringify(result, null, 2),
              },
            ],
          };
        } catch (err) {
          return toErrorResult(err);
        }
      },
    );
  }

  return server;
}
