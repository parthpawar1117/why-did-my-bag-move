/**
 * Finds API keys that must never be committed. The hackathon rules say a key
 * committed to the public repo has to be rotated and counts against code
 * quality, so `npm run check:secrets` runs this over every file git would push.
 */

export type SecretKind = "anthropic-key" | "cmc-key" | "env-file";

export interface SecretHit {
  path: string;
  line: number;
  kind: SecretKind;
}

export interface ScannedFile {
  path: string;
  content: string;
}

// Real Anthropic keys are long; "sk-ant-..." in docs is not a key.
const ANTHROPIC_KEY = /sk-ant-[A-Za-z0-9_-]{20,}/;
// CMC keys are UUIDs. Only flag a UUID when it sits next to a CMC key name,
// so ordinary UUIDs (test fixtures, IDs) don't trip the check.
const CMC_KEY = /CMC_PRO_API_KEY["']?\s*[:=]\s*["']?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function isEnvFile(path: string): boolean {
  const name = path.split(/[\\/]/).pop() ?? "";
  return (name === ".env" || name.startsWith(".env.")) && name !== ".env.example";
}

export function findSecrets(files: ScannedFile[]): SecretHit[] {
  const hits: SecretHit[] = [];
  for (const file of files) {
    if (isEnvFile(file.path)) {
      hits.push({ path: file.path, line: 1, kind: "env-file" });
      continue;
    }
    file.content.split(/\r?\n/).forEach((text, index) => {
      if (ANTHROPIC_KEY.test(text)) hits.push({ path: file.path, line: index + 1, kind: "anthropic-key" });
      if (CMC_KEY.test(text)) hits.push({ path: file.path, line: index + 1, kind: "cmc-key" });
    });
  }
  return hits;
}
