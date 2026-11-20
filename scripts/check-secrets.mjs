// No tokens committed: cheap regex scan of tracked files (use gitleaks if this ever needs to be broader).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PATTERNS = [/\bghp_[A-Za-z0-9]{20,}/, /\bgithub_pat_[A-Za-z0-9_]{20,}/, /\bgh[ousr]_[A-Za-z0-9]{20,}/, /Bearer\s+[A-Za-z0-9._-]{12,}/, /-----BEGIN [A-Z ]*PRIVATE KEY-----/];
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" }).split("\0").filter((f) => f && !f.endsWith("package-lock.json") && !f.startsWith("scripts/check-secrets"));
const hits = [];
for (const f of files) {
  let text;
  try { text = readFileSync(f, "utf8"); } catch { continue; }
  if (text.includes("\0")) continue; // binary
  text.split("\n").forEach((line, i) => { if (PATTERNS.some((p) => p.test(line))) hits.push(`${f}:${i + 1}`); });
}
if (hits.length) { console.error("Possible secret in:\n" + hits.join("\n")); process.exit(1); }
console.log(`No secrets found (${files.length} files)`);
