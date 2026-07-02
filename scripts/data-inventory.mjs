import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildDataInventory, markdownInventoryReport } from "./data-inventory-core.mjs";

const rootPath = process.env.DATA_INVENTORY_ROOT || ".data";
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = process.env.DATA_INVENTORY_DIR || join(rootPath, "data-inventory", `data-inventory-${timestamp}`);

try {
  const report = {
    ...buildDataInventory(rootPath),
    outputDir,
  };

  mkdirSync(outputDir, { recursive: true });

  writeFileSync(join(outputDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  writeFileSync(join(outputDir, "report.md"), markdownInventoryReport(report), "utf8");

  console.log(`Data inventory scanned ${rootPath}.`);
  console.log(`Total size: ${report.scan.humanTotalBytes ?? "0 B"} across ${report.scan.totalFiles} files.`);
  console.log(`Runs: ${report.runs.totalRuns} total, ${report.runs.liveRuns} live, ${report.runs.replayRuns} replay.`);
  console.log(`Original evidence: ${report.originalEvidence.entries} entries.`);
  console.log(`Report: ${join(outputDir, "report.md")}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
