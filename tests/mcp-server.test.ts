import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import { createCmcClient, EvidenceLedger } from "@/cmc/client";
import { createMcpServer } from "@/mcp/server";
import { TOOLS } from "@/tools/registry";
import { cmcError, fakeCmc, TEST_KEY } from "./helpers";

async function connect(fetchFn = fakeCmc()) {
  const server = createMcpServer(() => {
    const ledger = new EvidenceLedger();
    return { client: createCmcClient({ apiKey: TEST_KEY, fetch: fetchFn, ledger }), ledger };
  });
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await client.connect(clientSide);
  return client;
}

describe("MCP server", () => {
  it("lists every tool in the registry", async () => {
    const client = await connect();

    const { tools } = await client.listTools();

    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
    expect(tools.find((t) => t.name === "get_quotes")?.inputSchema).toMatchObject({ type: "object" });
  });

  it("answers a tool call with data plus the evidence behind it", async () => {
    const client = await connect();

    const result = await client.callTool({ name: "get_quotes", arguments: { symbols: ["SOL"] } });

    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as { data: { coins: Array<{ name: string }> }; evidence: Array<{ id: string; endpoint: string }> };
    expect(out.data.coins[0]?.name).toBe("Solana");
    expect(out.evidence[0]).toMatchObject({ id: "E1", endpoint: "/v3/cryptocurrency/quotes/latest" });
    const text = (result.content as Array<{ type: string; text: string }>)[0]!.text;
    expect(JSON.parse(text)).toEqual(out);
  });

  it("reports CMC errors as a tool error with a readable message", async () => {
    const client = await connect(fakeCmc({ "/v3/cryptocurrency/quotes/latest": cmcError(429, 1008, "Minute rate limit reached") }));

    const result = await client.callTool({ name: "get_quotes", arguments: { symbols: ["BTC"] } });

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0]!.text).toMatch(/rate_limit.*Minute rate limit reached/);
  });
});
