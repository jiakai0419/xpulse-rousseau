import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const dataCategoryDefinitions = {
  "product-state": {
    label: "Product state",
    retention: "keep; private local state required by the Reader",
    deletePolicy: "never delete automatically",
  },
  "canonical-evidence": {
    label: "Canonical evidence",
    retention: "keep until a newer accepted baseline explicitly replaces it",
    deletePolicy: "do not delete automatically",
  },
  "evidence-report": {
    label: "Generated evidence report",
    retention: "keep current and important reports; older runs can be archived after a newer baseline is recorded",
    deletePolicy: "manual review before pruning",
  },
  "data-inventory-report": {
    label: "Data inventory report",
    retention: "keep recent inventory reports; safe to regenerate",
    deletePolicy: "safe to prune after a newer inventory exists",
  },
  "browser-profile": {
    label: "Browser profile",
    retention: "local-only browser state; can be recreated, may contain cookies",
    deletePolicy: "manual review before deleting",
  },
  "transient-debug": {
    label: "Transient debug artifact",
    retention: "short-lived local diagnostics",
    deletePolicy: "safe to delete after confirming it is not part of an active investigation",
  },
  "unknown-local-data": {
    label: "Unknown local data",
    retention: "inspect before deciding",
    deletePolicy: "never delete automatically",
  },
};

const productStateFiles = new Set([
  "runs.json",
  "seen-posts.json",
  "timeline-cursor.json",
  "x-oauth.json",
  "openai-cache.json",
  "link-preview-cache.json",
  "x-snapshots.json",
]);

const evidenceReportRoots = new Set([
  "display-gap-inventory",
  "display-oracle",
  "display-original-evidence",
  "display-visual-review",
  "render-audit",
  "render-coverage",
  "render-regression",
]);

export function normalizeDataPath(pathname) {
  return String(pathname ?? "")
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/^\.data\/?/, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
}

export function classifyDataPath(pathname) {
  const relativePath = normalizeDataPath(pathname);
  const [topLevel] = relativePath.split("/");

  if (!relativePath) {
    return category("unknown-local-data");
  }

  if (isTransientDebugPath(relativePath)) {
    return category("transient-debug");
  }

  if (productStateFiles.has(relativePath)) {
    return category("product-state");
  }

  if (relativePath.startsWith("display-gap-inventory/display-gap-baseline-")) {
    return category("canonical-evidence");
  }

  if (relativePath === "display-original-evidence/original-evidence-store.json") {
    return category("canonical-evidence");
  }

  if (topLevel === "data-inventory") {
    return category("data-inventory-report");
  }

  if (topLevel === "x-audit-browser-profile") {
    return category("browser-profile");
  }

  if (evidenceReportRoots.has(topLevel)) {
    return category("evidence-report");
  }

  return category("unknown-local-data");
}

function category(categoryId) {
  return {
    category: categoryId,
    ...dataCategoryDefinitions[categoryId],
  };
}

function isTransientDebugPath(relativePath) {
  const basename = relativePath.split("/").at(-1) ?? "";
  return (
    relativePath === "server.pid" ||
    relativePath.endsWith(".bak") ||
    /(^|\/)(debug|single-tab-debug|chrome-shot-test|chrome-original-test)/i.test(relativePath) ||
    /^ui-smoke/.test(basename) ||
    /^x-original-\d+\.png$/.test(basename) ||
    /^x-open-test\.png$/.test(basename) ||
    /^signal-layout-check\.png$/.test(basename) ||
    /^x-render-audit-fresh\.json$/.test(basename) ||
    /^x-original-audit\.json$/.test(basename) ||
    /^debug-run_.*\.png$/.test(basename)
  );
}

