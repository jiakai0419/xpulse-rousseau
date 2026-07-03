import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  mergeOriginalEvidenceEntries,
  normalizeOriginalEvidenceDocument,
  originalEvidenceCoverage,
  validOriginalEvidenceEntry,
  evidencePostId,
} from "./display-evidence-core.mjs";
import { normalizeOriginalEvidenceScreenshotAssets } from "./display-evidence-assets.mjs";
import {
  buildOriginalEvidenceCacheReport,
  markdownOriginalEvidenceCacheReport,
  originalEvidenceNextCaptureBatch,
} from "./display-original-evidence-cache-core.mjs";

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

function main() {
  const inventoryReportPath = process.env.DISPLAY_ORIGINAL_CACHE_INVENTORY_REPORT || latestInventoryReport();
  const inventoryReport = readJson(inventoryReportPath);
  const existingDocument = readJson(storePath, { version: 1, entries: [] });
  const existingEntries = normalizeOriginalEvidenceDocument(existingDocument);
  const importPath = process.env.DISPLAY_ORIGINAL_CACHE_IMPORT;
  const importedEntries = importPath ? normalizeOriginalEvidenceDocument(readJson(importPath)) : [];
  const mergedEntries = mergeOriginalEvidenceEntries(existingEntries, importedEntries);
  const assetNormalization = normalizeOriginalEvidenceScreenshotAssets(mergedEntries);
  const normalizedEntries = assetNormalization.entries;
  const coverage = originalEvidenceCoverage(inventoryReport.samples ?? [], normalizedEntries);
  const validEntries = coverage.covered.map((item) => item.entry);
  const nextBatch = originalEvidenceNextCaptureBatch(coverage, batchLimit);

  mkdirSync(outputDir, { recursive: true });
  mkdirSync(dirname(storePath), { recursive: true });
  writeFileSync(
    storePath,
    JSON.stringify(
      {
        version: 1,
        updatedAt: new Date().toISOString(),
        entries: normalizedEntries,
      },
      null,
      2,
    ),
    "utf8",
  );
  writeFileSync(join(outputDir, "originals-for-oracle.json"), JSON.stringify(validEntries, null, 2), "utf8");
  writeFileSync(join(outputDir, "next-batch.json"), JSON.stringify({ samples: nextBatch }, null, 2), "utf8");

  const report = buildOriginalEvidenceCacheReport({
    createdAt: new Date().toISOString(),
    inventoryReportPath,
    storePath,
    importedPath: importPath,
    importedCount: importedEntries.length,
    assetReport: assetNormalization.report,
    inventorySampleCount: inventoryReport.samples?.length ?? 0,
    coverage: {
      ...coverage,
      invalid: coverage.invalid.map((item) => ({
        ...item,
        entryId: evidencePostId(item.entry),
      })),
    },
    nextBatch,
    resolvePath: resolve,
  });

  writeFileSync(join(outputDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  writeFileSync(join(outputDir, "report.md"), markdownOriginalEvidenceCacheReport(report), "utf8");

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
