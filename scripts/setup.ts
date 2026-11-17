/**
 * One-command setup: npm run setup
 *
 * 1. Creates .env.example (placeholder only) and .env if they don't exist.
 * 2. Opens .env in Notepad so you can paste your CoinMarketCap key.
 * 3. Waits until a key is saved, checks it with /v1/key/info (costs 0 credits),
 *    shows your plan, then runs the endpoint check (npm run probe).
 *
 * Your key is never printed, logged, or sent anywhere except CoinMarketCap.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const TEMPLATE = `# Copy this file to .env and fill in your own key. .env is gitignored.

# CoinMarketCap Pro API key: https://pro.coinmarketcap.com/account (free Basic plan works)
CMC_PRO_API_KEY=your-cmc-api-key-here
`;

// Loose shape check only (CoinMarketCap itself validates the key below):
// at least 20 key-like characters and not the placeholder.
const KEY_SHAPE = /^[A-Za-z0-9-]{20,}$/;

function readKey(): string | null {
  if (!existsSync(".env")) return null;
  const line = readFileSync(".env", "utf8")
    .split(/\r?\n/)
    .find((l) => l.trim().startsWith("CMC_PRO_API_KEY="));
  const value = line?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "").trim() ?? "";
  return value !== "your-cmc-api-key-here" && KEY_SHAPE.test(value) ? value : null;
}

async function waitForKey(timeoutMs: number): Promise<string | null> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const key = readKey();
    if (key) return key;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

async function main() {
  if (!existsSync(".env.example")) {
    writeFileSync(".env.example", TEMPLATE);
    console.log("Created .env.example (placeholder only, safe to commit).");
  }
  if (!existsSync(".env")) {
    writeFileSync(".env", TEMPLATE.replace("# Copy this file to .env and fill in your own key. .env is gitignored.", "# Your private keys. This file is gitignored and never committed."));
    console.log("Created .env (private, gitignored).");
  }

  let key = readKey();
  if (!key) {
    console.log("\nOpening .env in Notepad...");
    console.log("  1. Replace  your-cmc-api-key-here  with your key (from https://pro.coinmarketcap.com/account)");
    console.log("  2. Press Ctrl+S to save, then close Notepad.\n");
    if (process.platform === "win32") spawn("notepad.exe", [".env"], { detached: true, stdio: "ignore" }).unref();
    else console.log("(Open .env in any text editor.)");
    console.log("Waiting for you to save the key (up to 10 minutes)...");
    key = await waitForKey(10 * 60 * 1000);
    if (!key) {
      console.error("\nNo key found in .env. The line should be CMC_PRO_API_KEY=<your key> with no spaces. Run `npm run setup` again.");
      process.exit(1);
    }
  }

  console.log("Key found. Checking it with CoinMarketCap (/v1/key/info, 0 credits)...");
  const res = await fetch("https://pro-api.coinmarketcap.com/v1/key/info", {
    headers: { Accept: "application/json", "X-CMC_PRO_API_KEY": key },
  });
  const body = (await res.json().catch(() => null)) as {
    data?: { plan?: { credit_limit_monthly?: number; rate_limit_minute?: number }; usage?: { current_month?: { credits_left?: number } } };
    status?: { error_message?: string };
  } | null;
  if (!res.ok) {
    console.error(`\nCoinMarketCap rejected the key (HTTP ${res.status}): ${body?.status?.error_message ?? "unknown error"}`);
    console.error("Copy the key again from https://pro.coinmarketcap.com/account, fix .env, and re-run `npm run setup`.");
    process.exit(1);
  }
  const plan = body?.data?.plan;
  console.log(
    `Key works. Monthly credits: ${plan?.credit_limit_monthly ?? "?"}, per-minute limit: ${plan?.rate_limit_minute ?? "?"}, credits left this month: ${body?.data?.usage?.current_month?.credits_left ?? "?"}.`,
  );

  console.log("\nRunning the endpoint check (npm run probe)...\n");
  const probe = spawnSync("npm", ["run", "probe"], { stdio: "inherit", shell: true });
  process.exit(probe.status ?? 1);
}

main().catch((err) => {
  console.error("Setup failed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
