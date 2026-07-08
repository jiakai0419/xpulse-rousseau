import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RefreshRun, TimelinePost } from "../src/domain/tweet.ts";
import { FileLinkPreviewCacheRepository } from "../src/services/linkPreview/cache.ts";
import { enrichSelectedPostLinkPreviews } from "../src/services/linkPreview/enrich.ts";
import { loadDotEnv } from "../src/server/env.ts";
import { getHost } from "./env-utils.mjs";
import {
  auditRunFromSamples,
  buildDisplayGapInventoryReport,
  markdownDisplayGapInventoryReport,
  selectDisplayInventorySamples,
} from "./display-gap-inventory-core.mjs";
import {
  inventorySampleForJson,
} from "./display-inventory-samples.mjs";
import {
  enrichDisplayInventorySamples,
  readOriginalEvidenceEntries,
} from "./display-inventory-enrichment.mjs";
import {
  collectLocalReaderEvidence,
  localReaderEvidenceSummary,
} from "./display-local-reader-evidence.mjs";
import { captureFreshDisplayInventoryRun } from "./display-inventory-fresh-capture.mjs";

loadDotEnv();

const sourceStorePath = process.env.DISPLAY_INVENTORY_RUN_STORE || ".data/runs.json";
const includeFresh = process.env.DISPLAY_INVENTORY_FRESH === "1";
const freshTarget = positiveInt(process.env.DISPLAY_INVENTORY_FRESH_TARGET, 100);
const freshMaxPages = positiveInt(process.env.DISPLAY_INVENTORY_FRESH_MAX_PAGES, 5);
const maxHistoryRuns = positiveInt(process.env.DISPLAY_INVENTORY_HISTORY_RUNS, 20);
const historySampleLimit = positiveInt(process.env.DISPLAY_INVENTORY_HISTORY_LIMIT, 120);
const maxSamples = positiveInt(process.env.DISPLAY_INVENTORY_MAX_SAMPLES, includeFresh ? freshTarget + historySampleLimit : historySampleLimit);
const renderLocal = process.env.DISPLAY_INVENTORY_LOCAL_SCREENSHOTS !== "0";
const enrichLinkPreviews = process.env.DISPLAY_INVENTORY_LINK_PREVIEWS !== "0";
const linkPreviewCachePath = process.env.DISPLAY_INVENTORY_LINK_PREVIEW_CACHE || ".data/link-preview-cache.json";
const enrichXArticlePreviews = process.env.DISPLAY_INVENTORY_X_ARTICLE_PREVIEWS !== "0";
const originalEvidenceStorePath = process.env.DISPLAY_INVENTORY_ORIGINAL_EVIDENCE_STORE || ".data/display-original-evidence/original-evidence-store.json";
const localBrowserChannel = process.env.DISPLAY_INVENTORY_BROWSER_CHANNEL || "chrome";
const host = getHost();
const port = positiveInt(process.env.DISPLAY_INVENTORY_PORT, 3700);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = process.env.DISPLAY_INVENTORY_DIR || `.data/display-gap-inventory/display-gap-${timestamp}`;
const localRunStorePath = join(outputDir, "inventory-runs.json");
const viewport = { width: 1280, height: 900 };

type InventorySample = {
  index: number;
  pool: "fresh" | "history-selected" | "history-trace";
  runId: string;
  runCreatedAt: string;
  fetchIndex?: number;
  selectedIndex?: number;
  timelinePost: TimelinePost;
  displayPost: TimelinePost;
  flags: Record<string, unknown>;
  buckets: string[];
  risks: string[];
  missingData: string[];
  localScreenshot?: string;
  localScreenshotProbe?: unknown;
  localFacts?: unknown;
  xArticlePreviewEvidenceApplied?: number;
};

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readRunStore(filePath: string): { runs: RefreshRun[] } {
  try {
    return JSON.parse(readFileSync(filePath, "utf8")) as { runs: RefreshRun[] };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { runs: [] };
    }

    throw error;
  }
}

async function enrichInventorySamples(samples: InventorySample[]): Promise<void> {
  const originalEvidenceEntries = enrichLinkPreviews && samples.length
    ? readOriginalEvidenceEntries(originalEvidenceStorePath, {
        enabled: enrichXArticlePreviews,
      })
    : [];

  await enrichDisplayInventorySamples(samples, {
    enrichLinkPreviews,
    enrichXArticlePreviews,
    originalEvidenceEntries,
    enrichSelectedPostLinkPreviews,
    linkPreviewCache: new FileLinkPreviewCacheRepository(linkPreviewCachePath),
  });
}

async function main() {
  mkdirSync(outputDir, { recursive: true });
  const store = readRunStore(sourceStorePath);
  const historicalRuns = (store.runs ?? [])
    .filter((run) => run.source === "x" && run.trace?.inputPosts?.length)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, maxHistoryRuns);
  const fresh = await captureFreshDisplayInventoryRun({
    includeFresh,
    env: process.env,
    freshTarget,
    freshMaxPages,
  }) as { run?: RefreshRun; rawSnapshots: unknown[]; usage: unknown[] };
  const runs = fresh.run ? [fresh.run, ...historicalRuns] : historicalRuns;

  if (!runs.length) {
    throw new Error(`Display inventory needs saved live X runs in ${sourceStorePath}, or set DISPLAY_INVENTORY_FRESH=1.`);
  }

  if (fresh.run) {
    writeFileSync(join(outputDir, "fresh-run.json"), JSON.stringify(fresh.run, null, 2), "utf8");
    writeFileSync(join(outputDir, "fresh-raw-snapshots.json"), JSON.stringify({ snapshots: fresh.rawSnapshots }, null, 2), "utf8");
    writeFileSync(join(outputDir, "fresh-usage.json"), JSON.stringify({ usage: fresh.usage }, null, 2), "utf8");
  }

  const samples = selectDisplayInventorySamples({
    freshRun: fresh.run,
    historicalRuns,
    maxSamples,
    historySampleLimit,
  }) as InventorySample[];

  await enrichInventorySamples(samples);
  await collectLocalReaderEvidence(samples, {
    enabled: renderLocal,
    outputDir,
    runStorePath: localRunStorePath,
    replayRun: auditRunFromSamples(samples, runs) as RefreshRun,
    host,
    port,
    browserChannel: localBrowserChannel,
    browserChannelExplicit: Boolean(process.env.DISPLAY_INVENTORY_BROWSER_CHANNEL),
    viewport,
  });

  const reportSamples = samples.map(inventorySampleForJson);
  const report = buildDisplayGapInventoryReport({
    createdAt: new Date().toISOString(),
    sourceStorePath,
    outputDir,
    includeFresh,
    freshRun: fresh.run,
    historicalRuns,
    runs,
    reportSamples,
    screenshotSummary: localReaderEvidenceSummary(samples),
  });

  writeFileSync(join(outputDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  writeFileSync(join(outputDir, "report.md"), markdownDisplayGapInventoryReport(report), "utf8");

  console.log(`OK x-display:collect-local-renderings: sampled ${report.sampleCount} real X-derived posts.`);
  console.log(`Report: ${join(outputDir, "report.md")}`);
  if (Object.keys(report.riskCounts).length) {
    console.log(`Top risks: ${Object.entries(report.riskCounts).slice(0, 6).map(([risk, count]) => `${risk}:${count}`).join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
