/**
 * Scans every file git would include in a push (tracked + untracked, minus
 * .gitignore'd ones) for API keys. Exits non-zero if anything is found.
 * Usage: npm run check:secrets
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { findSecrets, type ScannedFile } from "../src/security/scan-secrets";

const listed = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
})
  .split("\n")
  .map((line) => line.trim())
  .filter(Boolean);

const files: ScannedFile[] = [];
for (const path of listed) {
  try {
    // Skip large binaries (images, recordings); keys live in text files.
    if (statSync(path).size > 2_000_000) continue;
    files.push({ path, content: readFileSync(path, "utf8") });
  } catch {
    // File listed by git but deleted locally: nothing to scan.
  }
}

const hits = findSecrets(files);
if (hits.length > 0) {
  console.error("Possible secrets found. Remove them before committing:");
  for (const hit of hits) console.error(`  ${hit.path}:${hit.line}  (${hit.kind})`);
  process.exit(1);
}
console.log(`check:secrets OK: scanned ${files.length} files, no API keys found.`);
