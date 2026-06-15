import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import type { PostLink, RefreshRun, TimelinePost, UsageRecord } from "../src/domain/tweet.ts";
import { FileLinkPreviewCacheRepository } from "../src/services/linkPreview/cache.ts";
import { enrichSelectedPostLinkPreviews } from "../src/services/linkPreview/enrich.ts";
import { loadDotEnv } from "../src/server/env.ts";
import { fetchHomeTimeline } from "../src/services/x/client.ts";
import { buildXOAuthConfig, getFreshStoredXTokens } from "../src/services/x/oauth.ts";
import { FileXTokenStore } from "../src/services/x/tokenStore.ts";
import type { XRawTimelineSnapshot } from "../src/services/x/rawSnapshotStore.ts";
import { getHost, spawnServer, waitForHealth } from "./env-utils.mjs";
import {
  buildSamplePool,
  buildSelectedSamplePool,
  bucketsFromFlags,
  displayFlags,
  hasPreview,
  isExternalLink,
  isXArticleLink,
  isXStatusLink,
  readerDisplayPost,
} from "./render-buckets.mjs";
import { inspectPngScreenshot } from "./screenshot-probe.mjs";

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
  localScreenshotProbe?: ReturnType<typeof inspectPngScreenshot>;
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

function compactText(value: string | undefined, maxLength = 120): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function compactEvidenceLine(value: string | undefined, maxLength = 220): string | undefined {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : undefined;
}

function linkHref(link: PostLink): string {
  return link.unwoundUrl ?? link.expandedUrl ?? link.url ?? "";
}

