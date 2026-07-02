import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RefreshRun, TimelinePost, UsageRecord } from "../src/domain/tweet.ts";
import { FileLinkPreviewCacheRepository } from "../src/services/linkPreview/cache.ts";
import { enrichSelectedPostLinkPreviews } from "../src/services/linkPreview/enrich.ts";
import { loadDotEnv } from "../src/server/env.ts";
import { fetchHomeTimeline } from "../src/services/x/client.ts";
import { buildXOAuthConfig, getFreshStoredXTokens } from "../src/services/x/oauth.ts";
import { FileXTokenStore } from "../src/services/x/tokenStore.ts";
import type { XRawTimelineSnapshot } from "../src/services/x/rawSnapshotStore.ts";
import { getHost } from "./env-utils.mjs";
import {
  buildSamplePool,
  buildSelectedSamplePool,
  readerDisplayPost,
} from "./render-buckets.mjs";
import {
  enrichPostXArticlePreviewsFromEvidence,
  inventorySampleForJson,
  inventorySampleFromRawSample,
  refreshInventorySampleDerivedFields,
} from "./display-inventory-samples.mjs";
import {
  collectLocalReaderEvidence,
  localReaderEvidenceSummary,
} from "./display-local-reader-evidence.mjs";

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

function scoreByPostIdFromRuns(runs: RefreshRun[]): Map<string, unknown> {
  const scores = new Map<string, unknown>();

  for (const run of runs) {
    for (const selected of run.selectedPosts ?? []) {
      scores.set(selected.post.id, selected.score);
      scores.set(readerDisplayPost(selected.post).id, selected.score);
    }

    for (const decision of run.trace?.decisions ?? []) {
      if (decision.score?.weightedScore) {
        scores.set(decision.postId, decision.score.weightedScore);
      }
    }
  }

  return scores;
}

function translationByPostIdFromRuns(runs: RefreshRun[]): Map<string, unknown> {
  const translations = new Map<string, unknown>();

  for (const run of runs) {
    for (const selected of run.selectedPosts ?? []) {
      if (!selected.translation) {
        continue;
      }

      translations.set(selected.post.id, selected.translation);
      translations.set(readerDisplayPost(selected.post).id, selected.translation);
    }
  }

  return translations;
}

function addInventorySample(samples: InventorySample[], seen: Set<string>, rawSample: any, pool: InventorySample["pool"]): boolean {
  const displayPost = rawSample.displayPost as TimelinePost;
  if (seen.has(displayPost.id) || samples.length >= maxSamples) {
    return false;
  }

  seen.add(displayPost.id);
  samples.push(inventorySampleFromRawSample(rawSample, pool, samples.length + 1) as InventorySample);
  return true;
}

function readOriginalEvidenceEntries(): any[] {
  if (!enrichXArticlePreviews || !existsSync(originalEvidenceStorePath)) {
    return [];
  }

  const raw = JSON.parse(readFileSync(originalEvidenceStorePath, "utf8"));
  if (Array.isArray(raw)) {
    return raw;
  }

  return Array.isArray(raw.entries) ? raw.entries : [];
}

function originalEvidenceByPostId(): Map<string, any> {
  const byId = new Map<string, any>();
  for (const entry of readOriginalEvidenceEntries()) {
    const id = String(entry?.id ?? entry?.postId ?? "");
    if (id) {
      byId.set(id, entry);
    }
  }

  return byId;
}

async function enrichInventorySamples(samples: InventorySample[]): Promise<void> {
  if (!enrichLinkPreviews || !samples.length) {
    return;
  }

  await enrichSelectedPostLinkPreviews(samples.map((sample) => sample.timelinePost), {
    cache: new FileLinkPreviewCacheRepository(linkPreviewCachePath),
  });

  const originalEvidence = originalEvidenceByPostId();
  for (const sample of samples) {
    const entry = originalEvidence.get(sample.displayPost.id);
    sample.xArticlePreviewEvidenceApplied = entry ? enrichPostXArticlePreviewsFromEvidence(sample.timelinePost, entry) : 0;
  }

  for (const sample of samples) {
    refreshInventorySampleDerivedFields(sample);
  }
}

