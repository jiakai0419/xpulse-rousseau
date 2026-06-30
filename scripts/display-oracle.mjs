import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { evidencePostId, normalizeOriginalEvidenceDocument } from "./display-evidence-core.mjs";
import { displayOracleFailureIssues, evaluateDisplayOracle } from "./display-oracle-core.mjs";
import { defaultRuleLedgerPath } from "./display-rule-ledger.mjs";

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = process.env.DISPLAY_ORACLE_DIR || `.data/display-oracle/display-oracle-${timestamp}`;
const allowDiffs = process.env.DISPLAY_ORACLE_ALLOW_DIFFS === "1";
const requireAllInventorySamples = process.env.DISPLAY_ORACLE_REQUIRE_ALL === "1";

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function latestInventoryReport() {
  const root = ".data/display-gap-inventory";
  if (!existsSync(root)) {
    throw new Error("No display inventory directory found. Run `npm run x-display:collect-local-renderings` first.");
  }

  const candidates = readdirSync(root)
    .map((name) => join(root, name, "report.json"))
    .filter((filePath) => existsSync(filePath))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

  if (!candidates.length) {
    throw new Error("No display inventory report found. Run `npm run x-display:collect-local-renderings` first.");
  }

  return candidates[0];
}

function defaultOriginalEvidencePath(inventoryReportPath, inventoryReport) {
  const storePath = process.env.DISPLAY_ORIGINAL_EVIDENCE_STORE || ".data/display-original-evidence/original-evidence-store.json";
  if (existsSync(storePath)) {
    return storePath;
  }

  const inventoryDir = inventoryReport.outputDir || dirname(inventoryReportPath);
  return join(inventoryDir, "original-chrome-screenshots", "original-chrome-results.json");
}

function selectedPostIdsFromEnv(originalEntries) {
  const raw = process.env.DISPLAY_ORACLE_SAMPLE_IDS;
  if (raw) {
    return raw
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
  }

  if (requireAllInventorySamples) {
    return undefined;
  }

  return originalEntries.map(evidencePostId).filter(Boolean);
}

function markdownReport(report) {
  const lines = [
    "# X Display Rendering Facts Report",
    "",
    `Created: ${report.createdAt}`,
    `Inventory: \`${report.inventoryReportPath}\``,
    `Original evidence: \`${report.originalEvidencePath}\``,
    `Rule ledger: \`${report.ruleLedgerPath}\``,
    `Samples checked: ${report.summary.sampleCount}`,
    `Passed: ${report.summary.passedCount}`,
    `Failed: ${report.summary.failedCount}`,
    `Blocked: ${report.summary.blockedCount}`,
    "",
    "## Principle",
    "",
    "This report treats local Reader screenshots/facts and Original X screenshots/facts as mandatory evidence for the audited sample set. Rendering rules explain diffs; they do not decide whether a diff exists.",
    "",
    "## Results",
    "",
    "| Post | Status | Evidence blockers | Fact diffs | Rule explanations | Local | Original |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const row of report.samples) {
    const blockers = row.result.blocked.length ? row.result.blocked.join(", ") : "-";
    const diffs = row.result.factDiffs.length ? row.result.factDiffs.join(", ") : "-";
    const explanations = row.result.explanations.length ? row.result.explanations.map((item) => `${item.diff} -> ${item.rule}`).join("<br>") : "-";
    lines.push(
      `| [${row.postId}](${row.url}) | ${row.result.status} | ${blockers} | ${diffs} | ${explanations} | ${row.localScreenshot ? `[local](${row.localScreenshot})` : "-"} | ${row.originalScreenshot ? `[original](${row.originalScreenshot})` : "-"} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

function main() {
  const inventoryReportPath = process.env.DISPLAY_ORACLE_INVENTORY_REPORT || latestInventoryReport();
  const inventoryReport = readJson(inventoryReportPath);
  const originalEvidencePath = process.env.DISPLAY_ORACLE_ORIGINALS || defaultOriginalEvidencePath(inventoryReportPath, inventoryReport);

  if (!existsSync(originalEvidencePath)) {
    throw new Error(
      `Original evidence is mandatory for x-display:compare-rendering-facts. Missing: ${originalEvidencePath}. Capture Original X screenshots/facts from the already-authenticated Chrome session first.`,
    );
  }

  const originalEntries = normalizeOriginalEvidenceDocument(readJson(originalEvidencePath));
  const selectedPostIds = selectedPostIdsFromEnv(originalEntries);
  const selectedSet = selectedPostIds ? new Set(selectedPostIds) : undefined;
  const summary = evaluateDisplayOracle({
    samples: inventoryReport.samples,
    originalEntries,
    selectedPostIds,
  });

  if (summary.sampleCount === 0) {
    throw new Error("x-display:compare-rendering-facts has no samples to check. Provide DISPLAY_ORACLE_SAMPLE_IDS or Original evidence entries.");
  }

  const originalsById = new Map(originalEntries.map((entry) => [evidencePostId(entry), entry]));
  const samples = inventoryReport.samples
    .filter((sample) => !selectedSet || selectedSet.has(String(sample.postId)))
    .map((sample) => {
      const original = originalsById.get(String(sample.postId));
      const result = summary.results.find((item) => item.postId === sample.postId);
      return {
        postId: sample.postId,
        url: sample.url,
        author: sample.author,
        buckets: sample.buckets,
        risks: sample.risks,
        missingData: sample.missingData,
        localScreenshot: sample.localScreenshot,
        originalScreenshot: original?.screenshot,
        result,
      };
    });

  const report = {
    createdAt: new Date().toISOString(),
    inventoryReportPath: resolve(inventoryReportPath),
    originalEvidencePath: resolve(originalEvidencePath),
    ruleLedgerPath: resolve(defaultRuleLedgerPath),
    outputDir,
    selectedPostIds: selectedPostIds ?? "all_inventory_samples",
    summary,
    samples,
  };

  mkdirSync(outputDir, { recursive: true });
  writeFileSync(join(outputDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  writeFileSync(join(outputDir, "report.md"), markdownReport(report), "utf8");

  const failureIssues = displayOracleFailureIssues(summary, {
    allowDiffs,
    requireAllInventorySamples,
  });

  if (failureIssues.length) {
    const description = failureIssues.map((issue) => `${issue.count} ${issue.kind}`).join(", ");
    throw new Error(`x-display:compare-rendering-facts found ${description} sample(s). Report: ${join(outputDir, "report.md")}`);
  }

  console.log(`OK x-display:compare-rendering-facts: ${summary.sampleCount} samples. Report: ${join(outputDir, "report.md")}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