function linkDomain(link: PostLink): string {
  try {
    return new URL(linkHref(link)).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function postLinks(post: TimelinePost | undefined): PostLink[] {
  return post?.links ?? [];
}

function hasXArticleText(post: TimelinePost | undefined): boolean {
  return /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/i\/article\//i.test(post?.text ?? "");
}

function xArticleLinks(post: TimelinePost | undefined): PostLink[] {
  return postLinks(post).filter(isXArticleLink);
}

function linksWithMissingPreview(post: TimelinePost | undefined): PostLink[] {
  return postLinks(post).filter((link) => isExternalLink(link) && !hasPreview(link));
}

function linksWithTextOnlyPreview(post: TimelinePost | undefined): PostLink[] {
  return postLinks(post).filter((link) => {
    if (!isExternalLink(link) || !hasPreview(link)) {
      return false;
    }

    return !(link.preview?.images ?? []).some((image) => image.url);
  });
}

function postHasPlayableVideo(post: TimelinePost | undefined): boolean {
  return Boolean(
    post?.media?.some(
      (media) =>
        (media.type === "video" || media.type === "animated_gif") &&
        (media.variants ?? []).some((variant) => variant.url && (!variant.contentType || variant.contentType.includes("mp4"))),
    ),
  );
}

function detectMissingData(timelinePost: TimelinePost, displayPost: TimelinePost): string[] {
  const missing = new Set<string>();
  const quote = displayPost.referencedPostType === "quoted" ? displayPost.referencedPost : undefined;

  if (displayPost.referencedPostType === "quoted" && !displayPost.referencedPost) {
    missing.add("quoted_post_body");
  }

  for (const media of [...(displayPost.media ?? []), ...(quote?.media ?? [])]) {
    if (!media.width || !media.height) {
      missing.add("media_dimensions");
    }

    if (media.type === "photo" && !media.url) {
      missing.add("photo_url");
    }

    if ((media.type === "video" || media.type === "animated_gif") && !(media.variants ?? []).some((variant) => variant.url)) {
      missing.add("video_variants");
    }
  }

  if (xArticleLinks(displayPost).length && !postLinks(displayPost).some((link) => isXArticleLink(link) && hasPreview(link))) {
    missing.add("x_article_preview_metadata");
  }

  if ((xArticleLinks(quote).length || hasXArticleText(quote)) && !postLinks(quote).some((link) => isXArticleLink(link) && hasPreview(link))) {
    missing.add("quoted_x_article_preview_metadata");
  }

  if (timelinePost.referencedPostType === "retweeted" && !timelinePost.referencedPost) {
    missing.add("retweeted_source_body");
  }

  return [...missing].sort();
}

function detectRisks(timelinePost: TimelinePost, displayPost: TimelinePost): string[] {
  const risks = new Set<string>();
  const quote = displayPost.referencedPostType === "quoted" ? displayPost.referencedPost : undefined;

  if (timelinePost.referencedPostType === "retweeted" && displayPost.referencedPostType === "quoted") {
    risks.add("repost_of_quote");
  }

  if (displayPost.referencedPostType === "quoted" && !displayPost.referencedPost) {
    risks.add("quote_placeholder");
  }

  if (xArticleLinks(displayPost).length || hasXArticleText(displayPost)) {
    risks.add("main_x_article_link");
  }

  if (xArticleLinks(quote).length || hasXArticleText(quote)) {
    risks.add("quote_x_article_link");
  }

  if ((xArticleLinks(quote).length || hasXArticleText(quote)) && !(quote?.media ?? []).length) {
    risks.add("quote_x_article_card_likely");
  }

  if (linksWithMissingPreview(displayPost).length || linksWithMissingPreview(quote).length) {
    risks.add("external_link_without_preview_metadata");
  }

  if (linksWithTextOnlyPreview(displayPost).length || linksWithTextOnlyPreview(quote).length) {
    risks.add("external_preview_without_image");
  }

  if ((displayPost.media ?? []).length && postLinks(displayPost).some(isExternalLink)) {
    risks.add("media_plus_external_link");
  }

  if (displayPost.referencedPostType === "quoted" && (displayPost.media ?? []).length) {
    risks.add("media_plus_quote");
  }

  if (postLinks(displayPost).some(isXStatusLink) && !displayPost.referencedPost) {
    risks.add("x_status_link_without_quote_body");
  }

  if ((displayPost.media ?? []).some((media) => media.type === "video" || media.type === "animated_gif") && !postHasPlayableVideo(displayPost)) {
    risks.add("video_without_playable_variant");
  }

  if ((quote?.media ?? []).some((media) => media.type === "video" || media.type === "animated_gif") && !postHasPlayableVideo(quote)) {
    risks.add("quote_video_without_playable_variant");
  }

  return [...risks].sort();
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
  const timelinePost = rawSample.timelinePost as TimelinePost;
  samples.push({
    index: samples.length + 1,
    pool,
    runId: rawSample.runId,
    runCreatedAt: rawSample.runCreatedAt,
    fetchIndex: rawSample.fetchIndex,
    selectedIndex: rawSample.selectedIndex,
    timelinePost,
    displayPost,
    flags: rawSample.flags,
    buckets: rawSample.buckets,
    risks: detectRisks(timelinePost, displayPost),
    missingData: detectMissingData(timelinePost, displayPost),
  });
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

function looksLikeUiOrMetricLine(line: string): boolean {
  return (
    /^@\w/.test(line) ||
    /^(\d[\d,.]*|\d+(?:\.\d+)?[KMB])$/.test(line) ||
    /^(\d[\d,.]*|\d+(?:\.\d+)?[KMB])\s+Views$/i.test(line) ||
    /^(Quote|Relevant|View quotes|Subscribe|Following|Reply|Post|Article)$/i.test(line) ||
    /^\d{1,2}:\d{2}\s+[AP]M\s+·/i.test(line)
  );
}

function evidenceLines(entry: any): string[] {
  return String(entry?.facts?.textStart ?? entry?.facts?.text ?? "")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function xArticlePreviewFromEvidence(entry: any): PostLink["preview"] | undefined {
  const lines = evidenceLines(entry);
  const articleIndex = lines.findIndex((line) => /^Article$/i.test(line));

  if (articleIndex >= 0) {
    const title = compactEvidenceLine(lines[articleIndex + 1]);
    const description = lines.slice(articleIndex + 2).map((line) => compactEvidenceLine(line)).find(Boolean);

    return title ? { title, description } : undefined;
  }

  const handleIndex = lines.findIndex((line) => /^@\w/.test(line));
  const contentStart = handleIndex >= 0 ? handleIndex + 1 : 0;
  const titleIndex = lines.findIndex((line, index) => index >= contentStart && !looksLikeUiOrMetricLine(line));
  const title = compactEvidenceLine(titleIndex >= 0 ? lines[titleIndex] : undefined);
  const description = titleIndex >= 0
    ? lines.slice(titleIndex + 1).map((line) => (looksLikeUiOrMetricLine(line) ? undefined : compactEvidenceLine(line))).find(Boolean)
    : undefined;

  return title ? { title, description } : undefined;
}

function enrichPostXArticlePreviewsFromEvidence(post: TimelinePost | undefined, entry: any, seen = new Set<string>()): number {
  if (!post || seen.has(post.id)) {
    return 0;
  }

  seen.add(post.id);
  let enriched = 0;
  const preview = xArticlePreviewFromEvidence(entry);

  if (preview) {
    for (const link of post.links ?? []) {
      if (isXArticleLink(link) && !hasPreview(link)) {
        link.preview = preview;
        enriched += 1;
      }
    }
  }

  return enriched + enrichPostXArticlePreviewsFromEvidence(post.referencedPost as TimelinePost | undefined, entry, seen);
}

function refreshSampleDerivedFields(sample: InventorySample): void {
  sample.displayPost = readerDisplayPost(sample.timelinePost);
  sample.flags = displayFlags(sample.timelinePost);
  sample.buckets = bucketsFromFlags(sample.flags);
  sample.risks = detectRisks(sample.timelinePost, sample.displayPost);
  sample.missingData = detectMissingData(sample.timelinePost, sample.displayPost);
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
    refreshSampleDerivedFields(sample);
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

function rectFromElement(element: Element) {
  const value = element.getBoundingClientRect();
  return {
    x: Math.round(value.x * 10) / 10,
    y: Math.round(value.y * 10) / 10,
    width: Math.round(value.width * 10) / 10,
    height: Math.round(value.height * 10) / 10,
    top: Math.round(value.top * 10) / 10,
    bottom: Math.round(value.bottom * 10) / 10,
  };
}

async function waitForLocalMedia(card: any): Promise<void> {
  await card.evaluate(async (root: Element) => {
    const wait = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const waitForVideoProgress = async (video: HTMLVideoElement, timeoutMs: number) => {
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        if (!video.paused && video.readyState >= 2 && video.currentTime > 0.15) {
          return;
        }

        await wait(150);
      }
    };
    const images = Array.from(root.querySelectorAll("img"));
    await Promise.race([
      Promise.all(
        images.map((image) => {
          if (image.complete && image.naturalWidth > 0) {
            return undefined;
          }

          return new Promise((resolve) => {
            image.addEventListener("load", resolve, { once: true });
            image.addEventListener("error", resolve, { once: true });
          });
        }),
      ),
      wait(5000),
    ]);

    const videos = Array.from(root.querySelectorAll("video"));
    for (const video of videos) {
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      if (video.readyState === 0) {
        video.load();
      }
      try {
        await Promise.race([video.play(), wait(2000)]);
        await waitForVideoProgress(video, 8000);
      } catch {
        // Facts below record whether autoplay actually happened.
      }
    }

    await wait(videos.length ? 500 : 250);
  });
}

async function collectLocalFacts(card: any): Promise<unknown> {
  return card.evaluate((root: Element) => {
    const rect = (element: Element) => {
      const value = element.getBoundingClientRect();
      return {
        x: Math.round(value.x * 10) / 10,
        y: Math.round(value.y * 10) / 10,
        width: Math.round(value.width * 10) / 10,
        height: Math.round(value.height * 10) / 10,
        top: Math.round(value.top * 10) / 10,
        bottom: Math.round(value.bottom * 10) / 10,
      };
    };

    return {
      card: rect(root),
      repostContext: root.querySelector(".repost-context")?.textContent?.trim() ?? "",
      authorLine: root.querySelector(".author-line")?.textContent?.trim() ?? "",
      text: root.querySelector(".tweet-text")?.textContent?.trim() ?? "",
      inlineLinks: Array.from(root.querySelectorAll(".tweet-text-link")).map((link) => ({
        text: link.textContent?.trim() ?? "",
        href: (link as HTMLAnchorElement).href,
        rect: rect(link),
      })),
      linkCards: Array.from(root.querySelectorAll(".link-card")).map((link) => ({
        text: link.textContent?.trim() ?? "",
        href: (link as HTMLAnchorElement).href,
        className: link.className,
        rect: rect(link),
      })),
      linkChips: Array.from(root.querySelectorAll(".link-chip")).map((link) => ({
        text: link.textContent?.trim() ?? "",
        href: (link as HTMLAnchorElement).href,
        rect: rect(link),
      })),
      mediaGrids: Array.from(root.querySelectorAll(".media-grid")).map((grid) => ({
        className: grid.className,
        rect: rect(grid),
        mediaItems: grid.querySelectorAll(".media-item").length,
        videos: grid.querySelectorAll("video").length,
        images: grid.querySelectorAll("img").length,
      })),
      quoteCards: Array.from(root.querySelectorAll(".quote-card")).map((quote) => ({
        className: quote.className,
        text: quote.textContent?.trim().slice(0, 500) ?? "",
        rect: rect(quote),
        mediaGrids: Array.from(quote.querySelectorAll(".media-grid")).map((grid) => ({
          className: grid.className,
          rect: rect(grid),
        })),
        linkCards: quote.querySelectorAll(".link-card").length,
      })),
      footer: {
        text: root.querySelector(".post-footer")?.textContent?.trim() ?? "",
        rect: root.querySelector(".post-footer") ? rect(root.querySelector(".post-footer") as Element) : undefined,
      },
      videos: Array.from(root.querySelectorAll("video")).map((video) => ({
        autoplay: video.autoplay,
        muted: video.muted,
        paused: video.paused,
        currentTime: Math.round(video.currentTime * 100) / 100,
        readyState: video.readyState,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
        src: video.currentSrc || video.src,
        rect: rect(video),
      })),
    };
  });
}

async function renderLocalScreenshots(samples: InventorySample[], runs: RefreshRun[]): Promise<void> {
  if (!renderLocal || !samples.length) {
    return;
  }

  const screenshotDir = join(outputDir, "local-screenshots");
  mkdirSync(screenshotDir, { recursive: true });
  writeFileSync(localRunStorePath, JSON.stringify({ runs: [auditRunFromSamples(samples, runs)] }, null, 2), "utf8");

  const child = spawnServer({
    host,
    port,
    stdio: ["ignore", "pipe", "pipe"],
    extraEnv: {
      RUN_STORE_PATH: localRunStorePath,
      TIMELINE_SOURCE: "replay",
      OPENAI_API_KEY: "",
    },
  });

  let serverOutput = "";
  child.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });

  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let context: Awaited<ReturnType<Awaited<ReturnType<typeof chromium.launch>>["newContext"]>> | undefined;

  try {
    await waitForHealth({ host, port, timeoutMs: 10_000 });
    try {
      browser = await chromium.launch({ headless: true, channel: localBrowserChannel });
    } catch (error) {
      if (process.env.DISPLAY_INVENTORY_BROWSER_CHANNEL) {
        throw error;
      }

      console.warn(`Could not launch Chrome for local display inventory; falling back to bundled Chromium: ${error instanceof Error ? error.message : error}`);
      browser = await chromium.launch({ headless: true });
    }
    context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: "light" });
    const page = await context.newPage();
    await page.goto(`http://${host}:${port}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator("#refresh-button").waitFor({ state: "visible", timeout: 15_000 });

    const sourceLabel = await page.locator("#source-toggle-label").textContent({ timeout: 10_000 });
    if (sourceLabel === "Online") {
      await page.click("#source-toggle");
      await page.waitForFunction(() => document.querySelector("#source-toggle-label")?.textContent === "Offline", undefined, { timeout: 10_000 });
    }

    await page.click("#refresh-button");
    await page.waitForFunction(
      (expected) => document.querySelectorAll(".tweet-card").length === expected && document.querySelector("#task-progress")?.hidden === true,
      samples.length,
      { timeout: 30_000 },
    );

    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      const fileName = `${String(index + 1).padStart(3, "0")}-${sample.pool}-${sample.displayPost.author.username}-${sample.displayPost.id}.png`
        .replace(/[^a-zA-Z0-9_.-]+/g, "-")
        .slice(0, 220);
      const screenshotPath = join(screenshotDir, fileName);
      const card = page.locator(".tweet-card").nth(index);
      await card.scrollIntoViewIfNeeded();
      await waitForLocalMedia(card);
      await card.screenshot({ path: screenshotPath });
      sample.localScreenshot = screenshotPath;
      sample.localScreenshotProbe = inspectPngScreenshot(screenshotPath);
      sample.localFacts = await collectLocalFacts(card);

      if ((index + 1) % 10 === 0 || index + 1 === samples.length) {
        console.log(`Local inventory screenshots: ${index + 1}/${samples.length}`);
      }
    }
  } catch (error) {
    if (serverOutput.trim()) {
      console.error(serverOutput.trim());
    }

    throw error;
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    child.kill("SIGTERM");
  }
}

function countBy<T extends string>(items: T[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    counts[item] = (counts[item] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function screenshotSummary(samples: InventorySample[]) {
  const attempted = samples.filter((sample) => sample.localScreenshot);
  const blank = attempted.filter((sample) => sample.localScreenshotProbe?.blank);
  return {
    localAttempted: attempted.length,
    localBlank: blank.length,
    localBlankSamples: blank.map((sample) => ({
      index: sample.index,
      id: sample.displayPost.id,
      reason: sample.localScreenshotProbe?.reason,
      screenshot: sample.localScreenshot,
    })),
  };
}

function sampleForJson(sample: InventorySample) {
  const allLinks = postLinks(sample.displayPost);
  const quote = sample.displayPost.referencedPostType === "quoted" ? sample.displayPost.referencedPost : undefined;
  return {
    index: sample.index,
    pool: sample.pool,
    runId: sample.runId,
    runCreatedAt: sample.runCreatedAt,
    fetchIndex: sample.fetchIndex,
    selectedIndex: sample.selectedIndex,
    postId: sample.displayPost.id,
    timelinePostId: sample.timelinePost.id,
    url: sample.displayPost.url,
    author: sample.displayPost.author,
    textStart: compactText(sample.displayPost.text, 240),
    buckets: sample.buckets,
    risks: sample.risks,
    missingData: sample.missingData,
    xArticlePreviewEvidenceApplied: sample.xArticlePreviewEvidenceApplied ?? 0,
    flags: sample.flags,
    metrics: sample.displayPost.metrics,
    media: (sample.displayPost.media ?? []).map((media) => ({
      type: media.type,
      width: media.width,
      height: media.height,
      hasUrl: Boolean(media.url),
      hasPreviewImageUrl: Boolean(media.previewImageUrl),
      variantCount: media.variants?.length ?? 0,
    })),
    links: allLinks.map((link) => ({
      domain: linkDomain(link),
      href: linkHref(link),
      displayUrl: link.displayUrl,
      isExternal: isExternalLink(link),
      isXStatus: isXStatusLink(link),
      isXArticle: isXArticleLink(link),
      hasPreview: hasPreview(link),
      previewHasImage: Boolean((link.preview?.images ?? []).some((image) => image.url)),
      title: link.preview?.title,
      description: link.preview?.description,
    })),
    quote: quote
      ? {
          id: quote.id,
          url: quote.url,
          author: quote.author,
          textStart: compactText(quote.text, 200),
          mediaCount: quote.media?.length ?? 0,
          linkCount: quote.links?.length ?? 0,
          xArticleLinks: xArticleLinks(quote).map(linkHref),
          hasXArticleText: hasXArticleText(quote),
        }
      : undefined,
    localScreenshot: sample.localScreenshot,
    localScreenshotProbe: sample.localScreenshotProbe,
    localFacts: sample.localFacts,
  };
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
  await renderLocalScreenshots(samples, runs);

  const reportSamples = samples.map(sampleForJson);
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
    screenshotSummary: screenshotSummary(samples),
    samples: reportSamples,
  };

  writeFileSync(join(outputDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  writeFileSync(join(outputDir, "report.md"), markdownReport(report), "utf8");

  console.log(`Display gap inventory sampled ${report.sampleCount} real X-derived posts.`);
  console.log(`Report: ${join(outputDir, "report.md")}`);
  if (Object.keys(report.riskCounts).length) {
    console.log(`Top risks: ${Object.entries(report.riskCounts).slice(0, 6).map(([risk, count]) => `${risk}:${count}`).join(", ")}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
