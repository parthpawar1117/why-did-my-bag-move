/**
 * MCP server exposing the tool registry, so AI assistants (Claude Desktop,
 * Cursor, ...) can call the same CoinMarketCap tools the web app uses.
 */
import { McpServer } from "@modelcontextprotocol/server";
import { CmcError } from "@/cmc/client";
import { TOOLS, type ToolContext } from "@/tools/registry";

export const SERVER_INFO = { name: "why-did-my-bag-move", version: "0.1.0" };

/**
 * @param makeContext called once per tool call, so each call gets its own
 *   evidence ledger (citations start at E1) while sharing the cache.
 */
export function createMcpServer(makeContext: () => ToolContext): McpServer {
  const server = new McpServer(SERVER_INFO, { capabilities: { tools: {} } });

  for (const tool of TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: true, openWorldHint: true },
      },
      async (args) => {
        try {
          const output = await tool.run(args, makeContext());
          return {
            content: [{ type: "text" as const, text: JSON.stringify(output) }],
            structuredContent: output as unknown as Record<string, unknown>,
          };
        } catch (err) {
          const text =
            err instanceof CmcError ? `CoinMarketCap error (${err.kind}): ${err.message}` : `Tool failed: ${err instanceof Error ? err.message : String(err)}`;
          return { isError: true, content: [{ type: "text" as const, text }] };
        }
      },
    );
  }
  return server;
}
