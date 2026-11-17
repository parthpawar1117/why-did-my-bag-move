import { describe, expect, it } from "vitest";
import { pickBestMatch } from "@/cmc/resolve";
import { sample } from "./helpers";

type Coin = { id: number; symbol: string; name: string; cmc_rank: number | null; is_active?: number };

describe("pickBestMatch", () => {
  it("picks the real Solana out of the look-alikes in a real response", () => {
    const coins = (sample("quotes-latest").response as { data: Coin[] }).data.filter((c) => c.symbol);

    expect(pickBestMatch(coins, "SOL")).toMatchObject({ id: 5426, name: "Solana" });
    expect(pickBestMatch(coins, "eth")).toMatchObject({ id: 1027, name: "Ethereum" });
  });

  it("prefers active, ranked coins and falls back to the lowest id", () => {
    const coins: Coin[] = [
      { id: 9, symbol: "X", name: "Unranked", cmc_rank: null },
      { id: 7, symbol: "X", name: "Inactive", cmc_rank: 3, is_active: 0 },
      { id: 8, symbol: "X", name: "Ranked", cmc_rank: 50, is_active: 1 },
      { id: 2, symbol: "Y", name: "Old", cmc_rank: null },
      { id: 5, symbol: "Y", name: "New", cmc_rank: null },
    ];

    expect(pickBestMatch(coins, "X")?.name).toBe("Ranked");
    expect(pickBestMatch(coins, "Y")?.name).toBe("Old");
  });

  it("returns undefined for an unknown symbol", () => {
    expect(pickBestMatch([], "NOPE")).toBeUndefined();
  });
});
