import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { chromium } from "playwright";
import { getHost, spawnServer, waitForHealth } from "./env-utils.mjs";
import { buildSamplePool, readerDisplayPost, renderBucketDefinitions } from "./render-buckets.mjs";

const sourceStorePath = process.env.DISPLAY_AUDIT_RUN_STORE || ".data/runs.json";
const maxSamples = positiveInt(process.env.DISPLAY_AUDIT_MAX, 48);
const perBucket = positiveInt(process.env.DISPLAY_AUDIT_PER_BUCKET, 5);
const host = getHost();
const port = positiveInt(process.env.DISPLAY_AUDIT_PORT, 3300);
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = process.env.DISPLAY_AUDIT_DIR || `.data/render-audit/display-fidelity-${timestamp}`;
const auditStorePath = join(outputDir, "audit-runs.json");
const useAuthProfile = process.env.DISPLAY_AUDIT_AUTH_PROFILE === "1";
const loginOnly = process.env.DISPLAY_AUDIT_LOGIN_ONLY === "1";
const authProfileDir = process.env.DISPLAY_AUDIT_AUTH_PROFILE_DIR || ".data/x-audit-browser-profile";
const authBrowserChannel = process.env.DISPLAY_AUDIT_AUTH_CHANNEL || "chrome";
const headless = useAuthProfile ? process.env.DISPLAY_AUDIT_HEADLESS === "1" : process.env.DISPLAY_AUDIT_HEADFUL !== "1";
const localHeadless = useAuthProfile ? process.env.DISPLAY_AUDIT_LOCAL_HEADFUL !== "1" : headless;
const browserOptions = {
  viewport: { width: 1280, height: 900 },
  deviceScaleFactor: 1,
  colorScheme: "light",
};
const xBrowserOptions = {
  ...browserOptions,
  locale: "en-US",
};

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function sanitize(value) {
  return String(value ?? "unknown")
    .replace(/^@/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "unknown";
}

function readRunStore(filePath) {
  const raw = readFileSync(filePath, "utf8");
  return JSON.parse(raw);
}

function scoreByPostIdFromRuns(runs) {
  const scores = new Map();

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

function translationByPostIdFromRuns(runs) {
  const translations = new Map();

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

function fallbackScore() {
  return {
    total: 0,
    dimensions: [],
  };
}

function chooseSamples(pool, latestSelectedIds) {
  const chosen = [];
  const picked = new Set();

  const pick = (sample, bucket) => {
    const id = sample.displayPost.id;
    if (picked.has(id) || chosen.length >= maxSamples) {
      return false;
    }

    picked.add(id);
    chosen.push({ ...sample, bucket });
    return true;
  };

  for (const sample of pool) {
    if (latestSelectedIds.has(sample.displayPost.id)) {
      pick(sample, "latest-selected");
    }
  }

  for (const [bucket, predicate] of renderBucketDefinitions) {
    let count = 0;
    for (const sample of pool) {
      if (count >= perBucket || chosen.length >= maxSamples) {
        break;
      }

      if (!predicate(sample.flags)) {
        continue;
      }

      if (pick(sample, bucket)) {
        count += 1;
      }
    }
  }

  for (const sample of pool) {
    if (chosen.length >= maxSamples) {
      break;
    }

    pick(sample, "recency-fill");
  }

  return chosen;
}

function auditRunFromSamples(samples, scores, translations) {
  const now = new Date().toISOString();

  return {
    id: `audit_${Date.now()}`,
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
      const displayId = sample.displayPost.id;
      const timelineId = sample.timelinePost.id;
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

function rectFromDomRect(rect) {
  return {
    x: Math.round(rect.x * 10) / 10,
    y: Math.round(rect.y * 10) / 10,
    width: Math.round(rect.width * 10) / 10,
    height: Math.round(rect.height * 10) / 10,
    top: Math.round(rect.top * 10) / 10,
    bottom: Math.round(rect.bottom * 10) / 10,
  };
}

function originalTweetSelector(postId) {
  return `article[data-testid="tweet"]:has(a[href*="/status/${String(postId).replaceAll('"', '\\"')}"])`;
}

async function waitForLocalMedia(card) {
  await card.evaluate(async (root) => {
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const waitForVideoProgress = async (video) => {
      const startedAt = Date.now();

      while (Date.now() - startedAt < 3500) {
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
        await video.play();
      } catch {
        // The audit records paused/ready state below.
      }
    }

    await Promise.race([
      Promise.all(videos.map(waitForVideoProgress)),
      wait(videos.length ? 15000 : 900),
    ]);
  });
}

async function collectLocalFacts(card) {
  return card.evaluate((root) => {
    const rect = (element) => {
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
    const mediaGrids = Array.from(root.querySelectorAll(".media-grid")).map((grid) => ({
      className: grid.className,
      rect: rect(grid),
      mediaItems: grid.querySelectorAll(".media-item").length,
      videos: grid.querySelectorAll("video").length,
      images: grid.querySelectorAll("img").length,
      text: grid.innerText.trim(),
    }));
    const videos = Array.from(root.querySelectorAll("video")).map((video) => ({
      autoplay: video.autoplay,
      muted: video.muted,
      paused: video.paused,
      currentTime: Math.round(video.currentTime * 100) / 100,
      readyState: video.readyState,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      poster: video.poster,
      src: video.currentSrc || video.src,
      rect: rect(video),
    }));

    return {
      card: rect(root),
      repostContext: root.querySelector(".repost-context")?.innerText.trim() ?? "",
      authorLine: root.querySelector(".author-line")?.innerText.trim() ?? "",
      text: root.querySelector(".tweet-text")?.innerText.trim() ?? "",
      inlineLinks: Array.from(root.querySelectorAll(".tweet-text-link")).map((link) => ({
        text: link.textContent?.trim() ?? "",
        href: link.href,
        rect: rect(link),
      })),
      linkCards: Array.from(root.querySelectorAll(".link-card")).map((link) => ({
        text: link.innerText.trim(),
        href: link.href,
        className: link.className,
        rect: rect(link),
      })),
      linkChips: Array.from(root.querySelectorAll(".link-chip")).map((link) => ({
        text: link.textContent?.trim() ?? "",
        href: link.href,
        rect: rect(link),
      })),
      mediaGrids,
      quoteCards: Array.from(root.querySelectorAll(".quote-card")).map((quote) => ({
        text: quote.innerText.trim().slice(0, 600),
        className: quote.className,
        rect: rect(quote),
        mediaGrids: Array.from(quote.querySelectorAll(".media-grid")).map((grid) => ({
          className: grid.className,
          rect: rect(grid),
        })),
      })),
      footer: {
        rect: root.querySelector(".post-footer") ? rect(root.querySelector(".post-footer")) : undefined,
        text: root.querySelector(".post-footer")?.innerText.trim() ?? "",
        metrics: Array.from(root.querySelectorAll(".metric-item")).map((metric) => ({
          text: metric.innerText.trim(),
          className: metric.className,
          rect: rect(metric),
        })),
        signal: root.querySelector(".signal-summary") ? rect(root.querySelector(".signal-summary")) : undefined,
      },
      videos,
    };
  });
}

async function collectOriginalFacts(page, postId) {
  return page.locator(originalTweetSelector(postId)).first().evaluate((root) => {
    const rect = (element) => {
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
    const mediaElements = Array.from(root.querySelectorAll("img, video")).filter((element) => {
      const source = element.currentSrc || element.src || "";
      const box = element.getBoundingClientRect();

      if (box.width < 80 || box.height < 80) {
        return false;
      }

      return /pbs\.twimg\.com\/media|twimg\.com\/ext_tw_video|amplify_video|video\.twimg\.com|blob:https:\/\/x\.com/.test(source);
    });
    const videos = Array.from(root.querySelectorAll("video")).map((video) => ({
      autoplay: video.autoplay,
      muted: video.muted,
      paused: video.paused,
      currentTime: Math.round(video.currentTime * 100) / 100,
      readyState: video.readyState,
      videoWidth: video.videoWidth,
      videoHeight: video.videoHeight,
      poster: video.poster,
      src: video.currentSrc || video.src,
      rect: rect(video),
    }));

    return {
      article: rect(root),
      textStart: root.innerText.trim().slice(0, 1200),
      tweetTexts: Array.from(root.querySelectorAll('[data-testid="tweetText"]')).map((node) => node.innerText.trim()),
      links: Array.from(root.querySelectorAll("a[href]")).map((link) => ({
        text: link.innerText.trim(),
        href: link.href,
        aria: link.getAttribute("aria-label"),
        rect: rect(link),
      })),
      cardWrappers: Array.from(root.querySelectorAll('[data-testid*="card"], [data-testid="card.wrapper"]')).map((node) => ({
        testId: node.getAttribute("data-testid"),
        text: node.innerText.trim().slice(0, 400),
        rect: rect(node),
      })),
      media: mediaElements.map((element) => ({
        tag: element.tagName.toLowerCase(),
        alt: element.getAttribute("alt") ?? "",
        src: element.currentSrc || element.src || "",
        rect: rect(element),
      })),
      videos,
    };
  });
}

async function waitForOriginalMedia(page, postId) {
  await page.locator(originalTweetSelector(postId)).first().evaluate(async (article) => {
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

    const images = Array.from(article.querySelectorAll("img"));
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
      wait(6000),
    ]);

    const videos = Array.from(article.querySelectorAll("video"));
    for (const video of videos) {
      try {
        await video.play();
      } catch {
        // X often autoplays muted videos; paused state is captured below.
      }
    }

    await wait(1400);
  });
}

function compareFacts(sample, local, original) {
  const issues = [];
  const localVideoCount = local.videos.length;
  const originalVideoCount = original.videos.length;
  const originalMediaCount = original.media.length;
  const localMediaGridCount = local.mediaGrids.length;
  const localLinkCardCount = local.linkCards.length;
  const localInlineTco = [...local.inlineLinks, ...local.linkChips].filter((link) => /(^|\.)t\.co\//i.test(link.text));
  const originalHasPreviewLikeCard = original.cardWrappers.length > 0;

  if (sample.flags.retweet && !local.repostContext) {
    issues.push("local_missing_repost_context");
  }

  if (sample.flags.mediaCount > 0 && localMediaGridCount === 0) {
    issues.push("local_missing_attached_media");
  }

  if (sample.flags.playableVideo && localVideoCount === 0) {
    issues.push("local_missing_playable_video");
  }

  if (originalVideoCount > 0 && localVideoCount === 0) {
    issues.push("x_has_video_local_does_not");
  }

  if (local.videos.some((video) => !video.autoplay || !video.muted || !video.src)) {
    issues.push("local_video_not_autoplay_muted_or_missing_src");
  }

  if (original.videos.some((video) => !video.paused && video.currentTime > 0) && local.videos.some((video) => video.paused || video.currentTime === 0)) {
    issues.push("x_video_playing_but_local_not_playing_at_capture");
  }

  if (sample.flags.mediaCount === 0 && sample.flags.externalPreviewLinks > 0 && originalHasPreviewLikeCard && localLinkCardCount === 0) {
    issues.push("likely_missing_external_preview_card");
  }

  if (localInlineTco.length > 0) {
    issues.push("local_exposes_tco_text");
  }

  if (originalMediaCount > 0 && sample.flags.mediaCount > 0 && localMediaGridCount === 0) {
    issues.push("x_has_media_local_missing_media_grid");
  }

  return issues;
}

async function waitForXLoggedIn(page, timeoutMs) {
  const startedAt = Date.now();
  const loggedInSelectors = [
    '[data-testid="SideNav_AccountSwitcher_Button"]',
    '[data-testid="AppTabBar_Home_Link"]',
    '[data-testid="primaryColumn"]',
    'a[href="/home"]',
    'a[href="/settings/account"]',
    'a[aria-label*="Profile"]',
  ];

  while (Date.now() - startedAt < timeoutMs) {
    const pageText = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) ?? "").catch(() => "");
    if (/browser or app may not be secure|Couldn't sign you in|Couldn.t sign you in/i.test(pageText)) {
      throw new Error("X audit profile login was blocked by Google SSO. Use the user's already-authenticated Chrome for login-required Original audits.");
    }

    for (const selector of loggedInSelectors) {
      const visible = await page.locator(selector).first().isVisible().catch(() => false);
      if (visible) {
        return true;
      }
    }

    await page.waitForTimeout(1000);
  }

  return false;
}

async function ensureXAuditProfile(context) {
  const page = await context.newPage();

  try {
    await page.goto("https://x.com/home", { waitUntil: "domcontentloaded", timeout: 45_000 });

    if (await waitForXLoggedIn(page, 5000)) {
      return;
    }

    if (headless) {
      throw new Error("X audit profile is not authenticated. Run `npm run display:audit:login` once in a headed browser.");
    }

    console.log("X audit profile needs login. Complete X login in the opened browser window; waiting up to 10 minutes...");

    if (!(await waitForXLoggedIn(page, 10 * 60 * 1000))) {
      throw new Error("Timed out waiting for X audit profile login.");
    }

    console.log("OK X audit profile is authenticated.");
  } finally {
    await page.close().catch(() => {});
  }
}

async function openXContext() {
  if (!useAuthProfile) {
    return undefined;
  }

  mkdirSync(authProfileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(authProfileDir, {
    ...xBrowserOptions,
    headless,
    channel: authBrowserChannel,
  });
  await ensureXAuditProfile(context);
  return context;
}

function markdownReport(report) {
  const lines = [
    "# Display Fidelity Audit",
    "",
    `Created: ${report.createdAt}`,
    `Samples: ${report.samples.length}`,
    `Output: \`${report.outputDir}\``,
    "",
    "## Bucket Coverage",
    "",
    "| Bucket | Count |",
    "| --- | ---: |",
  ];
  const bucketCounts = new Map();

  for (const sample of report.samples) {
    bucketCounts.set(sample.bucket, (bucketCounts.get(sample.bucket) ?? 0) + 1);
  }

  for (const [bucket, count] of [...bucketCounts.entries()].sort()) {
    lines.push(`| ${bucket} | ${count} |`);
  }

  lines.push("", "## Findings", "", "| # | Bucket | Author | Post | Flags | Issues | Local | Original |", "| ---: | --- | --- | --- | --- | --- | --- | --- |");

  for (const sample of report.samples) {
    const flags = Object.entries(sample.flags)
      .filter(([, value]) => value === true || (typeof value === "number" && value > 0))
      .map(([key, value]) => (value === true ? key : `${key}:${value}`))
      .join(", ");
    const issues = sample.issues.length ? sample.issues.join(", ") : "ok";
    lines.push(
      `| ${sample.index} | ${sample.bucket} | @${sample.displayPost.author.username} | [X](${sample.displayPost.url}) | ${flags || "-"} | ${issues} | [local](${sample.localScreenshot}) | [original](${sample.originalScreenshot ?? ""}) |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

async function captureOriginal(context, sample, index) {
  const page = await context.newPage();
  const slug = `${String(index).padStart(2, "0")}-${sanitize(sample.bucket)}-${sanitize(sample.displayPost.author.username)}-${sample.displayPost.id}`;
  const screenshotPath = join(outputDir, `${slug}-x.png`);

  try {
    await page.goto(sample.displayPost.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const targetArticle = page.locator(originalTweetSelector(sample.displayPost.id)).first();
    await targetArticle.waitFor({ state: "visible", timeout: 35_000 });
    await waitForOriginalMedia(page, sample.displayPost.id);
    const article = page.locator(originalTweetSelector(sample.displayPost.id)).first();
    await article.screenshot({ path: screenshotPath });
    const facts = await collectOriginalFacts(page, sample.displayPost.id);
    await page.close();
    return { screenshotPath, facts };
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error);
    const pageText = await page.evaluate(() => document.body?.innerText?.slice(0, 2000) ?? "").catch(() => "");
    const message = /See what's happening|Log in|Sign in|Continue with phone|Continue with Google/i.test(pageText)
      ? `original_requires_auth:${rawMessage}`
      : rawMessage;
    try {
      await page.screenshot({ path: screenshotPath, fullPage: true });
    } catch {
      // Keep the original navigation error.
    }
    await page.close();
    return { screenshotPath, error: message, facts: undefined };
  }
}

async function main() {
  if (loginOnly) {
    if (!useAuthProfile) {
      throw new Error("DISPLAY_AUDIT_LOGIN_ONLY requires DISPLAY_AUDIT_AUTH_PROFILE=1.");
    }

    const loginContext = await openXContext();
    await loginContext.close();
    console.log(`OK X audit browser profile is ready: ${authProfileDir}`);
    return;
  }

  mkdirSync(outputDir, { recursive: true });
  const store = readRunStore(sourceStorePath);
  const requestedRunIds = new Set((process.env.DISPLAY_AUDIT_RUN_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean));
  const liveRuns = (store.runs ?? [])
    .filter((run) => run.source === "x" && run.trace?.inputPosts?.length)
    .filter((run) => !requestedRunIds.size || requestedRunIds.has(run.id))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));

  if (!liveRuns.length) {
    throw new Error(`Display audit needs saved live X runs with trace.inputPosts in ${sourceStorePath}.`);
  }

  const latestSelectedIds = new Set((liveRuns[0].selectedPosts ?? []).map((selected) => readerDisplayPost(selected.post).id));
  const pool = buildSamplePool(liveRuns);
  const samples = chooseSamples(pool, latestSelectedIds);
  const scores = scoreByPostIdFromRuns(liveRuns);
  const translations = translationByPostIdFromRuns(liveRuns);
  const auditRun = auditRunFromSamples(samples, scores, translations);

  writeFileSync(auditStorePath, JSON.stringify({ runs: [auditRun] }, null, 2), "utf8");

  const child = spawnServer({
    host,
    port,
    stdio: ["ignore", "pipe", "pipe"],
    extraEnv: {
      RUN_STORE_PATH: auditStorePath,
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

  const childExit = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });

  let localBrowser;
  let localContext;
  let xContext;

  try {
    await Promise.race([
      waitForHealth({ host, port, timeoutMs: 8000 }),
      childExit.then((exit) => {
        throw new Error(`Audit server exited early (code ${exit.code ?? "null"}, signal ${exit.signal ?? "null"}).`);
      }),
    ]);

    localBrowser = await chromium.launch({ headless: localHeadless });
    localContext = await localBrowser.newContext(browserOptions);
    xContext = useAuthProfile ? await openXContext() : await localBrowser.newContext(xBrowserOptions);
    const localPage = await localContext.newPage();
    await localPage.goto(`http://${host}:${port}`, { waitUntil: "networkidle" });

    const sourceLabel = await localPage.locator("#source-toggle-label").textContent({ timeout: 10_000 });
    if (sourceLabel === "Online") {
      await localPage.click("#source-toggle");
      await localPage.waitForFunction(() => document.querySelector("#source-toggle-label")?.textContent === "Offline", undefined, { timeout: 10_000 });
    }

    await localPage.click("#refresh-button");
    await localPage.waitForFunction(
      (expected) => document.querySelectorAll(".tweet-card").length === expected && document.querySelector("#task-progress")?.hidden === true,
      samples.length,
      { timeout: 15_000 },
    );

    const reportSamples = [];

    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      const slug = `${String(index + 1).padStart(2, "0")}-${sanitize(sample.bucket)}-${sanitize(sample.displayPost.author.username)}-${sample.displayPost.id}`;
      const localScreenshot = join(outputDir, `${slug}-local.png`);
      const card = localPage.locator(".tweet-card").nth(index);
      await card.scrollIntoViewIfNeeded();
      await waitForLocalMedia(card);
      await card.screenshot({ path: localScreenshot });
      const localFacts = await collectLocalFacts(card);
      const original = await captureOriginal(xContext, sample, index + 1);
      const issues = original.facts ? compareFacts(sample, localFacts, original.facts) : [`original_capture_failed:${original.error}`];

      reportSamples.push({
        index: index + 1,
        bucket: sample.bucket,
        runId: sample.runId,
        fetchIndex: sample.fetchIndex,
        displayPost: {
          id: sample.displayPost.id,
          url: sample.displayPost.url,
          author: sample.displayPost.author,
          textStart: sample.displayPost.text.slice(0, 300),
        },
        flags: sample.flags,
        issues,
        localScreenshot,
        originalScreenshot: original.screenshotPath,
        localFacts,
        originalFacts: original.facts,
        originalError: original.error,
      });

      console.log(
        `${String(index + 1).padStart(2, "0")}/${samples.length} ${sample.bucket} @${sample.displayPost.author.username} ${sample.displayPost.id}: ${issues.length ? issues.join(", ") : "ok"}`,
      );
    }

    const report = {
      createdAt: new Date().toISOString(),
      sourceStorePath,
      outputDir,
      auditRunId: auditRun.id,
      sampledLiveRunIds: liveRuns.map((run) => run.id),
      sampleCount: samples.length,
      samples: reportSamples,
    };

    writeFileSync(join(outputDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
    writeFileSync(join(outputDir, "report.md"), markdownReport(report), "utf8");
    const issueCount = reportSamples.reduce((count, sample) => count + sample.issues.length, 0);
    if (issueCount > 0 && process.env.DISPLAY_AUDIT_ALLOW_ISSUES !== "1") {
      throw new Error(`Display fidelity audit found ${issueCount} issue(s). Report: ${join(outputDir, "report.md")}`);
    }

    console.log(`OK display fidelity audit: ${samples.length} samples. Report: ${join(outputDir, "report.md")}`);

    await localContext.close();
    await xContext.close();
  } catch (error) {
    if (serverOutput.trim()) {
      console.error(serverOutput.trim());
    }

    throw error;
  } finally {
    if (xContext) {
      await xContext.close().catch(() => {});
    }

    if (localContext) {
      await localContext.close().catch(() => {});
    }

    if (localBrowser) {
      await localBrowser.close();
    }

    child.kill("SIGTERM");

    if (process.env.DISPLAY_AUDIT_KEEP_STORE !== "1") {
      rmSync(auditStorePath, { force: true });
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
