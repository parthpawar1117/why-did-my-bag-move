/**
 * Starts the MCP server over stdio: `npm run mcp`.
 *
 * Reads CMC_PRO_API_KEY from the environment or from the project's .env.
 * Nothing may be printed to stdout except MCP messages, so all logging goes
 * to stderr.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createLiveContextFactory } from "@/tools/live-context";
import { createMcpServer } from "./server";

if (!process.env.CMC_PRO_API_KEY) {
  try {
    process.loadEnvFile(resolve(dirname(fileURLToPath(import.meta.url)), "../../.env"));
  } catch {
    // No .env file: the key may still come from the MCP client's config.
  }
}

let makeContext;
try {
  makeContext = createLiveContextFactory({ apiKey: process.env.CMC_PRO_API_KEY });
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

serveStdio(() => createMcpServer(makeContext));
console.error("why-did-my-bag-move MCP server running on stdio");
