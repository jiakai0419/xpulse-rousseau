export function compactOriginalEvidenceSample(sample) {
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

export function originalEvidenceNextCaptureBatch(coverage, limit) {
  const safeLimit = Number.isInteger(Number(limit)) && Number(limit) > 0 ? Number(limit) : 30;
  return [...(coverage?.invalid ?? []).map((item) => item.sample), ...(coverage?.missing ?? [])]
    .slice(0, safeLimit)
    .map(compactOriginalEvidenceSample);
}

export function buildOriginalEvidenceCacheReport({
  createdAt,
  inventoryReportPath,
  storePath,
  importedPath,
  importedCount,
  assetReport,
  inventorySampleCount,
  coverage,
  nextBatch,
  resolvePath = (value) => value,
}) {
  return {
    createdAt,
    inventoryReportPath: resolvePath(inventoryReportPath),
    storePath: resolvePath(storePath),
    importedPath: importedPath ? resolvePath(importedPath) : undefined,
    importedCount,
    assetReport,
    inventorySampleCount,
    coveredCount: coverage.covered.length,
    invalidCount: coverage.invalid.length,
    missingCount: coverage.missing.length,
    nextBatch,
    invalid: coverage.invalid.map((item) => ({
      sample: compactOriginalEvidenceSample(item.sample),
      issues: item.issues,
      entryId: item.entryId,
    })),
  };
}

export function markdownOriginalEvidenceCacheReport(report) {
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
    `Persisted external screenshots: ${report.assetReport.persistedExternalScreenshots}`,
    `Repaired missing screenshots: ${report.assetReport.repairedMissingScreenshots}`,
    `Unresolved missing screenshots: ${report.assetReport.unresolvedMissingScreenshots}`,
    `Ambiguous missing screenshots: ${report.assetReport.ambiguousMissingScreenshots}`,
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
  lines.push("- Imported screenshots outside `.data/display-original-evidence` are copied into durable local evidence storage before the store is updated.");
  lines.push("- Missing screenshot paths are repaired only when exactly one durable screenshot for the same post id already exists under `.data/display-original-evidence`.");
  lines.push("- Rendering facts can require all collected rows by running `DISPLAY_ORACLE_REQUIRE_ALL=1 npm run x-display:compare-rendering-facts` after the cache is complete.");

  return `${lines.join("\n")}\n`;
}
