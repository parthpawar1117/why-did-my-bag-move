import { describe, expect, it } from "vitest";
import { findSecrets } from "@/security/scan-secrets";

// Fake keys are assembled at runtime so this file never contains a
// key-shaped string itself (otherwise `npm run check:secrets` flags it).
const FAKE_ANTHROPIC_KEY = ["sk", "ant", "api03", "abcdefghijklmnopqrstuvwxyz0123456789"].join("-");
const FAKE_CMC_KEY = ["1b2c3d4e", "5f60", "4a7b", "8c9d", "0e1f2a3b4c5d"].join("-");
const CMC_VAR = ["CMC", "PRO", "API", "KEY"].join("_");

describe("findSecrets", () => {
  it("flags an Anthropic API key", () => {
    const hits = findSecrets([{ path: "src/a.ts", content: `const k = "${FAKE_ANTHROPIC_KEY}";` }]);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ path: "src/a.ts", line: 1, kind: "anthropic-key" });
  });

  it("flags a hard-coded CMC key assigned to the env var name", () => {
    const hits = findSecrets([{ path: "x.ts", content: `\n\n${CMC_VAR}=${FAKE_CMC_KEY}` }]);
    expect(hits).toEqual([expect.objectContaining({ line: 3, kind: "cmc-key" })]);
  });

  it("flags a CMC key sent inline as the request header", () => {
    const hits = findSecrets([{ path: "x.ts", content: `headers: { "X-${CMC_VAR}": "${FAKE_CMC_KEY}" }` }]);
    expect(hits[0]?.kind).toBe("cmc-key");
  });

  it("flags a tracked .env file regardless of content", () => {
    expect(findSecrets([{ path: ".env", content: "" }])[0]?.kind).toBe("env-file");
    expect(findSecrets([{ path: "apps/web/.env.local", content: "" }])[0]?.kind).toBe("env-file");
  });

  it("allows placeholders, env lookups and the .env.example file", () => {
    const hits = findSecrets([
      { path: ".env.example", content: "CMC_PRO_API_KEY=your-cmc-api-key-here\nANTHROPIC_API_KEY=your-anthropic-api-key-here" },
      { path: "src/c.ts", content: 'headers: { "X-CMC_PRO_API_KEY": process.env.CMC_PRO_API_KEY ?? "" }' },
      { path: "README.md", content: "Set `CMC_PRO_API_KEY` in .env, keys look like sk-ant-..." },
    ]);
    expect(hits).toEqual([]);
  });
});