function inventoryRunFromPosts(posts: TimelinePost[], createdAt: string): RefreshRun {
  return {
    id: `inventory_fresh_${Date.parse(createdAt)}`,
    createdAt,
    source: "x",
    stats: {
      fetched: posts.length,
      adsExcluded: 0,
      duplicatesExcluded: 0,
      seenExcluded: 0,
      scored: 0,
      selected: 0,
    },
    selectedPosts: [],
    usage: [],
    trace: {
      version: "run-trace-v1",
      runId: `inventory_fresh_${Date.parse(createdAt)}`,
      createdAt,
      source: "x",
      pipelineVersion: "reader-refresh-v1",
      config: {
        selectedPostCount: 0,
        scoringWeights: [],
        configuredModels: {
          scoring: "inventory-no-openai",
          translation: "inventory-no-openai",
        },
        batches: {
          scoring: 0,
          translation: 0,
        },
        promptVersions: {
          scoring: "scoring-v2",
          translation: "translation-v2",
        },
      },
      inputPosts: posts.map((post, fetchIndex) => ({ post, fetchIndex })),
      decisions: [],
    },
  };
}

async function fetchFreshRun(): Promise<{ run?: RefreshRun; rawSnapshots: XRawTimelineSnapshot[]; usage: UsageRecord[] }> {
  if (!includeFresh) {
    return { rawSnapshots: [], usage: [] };
  }

  const rawSnapshots: XRawTimelineSnapshot[] = [];
  const usage: UsageRecord[] = [];
  const env = process.env;
  let userId = env.X_USER_ID;
  let accessToken = env.X_USER_ACCESS_TOKEN;

  if (!userId || !accessToken) {
    const tokens = await getFreshStoredXTokens(new FileXTokenStore(), buildXOAuthConfig(env));
    userId = tokens?.user?.id;
    accessToken = tokens?.accessToken;
  }

  if (!userId || !accessToken) {
    throw new Error("Display inventory fresh capture needs connected X OAuth tokens or X_USER_ID/X_USER_ACCESS_TOKEN.");
  }

  const posts = await fetchHomeTimeline({
    userId,
    accessToken,
    maxResults: 100,
    targetResults: freshTarget,
    maxPages: freshMaxPages,
    onRawSnapshot: (snapshot) => {
      rawSnapshots.push(snapshot);
    },
    onUsage: (record) => {
      usage.push(record);
    },
  });
  const createdAt = new Date().toISOString();
  const run = inventoryRunFromPosts(posts, createdAt);
  run.usage = usage;
  return { run, rawSnapshots, usage };
}

function fallbackScore() {
  return {
    total: 0,
    dimensions: [],
  };
}

function auditRunFromSamples(samples: InventorySample[], runs: RefreshRun[]): RefreshRun {
  const scores = scoreByPostIdFromRuns(runs);
  const translations = translationByPostIdFromRuns(runs);
  const now = new Date().toISOString();

  return {
    id: `display_inventory_${Date.now()}`,
    createdAt: now,
    source: "x",
    stats: {
      fetched: samples.length,
      adsExcluded: 0,
      duplicatesExcluded: 0,
      seenExcluded: 0,
      scored: samples.length,
      selected: samples.length,
    },
    selectedPosts: samples.map((sample) => {
      const timelineId = sample.timelinePost.id;
      const displayId = sample.displayPost.id;
      const translation = translations.get(timelineId) ?? translations.get(displayId);
      return {
        post: sample.timelinePost,
        score: scores.get(timelineId) ?? scores.get(displayId) ?? fallbackScore(),
        ...(translation ? { translation } : {}),
      };
    }),
    usage: [],
  };
}