export function bytesToHuman(bytes) {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = Number(bytes) || 0;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  if (unitIndex === 0) {
    return `${value} ${units[unitIndex]}`;
  }

  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

export function normalizeRunsDocument(document) {
  if (Array.isArray(document)) {
    return document;
  }

  if (Array.isArray(document?.runs)) {
    return document.runs;
  }

  return [];
}

export function summarizeRunsStore(document) {
  const runs = normalizeRunsDocument(document);
  const sourceCounts = {};
  let withTrace = 0;
  let usageLines = 0;
  let traceInputPosts = 0;
  let selectedPosts = 0;
  let minSelectedPosts = runs.length ? Infinity : 0;
  let maxSelectedPosts = 0;

  for (const run of runs) {
    const source = run?.source ?? "unknown";
    sourceCounts[source] = (sourceCounts[source] ?? 0) + 1;

    if (run?.trace) {
      withTrace += 1;
      traceInputPosts += Array.isArray(run.trace.inputPosts) ? run.trace.inputPosts.length : 0;
    }

    usageLines += Array.isArray(run?.usage) ? run.usage.length : 0;

    const selectedCount = Array.isArray(run?.selectedPosts) ? run.selectedPosts.length : 0;
    selectedPosts += selectedCount;
    minSelectedPosts = Math.min(minSelectedPosts, selectedCount);
    maxSelectedPosts = Math.max(maxSelectedPosts, selectedCount);
  }

  const byCreatedAtDesc = [...runs].sort((left, right) => Date.parse(right?.createdAt ?? 0) - Date.parse(left?.createdAt ?? 0));
  const latestLiveRun = byCreatedAtDesc.find((run) => run?.source === "x");

  return {
    totalRuns: runs.length,
    sourceCounts,
    liveRuns: sourceCounts.x ?? 0,
    replayRuns: sourceCounts.replay ?? 0,
    withTrace,
    usageLines,
    traceInputPosts,
    selectedPosts,
    minSelectedPosts: Number.isFinite(minSelectedPosts) ? minSelectedPosts : 0,
    maxSelectedPosts,
    averageSelectedPosts: runs.length ? Number((selectedPosts / runs.length).toFixed(2)) : 0,
    newestRun: summarizeRunRef(byCreatedAtDesc[0]),
    latestLiveRun: summarizeRunRef(latestLiveRun),
    oldestRun: summarizeRunRef(byCreatedAtDesc.at(-1)),
  };
}

function summarizeRunRef(run) {
  if (!run) {
    return null;
  }

  return {
    id: run.id ?? null,
    source: run.source ?? null,
    createdAt: run.createdAt ?? null,
    selectedPosts: Array.isArray(run.selectedPosts) ? run.selectedPosts.length : 0,
    traceInputPosts: Array.isArray(run.trace?.inputPosts) ? run.trace.inputPosts.length : 0,
  };
}

export function normalizeOriginalEvidenceDocument(document) {
  if (Array.isArray(document)) {
    return document;
  }

  if (Array.isArray(document?.entries)) {
    return document.entries;
  }

  if (Array.isArray(document?.originalEntries)) {
    return document.originalEntries;
  }

  return [];
}

export function summarizeOriginalEvidenceStore(document) {
  const entries = normalizeOriginalEvidenceDocument(document);
  const postIds = new Set();
  let withScreenshot = 0;
  let withFacts = 0;
  let withContentfulProbe = 0;
  let withTargetArticle = 0;

  for (const entry of entries) {
    const id = entry?.id ?? entry?.postId ?? entry?.sample?.postId;
    if (id) {
      postIds.add(String(id));
    }

    if (entry?.screenshot) {
      withScreenshot += 1;
    }

    if (entry?.facts) {
      withFacts += 1;
    }

    if (entry?.probe?.blank === false) {
      withContentfulProbe += 1;
    }

    if (entry?.facts?.foundExactArticle === true) {
      withTargetArticle += 1;
    }
  }

  const importedAtValues = entries
    .map((entry) => entry?.importedAt)
    .filter(Boolean)
    .sort();

  return {
    entries: entries.length,
    uniquePostIds: postIds.size,
    withScreenshot,
    withFacts,
    withContentfulProbe,
    withTargetArticle,
    earliestImportedAt: importedAtValues[0] ?? null,
    latestImportedAt: importedAtValues.at(-1) ?? null,
  };
}

export function readJsonIfExists(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function scanDataRoot(rootPath = ".data") {
  if (!existsSync(rootPath)) {
    return {
      rootPath,
      exists: false,
      totalBytes: 0,
      totalFiles: 0,
      totalDirectories: 0,
      entries: [],
      categories: {},
    };
  }

  const names = readdirSync(rootPath).sort((left, right) => left.localeCompare(right));
  const entries = names.map((name) => {
    const fullPath = join(rootPath, name);
    const stats = summarizePath(fullPath);
    const classification = classifyDataPath(name);
    return {
      path: join(rootPath, name),
      relativePath: name,
      kind: stats.kind,
      bytes: stats.bytes,
      humanBytes: bytesToHuman(stats.bytes),
      files: stats.files,
      directories: stats.directories,
      modifiedAt: stats.modifiedAt,
      category: classification.category,
      label: classification.label,
      retention: classification.retention,
      deletePolicy: classification.deletePolicy,
    };
  });

  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  const totalFiles = entries.reduce((sum, entry) => sum + entry.files, 0);
  const totalDirectories = entries.reduce((sum, entry) => sum + entry.directories, 0);
  const categories = {};

  for (const entry of entries) {
    if (!categories[entry.category]) {
      categories[entry.category] = {
        category: entry.category,
        label: entry.label,
        retention: entry.retention,
        deletePolicy: entry.deletePolicy,
        entries: 0,
        bytes: 0,
        files: 0,
        directories: 0,
      };
    }

    categories[entry.category].entries += 1;
    categories[entry.category].bytes += entry.bytes;
    categories[entry.category].files += entry.files;
    categories[entry.category].directories += entry.directories;
  }

  for (const summary of Object.values(categories)) {
    summary.humanBytes = bytesToHuman(summary.bytes);
  }

  return {
    rootPath,
    exists: true,
    totalBytes,
    humanTotalBytes: bytesToHuman(totalBytes),
    totalFiles,
    totalDirectories,
    entries,
    categories,
  };
}

function summarizePath(pathname) {
  const stats = statSync(pathname);
  if (!stats.isDirectory()) {
    return {
      kind: "file",
      bytes: stats.size,
      files: 1,
      directories: 0,
      modifiedAt: stats.mtime.toISOString(),
    };
  }

  let bytes = stats.size;
  let files = 0;
  let directories = 1;
  let modifiedAt = stats.mtime.toISOString();

  for (const name of readdirSync(pathname)) {
    const child = summarizePath(join(pathname, name));
    bytes += child.bytes;
    files += child.files;
    directories += child.directories;
    if (Date.parse(child.modifiedAt) > Date.parse(modifiedAt)) {
      modifiedAt = child.modifiedAt;
    }
  }

  return {
    kind: "directory",
    bytes,
    files,
    directories,
    modifiedAt,
  };
}

export function summarizeCanonicalBaselines(rootPath = ".data") {
  const baselinesRoot = join(rootPath, "display-gap-inventory");
  if (!existsSync(baselinesRoot)) {
    return [];
  }

  return readdirSync(baselinesRoot)
    .filter((name) => name.startsWith("display-gap-baseline-"))
    .sort((left, right) => right.localeCompare(left))
    .map((name) => {
      const reportPath = join(baselinesRoot, name, "report.json");
      const report = readJsonIfExists(reportPath);
      return {
        name,
        reportPath,
        exists: existsSync(reportPath),
        sampleCount: Array.isArray(report?.samples) ? report.samples.length : report?.sampleCount ?? null,
        createdAt: report?.createdAt ?? null,
      };
    });
}

export function buildDataInventory(rootPath = ".data") {
  const scan = scanDataRoot(rootPath);
  const runsSummary = summarizeRunsStore(readJsonIfExists(join(rootPath, "runs.json")));
  const originalEvidenceSummary = summarizeOriginalEvidenceStore(
    readJsonIfExists(join(rootPath, "display-original-evidence", "original-evidence-store.json")),
  );

  return {
    createdAt: new Date().toISOString(),
    rootPath,
    scan,
    runs: runsSummary,
    originalEvidence: originalEvidenceSummary,
    canonicalBaselines: summarizeCanonicalBaselines(rootPath),
  };
}

export function markdownInventoryReport(report) {
  const lines = [
    "# Local Data Inventory",
    "",
    `Created: ${report.createdAt}`,
    `Root: \`${report.rootPath}\``,
    "",
    "## Summary",
    "",
    `- Total size: ${report.scan.humanTotalBytes ?? "0 B"}`,
    `- Files: ${report.scan.totalFiles}`,
    `- Directories: ${report.scan.totalDirectories}`,
    `- Runs: ${report.runs.totalRuns} total, ${report.runs.liveRuns} live, ${report.runs.replayRuns} replay`,
    `- Original evidence entries: ${report.originalEvidence.entries}`,
    "",
    "## Categories",
    "",
    "| Category | Entries | Size | Files | Retention | Delete policy |",
    "| --- | ---: | ---: | ---: | --- | --- |",
  ];

  for (const summary of Object.values(report.scan.categories).sort((left, right) => left.label.localeCompare(right.label))) {
    lines.push(
      `| ${summary.label} | ${summary.entries} | ${summary.humanBytes} | ${summary.files} | ${summary.retention} | ${summary.deletePolicy} |`,
    );
  }

  lines.push("", "## Top-Level Entries", "", "| Path | Kind | Category | Size | Files | Modified |", "| --- | --- | --- | ---: | ---: | --- |");

  for (const entry of report.scan.entries.sort((left, right) => right.bytes - left.bytes)) {
    lines.push(`| \`${entry.path}\` | ${entry.kind} | ${entry.label} | ${entry.humanBytes} | ${entry.files} | ${entry.modifiedAt} |`);
  }

  lines.push("", "## Runs Store", "");
  lines.push(`- Newest run: ${runRef(report.runs.newestRun)}`);
  lines.push(`- Latest live run: ${runRef(report.runs.latestLiveRun)}`);
  lines.push(`- Oldest run: ${runRef(report.runs.oldestRun)}`);
  lines.push(`- Runs with trace: ${report.runs.withTrace}`);
  lines.push(`- Trace input posts: ${report.runs.traceInputPosts}`);
  lines.push(`- Selected posts recorded: ${report.runs.selectedPosts}`);
  lines.push(`- Usage lines recorded: ${report.runs.usageLines}`);

  lines.push("", "## Original Evidence", "");
  lines.push(`- Entries: ${report.originalEvidence.entries}`);
  lines.push(`- Unique post ids: ${report.originalEvidence.uniquePostIds}`);
  lines.push(`- With screenshots: ${report.originalEvidence.withScreenshot}`);
  lines.push(`- With facts: ${report.originalEvidence.withFacts}`);
  lines.push(`- With contentful screenshot probe: ${report.originalEvidence.withContentfulProbe}`);
  lines.push(`- With exact article facts: ${report.originalEvidence.withTargetArticle}`);

  lines.push("", "## Canonical Baselines", "");
  if (report.canonicalBaselines.length) {
    for (const baseline of report.canonicalBaselines) {
      lines.push(`- \`${baseline.name}\`: ${baseline.sampleCount ?? "unknown"} samples, report ${baseline.exists ? "present" : "missing"}`);
    }
  } else {
    lines.push("- None detected.");
  }

  lines.push("", "## Notes", "");
  lines.push("- This inventory is read-only. It does not delete, archive, or rewrite `.data`.");
  lines.push("- `.data` may contain private X timeline data, OAuth state, OpenAI cache entries, screenshots, and browser state.");
  lines.push("- Treat `product-state` and `canonical-evidence` as owner-controlled assets. Prune only after a separate explicit decision.");

  return `${lines.join("\n")}\n`;
}

function runRef(run) {
  if (!run) {
    return "none";
  }

  return `${run.id ?? "unknown"} (${run.source ?? "unknown"}, ${run.createdAt ?? "unknown"})`;
}
