/**
 * End-to-end check of the real MCP server: starts `src/mcp/stdio.ts` as a
 * child process (exactly like Claude Desktop would), lists its tools and
 * makes live calls with your key from .env.
 *
 * Usage: npm run mcp:smoke   (costs about 4 CMC credits)
 */
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const transport = new StdioClientTransport({ command: process.execPath, args: ["--import", "tsx", "src/mcp/stdio.ts"], stderr: "inherit" });
const client = new Client({ name: "smoke-test", version: "1.0.0" });

await client.connect(transport);
const { tools } = await client.listTools();
console.log(`Tools: ${tools.map((t) => t.name).join(", ")}`);

for (const [name, args] of [
  ["get_quotes", { symbols: ["BTC", "SOL"] }],
  ["get_market_context", {}],
] as const) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Array<{ text: string }>)[0]?.text ?? "";
  console.log(`\n${name} ${result.isError ? "ERROR" : "OK"}:\n${text.slice(0, 700)}${text.length > 700 ? " ..." : ""}`);
}
await client.close();
