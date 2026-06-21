import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  mergeOriginalEvidenceEntries,
  normalizeOriginalEvidenceDocument,
  originalEvidenceCoverage,
  validOriginalEvidenceEntry,
} from "./display-original-evidence-cache-core.mjs";
import { evidencePostId } from "./display-oracle-core.mjs";

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = process.env.DISPLAY_ORIGINAL_CACHE_DIR || `.data/display-original-evidence/cache-${timestamp}`;
const storePath = process.env.DISPLAY_ORIGINAL_EVIDENCE_STORE || ".data/display-original-evidence/original-evidence-store.json";
const batchLimit = positiveInt(process.env.DISPLAY_ORIGINAL_CACHE_LIMIT, 30);

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readJson(filePath, fallback) {
  if (!existsSync(filePath)) {
    return fallback;
  }

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

function compactSample(sample) {
  return {
    index: sample.index,
    postId: sample.postId,
    url: sample.url,
    author: sample.author?.username ? `@${sample.author.username}` : undefined,
    buckets: sample.buckets ?? [],
    risks: sample.risks ?? [],
    missingData: sample.missingData ?? [],
    textStart: sample.textStart,
  };
}

function markdownReport(report) {
  const lines = [
    "# Original Rendering Evidence",
    "",
    `Created: ${report.createdAt}`,
    `Inventory: \`${report.inventoryReportPath}\``,
    `Store: \`${report.storePath}\``,
    `Inventory samples: ${report.inventorySampleCount}`,
    `Cached valid samples: ${report.coveredCount}`,
    `Cached invalid samples: ${report.invalidCount}`,
    `Missing samples: ${report.missingCount}`,
    "",
    "## Next Capture Batch",
    "",
    "| # | Post | Author | Buckets | Risks | Missing Data |",
    "| ---: | --- | --- | --- | --- | --- |",
  ];

  for (const sample of report.nextBatch) {
    lines.push(
      `| ${sample.index} | [${sample.postId}](${sample.url}) | ${sample.author ?? "-"} | ${(sample.buckets ?? []).join(", ") || "-"} | ${(sample.risks ?? []).join(", ") || "-"} | ${(sample.missingData ?? []).join(", ") || "-"} |`,
    );
  }

  if (!report.nextBatch.length) {
    lines.push("| - | - | - | - | - | - |");
  }

  if (report.invalid.length) {
    lines.push("", "## Invalid Cached Evidence", "", "| Post | Issues |", "| --- | --- |");
    for (const item of report.invalid) {
      lines.push(`| [${item.sample.postId}](${item.sample.url}) | ${item.issues.join(", ")} |`);
    }
  }

  lines.push("", "## Notes", "");
  lines.push("- Capture Original X evidence in batches from the already-authenticated normal Chrome session.");
  lines.push("- Import each batch with `DISPLAY_ORIGINAL_CACHE_IMPORT=<batch-results.json> npm run x-display:collect-original-renderings`.");
  lines.push("- Rendering facts can require all collected rows by running `DISPLAY_ORACLE_REQUIRE_ALL=1 npm run x-display:compare-rendering-facts` after the cache is complete.");

  return `${lines.join("\n")}\n`;
}

function main() {
  const inventoryReportPath = process.env.DISPLAY_ORIGINAL_CACHE_INVENTORY_REPORT || latestInventoryReport();
  const inventoryReport = readJson(inventoryReportPath);
  const existingDocument = readJson(storePath, { version: 1, entries: [] });
  const existingEntries = normalizeOriginalEvidenceDocument(existingDocument);
  const importPath = process.env.DISPLAY_ORIGINAL_CACHE_IMPORT;
  const importedEntries = importPath ? normalizeOriginalEvidenceDocument(readJson(importPath)) : [];
  const mergedEntries = mergeOriginalEvidenceEntries(existingEntries, importedEntries);
  const coverage = originalEvidenceCoverage(inventoryReport.samples ?? [], mergedEntries);
  const validEntries = coverage.covered.map((item) => item.entry);
  const nextBatch = [...coverage.invalid.map((item) => item.sample), ...coverage.missing].slice(0, batchLimit).map(compactSample);

  mkdirSync(outputDir, { recursive: true });
  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(
    storePath,
    JSON.stringify(
      {
        version: 1,
        updatedAt: new Date().toISOString(),
        entries: mergedEntries,
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(join(outputDir, "originals-for-oracle.json"), JSON.stringify(validEntries, null, 2), "utf8");
  writeFileSync(join(outputDir, "next-batch.json"), JSON.stringify({ samples: nextBatch }, null, 2), "utf8");

  const report = {
    createdAt: new Date().toISOString(),
    inventoryReportPath: resolve(inventoryReportPath),
    storePath: resolve(storePath),
    importedPath: importPath ? resolve(importPath) : undefined,
    importedCount: importedEntries.length,
    inventorySampleCount: inventoryReport.samples?.length ?? 0,
    coveredCount: coverage.covered.length,
    invalidCount: coverage.invalid.length,
    missingCount: coverage.missing.length,
    nextBatch,
    invalid: coverage.invalid.map((item) => ({
      sample: compactSample(item.sample),
      issues: item.issues,
      entryId: evidencePostId(item.entry),
    })),
  };

  writeFileSync(join(outputDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  writeFileSync(join(outputDir, "report.md"), markdownReport(report), "utf8");

  const invalidImports = importedEntries.filter((entry) => !validOriginalEvidenceEntry(entry).valid);
  if (invalidImports.length) {
    console.warn(`Imported ${invalidImports.length} invalid Original evidence entr${invalidImports.length === 1 ? "y" : "ies"}; see report.`);
  }

  console.log(
    `OK x-display:collect-original-renderings: ${coverage.covered.length}/${inventoryReport.samples?.length ?? 0} valid, ${coverage.missing.length} missing, ${coverage.invalid.length} invalid. Report: ${join(outputDir, "report.md")}`,
  );
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
