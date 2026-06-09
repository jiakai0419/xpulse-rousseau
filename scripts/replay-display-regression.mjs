import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const sourceStorePath = process.env.REPLAY_DISPLAY_RUN_STORE || ".data/runs.json";
const maxRuns = positiveInt(process.env.REPLAY_DISPLAY_MAX_RUNS, 8);
const browserSmokeAttempts = positiveInt(process.env.REPLAY_DISPLAY_BROWSER_SMOKE_ATTEMPTS, 2);
const portBase = positiveInt(process.env.REPLAY_DISPLAY_PORT_BASE, 3400);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = process.env.REPLAY_DISPLAY_DIR || `.data/render-regression/replay-display-${timestamp}`;
const requiredBuckets = (process.env.REPLAY_DISPLAY_REQUIRED_BUCKETS ?? [
  "retweet",
  "quote",
  "quote-media",
  "quote-video",
  "single-photo",
  "single-video",
  "playable-video",
  "multi-media",
  "external-preview",
  "external-no-preview",
  "media-plus-link",
  "x-status-link",
  "text-only",
].join(","))
  .split(",")
  .map((bucket) => bucket.trim())
  .filter(Boolean);

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readRunStore(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function readerDisplayPost(post) {
  if (post?.referencedPostType === "retweeted" && post.referencedPost) {
    return post.referencedPost;
  }

  return post;
}

function linkHref(link) {
  return link.unwoundUrl ?? link.expandedUrl ?? link.url ?? "";
}

function linkHost(link) {
  try {
    return new URL(linkHref(link)).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function isXHost(hostname) {
  return hostname === "x.com" || hostname === "twitter.com" || hostname.endsWith(".x.com") || hostname.endsWith(".twitter.com");
}

function isXStatusLink(link) {
  try {
    const url = new URL(linkHref(link));
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    return isXHost(host) && /\/status\/\d+/.test(url.pathname);
  } catch {
    return false;
  }
}

function isMediaLink(link) {
  if (link.mediaKey) {
    return true;
  }

  const value = `${link.displayUrl ?? ""} ${link.expandedUrl ?? ""} ${link.unwoundUrl ?? ""} ${link.url ?? ""}`.toLowerCase();
  return value.includes("pic.x.com") || value.includes("/photo/") || value.includes("/video/") || value.includes("pbs.twimg.com/media");
}

function isExternalLink(link) {
  const host = linkHost(link);
  if (!host) {
    return false;
  }

  return !isXHost(host) && host !== "t.co" && !host.endsWith("twimg.com");
}

function hasPreview(link) {
  return Boolean(link.preview?.title || link.preview?.description || (link.preview?.images ?? []).some((image) => image.url));
}

function hasPlayableVideo(media) {
  return (media.variants ?? []).some((variant) => variant.url && (!variant.contentType || variant.contentType.includes("mp4")));
}

function postBuckets(timelinePost) {
  const displayPost = readerDisplayPost(timelinePost);
  const links = displayPost.links ?? [];
  const media = displayPost.media ?? [];
  const quoted = displayPost.referencedPostType === "quoted" ? displayPost.referencedPost : undefined;
  const quotedMedia = quoted?.media ?? [];
  const buckets = new Set();

  if (timelinePost.referencedPostType === "retweeted" && timelinePost.referencedPost) {
    buckets.add("retweet");
  }

  if (displayPost.referencedPostType === "quoted") {
    buckets.add("quote");
  }

  if (quotedMedia.length > 0) {
    buckets.add("quote-media");
  }

  if (quotedMedia.some((item) => item.type === "video" || item.type === "animated_gif")) {
    buckets.add("quote-video");
  }

  if (media.length === 1 && media[0]?.type === "photo") {
    buckets.add("single-photo");
  }

  if (media.length === 1 && (media[0]?.type === "video" || media[0]?.type === "animated_gif")) {
    buckets.add("single-video");
  }

  if (media.some((item) => (item.type === "video" || item.type === "animated_gif") && hasPlayableVideo(item))) {
    buckets.add("playable-video");
  }

  if (media.length > 1) {
    buckets.add("multi-media");
  }

  if (links.some((link) => isExternalLink(link) && hasPreview(link))) {
    buckets.add("external-preview");
  }

  if (links.some((link) => isExternalLink(link) && !hasPreview(link))) {
    buckets.add("external-no-preview");
  }

  if (media.length > 0 && links.some(isExternalLink)) {
    buckets.add("media-plus-link");
  }

  if (links.some(isXStatusLink)) {
    buckets.add("x-status-link");
  }

  if (media.length === 0 && links.length === 0 && displayPost.referencedPostType !== "quoted") {
    buckets.add("text-only");
  }

  if (links.some(isMediaLink)) {
    buckets.add("media-link");
  }

  return buckets;
}

function runCoverage(run) {
  const buckets = new Set();

  for (const selected of run.selectedPosts ?? []) {
    for (const bucket of postBuckets(selected.post)) {
      buckets.add(bucket);
    }
  }

  return buckets;
}

function chooseRuns(liveRuns) {
  const candidates = liveRuns
    .filter((run) => (run.selectedPosts ?? []).length > 0)
    .map((run) => ({
      run,
      buckets: runCoverage(run),
    }))
    .sort((left, right) => Date.parse(right.run.createdAt) - Date.parse(left.run.createdAt));

  if (!candidates.length) {
    throw new Error(`Replay display regression needs saved live X runs with selected posts in ${sourceStorePath}.`);
  }

  const missing = new Set(requiredBuckets);
  const chosen = [];

  const add = (candidate) => {
    if (chosen.some((item) => item.run.id === candidate.run.id)) {
      return;
    }

    chosen.push(candidate);
    for (const bucket of candidate.buckets) {
      missing.delete(bucket);
    }
  };

  add(candidates[0]);

  while (missing.size > 0 && chosen.length < maxRuns) {
    let best;
    let bestScore = 0;

    for (const candidate of candidates) {
      if (chosen.some((item) => item.run.id === candidate.run.id)) {
        continue;
      }

      const score = [...candidate.buckets].filter((bucket) => missing.has(bucket)).length;
      if (score > bestScore) {
        best = candidate;
        bestScore = score;
      }
    }

    if (!best) {
      break;
    }

    add(best);
  }

  if (missing.size > 0) {
    throw new Error(
      `Replay display regression is missing required real X-derived buckets: ${[...missing].join(", ")}. Run fresh Online Pulse until these shapes appear, then retry.`,
    );
  }

  return chosen;
}

function markdownReport(report) {
  const lines = [
    "# Replay Display Regression",
    "",
    `Created: ${report.createdAt}`,
    `Run store: \`${report.sourceStorePath}\``,
    `Output: \`${report.outputDir}\``,
    "",
    "## Required Bucket Coverage",
    "",
    "| Bucket | Covered By |",
    "| --- | --- |",
  ];

  for (const bucket of requiredBuckets) {
    const runIds = report.runs.filter((run) => run.buckets.includes(bucket)).map((run) => run.runId);
    lines.push(`| ${bucket} | ${runIds.join(", ")} |`);
  }

  lines.push("", "## Runs", "", "| # | Run | Selected | Attempts | Buckets | Screenshot |", "| ---: | --- | ---: | ---: | --- | --- |");

  for (const run of report.runs) {
    lines.push(`| ${run.index} | ${run.runId} | ${run.selectedCount} | ${run.attempts} | ${run.buckets.join(", ")} | [png](${run.screenshotPath}) |`);
  }

  return `${lines.join("\n")}\n`;
}

function runBrowserSmoke(run, index, screenshotPath) {
  let lastResult;

  for (let attempt = 1; attempt <= browserSmokeAttempts; attempt += 1) {
    const env = {
      ...process.env,
      BROWSER_SMOKE_RUN_STORE: sourceStorePath,
      BROWSER_SMOKE_RUN_ID: run.id,
      BROWSER_SMOKE_PORT: String(portBase + index + (attempt - 1) * maxRuns),
      BROWSER_SMOKE_SCREENSHOT: screenshotPath,
    };
    const result = spawnSync(process.execPath, ["scripts/browser-smoke.mjs"], {
      cwd: process.cwd(),
      env,
      encoding: "utf8",
    });
    lastResult = result;

    if (result.stdout.trim()) {
      console.log(result.stdout.trim());
    }

    if (result.stderr.trim()) {
      console.error(result.stderr.trim());
    }

    if (result.status === 0) {
      return attempt;
    }

    if (attempt < browserSmokeAttempts) {
      console.error(`Browser replay regression failed for ${run.id} on attempt ${attempt}; retrying once for transient browser media timing.`);
    }
  }

  throw new Error(`Browser replay regression failed for ${run.id} after ${browserSmokeAttempts} attempt${browserSmokeAttempts === 1 ? "" : "s"}. Last status: ${lastResult?.status ?? "unknown"}.`);
}

function main() {
  mkdirSync(outputDir, { recursive: true });
  const store = readRunStore(sourceStorePath);
  const liveRuns = (store.runs ?? [])
    .filter((run) => run.source === "x")
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const chosen = chooseRuns(liveRuns);
  const reportRuns = [];

  console.log(`Replay display regression selected ${chosen.length} real X-derived runs.`);

  for (let index = 0; index < chosen.length; index += 1) {
    const { run, buckets } = chosen[index];
    const screenshotPath = join(outputDir, `${String(index + 1).padStart(2, "0")}-${run.id}.png`);
    const attempts = runBrowserSmoke(run, index, screenshotPath);

    reportRuns.push({
      index: index + 1,
      runId: run.id,
      createdAt: run.createdAt,
      selectedCount: run.selectedPosts.length,
      attempts,
      buckets: [...buckets].sort(),
      screenshotPath,
    });
  }

  const report = {
    createdAt: new Date().toISOString(),
    sourceStorePath,
    outputDir,
    requiredBuckets,
    runs: reportRuns,
  };

  writeFileSync(join(outputDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  writeFileSync(join(outputDir, "report.md"), markdownReport(report), "utf8");
  console.log(`OK replay display regression: ${reportRuns.length} runs. Report: ${join(outputDir, "report.md")}`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
