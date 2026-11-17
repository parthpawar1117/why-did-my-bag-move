import type { z } from "zod";
import type { CmcClient, EvidenceEntry, EvidenceLedger } from "@/cmc/client";

export interface ToolContext {
  client: CmcClient;
  ledger: EvidenceLedger;
}

/** An evidence entry without the bulky raw response (that stays in the ledger). */
export type Citation = Omit<EvidenceEntry, "response">;

export interface ToolOutput<D> {
  data: D;
  evidence: Citation[];
}

export interface ToolDef<S extends z.ZodObject, D> {
  name: string;
  title: string;
  description: string;
  inputSchema: S;
  run(input: z.infer<S>, ctx: ToolContext): Promise<ToolOutput<D>>;
}

export type AnyTool = ToolDef<z.ZodObject, unknown>;
