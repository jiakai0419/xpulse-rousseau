import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { scanTextForSecrets } from "./secret-scan-core.mjs";

const trackedFiles = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);
const findings = [];

for (const file of trackedFiles) {
  const stat = statSync(file);
  if (!stat.isFile() || stat.size > 5 * 1024 * 1024) {
    continue;
  }

  const buffer = readFileSync(file);
  if (buffer.includes(0)) {
    continue;
  }

  const text = buffer.toString("utf8");
  for (const finding of scanTextForSecrets(text)) {
    findings.push({ file, ...finding });
  }
}

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`Potential ${finding.label} in ${finding.file}:${finding.line} (${finding.redacted}).`);
  }
  console.error("Refusing to pass tracked-secret check. Remove the credential and rotate it if it was real.");
  process.exit(1);
}

console.log(`OK secret check: scanned ${trackedFiles.length} tracked and untracked worktree paths.`);