function countBy<T extends string>(items: T[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item] = (counts[item] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function markdownReport(report: any): string {
  const lines = [
    "# Display Gap Inventory",
    "",
    `Created: ${report.createdAt}`,
    `Output: \`${report.outputDir}\``,
    `Historical runs scanned: ${report.historyRunCount}`,
    `Fresh capture: ${report.freshRunId ? `${report.freshRunId} (${report.freshPostCount} posts)` : "not requested"}`,
    `Samples inventoried: ${report.samples.length}`,
    "",
    "## Screenshot Reliability",
    "",
    `Local screenshots attempted: ${report.screenshotSummary.localAttempted}`,
    `Local blank/near-uniform screenshots: ${report.screenshotSummary.localBlank}`,
    "",
    "Original X screenshots are intentionally not treated as solved by this inventory command. For this round, the report keeps exact Original URLs and local screenshots, then the high-risk rows should be opened in the user's already-authenticated Chrome window for visual comparison. Screenshot failures must be recorded as tooling gaps, not ignored.",
    "",
    "## Risk Counts",
    "",
    "| Risk | Count |",
    "| --- | ---: |",
  ];

  for (const [risk, count] of Object.entries(report.riskCounts)) {
    lines.push(`| ${risk} | ${count} |`);
  }

  lines.push("", "## Bucket Counts", "", "| Bucket | Count |", "| --- | ---: |");
  for (const [bucket, count] of Object.entries(report.bucketCounts)) {
    lines.push(`| ${bucket} | ${count} |`);
  }

  lines.push("", "## Missing Data Counts", "", "| Missing Data | Count |", "| --- | ---: |");
  for (const [missing, count] of Object.entries(report.missingDataCounts)) {
    lines.push(`| ${missing} | ${count} |`);
  }

  lines.push("", "## High-Risk Samples", "", "| # | Pool | Author | Buckets | Risks | Missing Data | Local | Original | Text |", "| ---: | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const sample of report.samples.filter((item: any) => item.risks.length || item.missingData.length).slice(0, 40)) {
    lines.push(
      `| ${sample.index} | ${sample.pool} | @${sample.author.username} | ${sample.buckets.join(", ") || "-"} | ${sample.risks.join(", ") || "-"} | ${sample.missingData.join(", ") || "-"} | ${sample.localScreenshot ? `[local](${sample.localScreenshot})` : "-"} | [X](${sample.url}) | ${sample.textStart.replaceAll("|", "\\|")} |`,
    );
  }

  lines.push("", "## Notes", "");
  lines.push("- This inventory uses real X-derived data only: saved live runs plus optional fresh X API capture.");
  lines.push("- Fresh capture does not call OpenAI, does not update Seen Ledger, and does not update the product timeline cursor.");
  lines.push("- X Article links (`x.com/i/article/...`) are tracked explicitly because they can render as rich X Article cards on Original pages while X API tweet entities may only provide a URL.");
  lines.push("- Use this report to decide whether to add API enrichment, rendering rules, or targeted regression specimens before the next refactor block.");

  return `${lines.join("\n")}\n`;
}

async function main() {
  mkdirSync(outputDir, { recursive: true });
  const store = readRunStore(sourceStorePath);
  const historicalRuns = (store.runs ?? [])
    .filter((run) => run.source === "x" && run.trace?.inputPosts?.length)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, maxHistoryRuns);
  const fresh = await fetchFreshRun();
  const runs = fresh.run ? [fresh.run, ...historicalRuns] : historicalRuns;

  if (!runs.length) {
    throw new Error(`Display inventory needs saved live X runs in ${sourceStorePath}, or set DISPLAY_INVENTORY_FRESH=1.`);
  }

  if (fresh.run) {
    writeFileSync(join(outputDir, "fresh-run.json"), JSON.stringify(fresh.run, null, 2), "utf8");
    writeFileSync(join(outputDir, "fresh-raw-snapshots.json"), JSON.stringify({ snapshots: fresh.rawSnapshots }, null, 2), "utf8");
    writeFileSync(join(outputDir, "fresh-usage.json"), JSON.stringify({ usage: fresh.usage }, null, 2), "utf8");
  }

  const samples: InventorySample[] = [];
  const seen = new Set<string>();

  if (fresh.run) {
    for (const sample of buildSamplePool([fresh.run])) {
      addInventorySample(samples, seen, sample, "fresh");
    }
  }

  for (const sample of buildSelectedSamplePool(historicalRuns)) {
    if (samples.length >= maxSamples || samples.filter((item) => item.pool === "history-selected").length >= historySampleLimit) {
      break;
    }

    addInventorySample(samples, seen, sample, "history-selected");
  }

  for (const sample of buildSamplePool(historicalRuns)) {
    if (samples.length >= maxSamples) {
      break;
    }

    addInventorySample(samples, seen, sample, "history-trace");
  }

  await enrichInventorySamples(samples);
  await collectLocalReaderEvidence(samples, {
    enabled: renderLocal,
    outputDir,
    runStorePath: localRunStorePath,
    replayRun: auditRunFromSamples(samples, runs),
    host,
    port,
    browserChannel: localBrowserChannel,
    browserChannelExplicit: Boolean(process.env.DISPLAY_INVENTORY_BROWSER_CHANNEL),
    viewport,
  });

  const reportSamples = samples.map(inventorySampleForJson);
  const report = {
    createdAt: new Date().toISOString(),
    sourceStorePath,
    outputDir,
    includeFresh,
    freshRunId: fresh.run?.id,
    freshPostCount: fresh.run?.trace?.inputPosts?.length ?? 0,
    historyRunCount: historicalRuns.length,
    sampledRunIds: runs.map((run) => run.id),
    sampleCount: reportSamples.length,
    bucketCounts: countBy(reportSamples.flatMap((sample) => sample.buckets)),
    riskCounts: countBy(reportSamples.flatMap((sample) => sample.risks)),
    missingDataCounts: countBy(reportSamples.flatMap((sample) => sample.missingData)),
    screenshotSummary: localReaderEvidenceSummary(samples),
    samples: reportSamples,
  };

  writeFileSync(join(outputDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  writeFileSync(join(outputDir, "report.md"), markdownReport(report), "utf8");

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
