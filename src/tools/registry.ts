/**
 * One list of tools, shared by the MCP server and the web app.
 * Every tool returns `{ data, evidence }` so any number can be traced to the
 * CoinMarketCap request that produced it.
 */
import { z } from "zod";
import { explainPortfolio, type Report } from "@/engine/explain";
import { getCoinSectors, getLiquidations, getMarketContext, getQuotes, getRwaQuotes } from "./data-tools";
import type { AnyTool, ToolDef } from "./types";

export { getCoinSectors, getLiquidations, getMarketContext, getQuotes, getRwaQuotes };
export type { AnyTool, Citation, ToolContext, ToolDef, ToolOutput } from "./types";

const holdingsInput = z.object({
  holdings: z
    .array(
      z.object({
        symbol: z.string().trim().min(1).max(20).describe("Ticker, e.g. BTC, SOL, PAXG"),
        amount: z.number().positive().describe("How many units you hold"),
      }),
    )
    .min(1)
    .max(25),
});

export const explainPortfolioMove: ToolDef<typeof holdingsInput, Omit<Report, "evidence">> = {
  name: "explain_portfolio_move",
  title: "Why did my bag move?",
  description:
    "Explains a portfolio's last-24h profit or loss: splits each coin's move into whole-market (via its 30-day beta), sector and coin-specific parts, adds sentiment and liquidation context, and returns a plain-English explanation where every figure cites the CoinMarketCap call it came from.",
  inputSchema: holdingsInput,
  async run({ holdings }, ctx) {
    const { evidence, ...data } = await explainPortfolio(holdings, ctx);
    return { data, evidence };
  },
};

export const TOOLS: AnyTool[] = [explainPortfolioMove, getQuotes, getMarketContext, getCoinSectors, getLiquidations, getRwaQuotes] as AnyTool[];
