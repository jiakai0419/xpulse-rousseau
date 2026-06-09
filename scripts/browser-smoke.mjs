import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright";
import { getHost, spawnServer, waitForHealth } from "./env-utils.mjs";

const host = getHost();
const port = Number(process.env.BROWSER_SMOKE_PORT || 3200);
const screenshotPath = process.env.BROWSER_SMOKE_SCREENSHOT || ".data/ui-smoke.png";
const sourceStorePath = process.env.BROWSER_SMOKE_RUN_STORE || ".data/runs.json";
const runStorePath = `.data/browser-smoke-runs-${Date.now()}-${process.pid}.json`;

function seedReplayStore(filePath) {
  const sourceStore = JSON.parse(readFileSync(sourceStorePath, "utf8"));
  const requestedRunId = process.env.BROWSER_SMOKE_RUN_ID;
  const liveRuns = sourceStore.runs.filter((run) => run.source === "x");
  const sourceRun = requestedRunId
    ? liveRuns.find((run) => run.id === requestedRunId)
    : liveRuns.sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())[0];

  if (!sourceRun) {
    throw new Error(
      requestedRunId
        ? `Browser smoke replay could not find saved live X run ${requestedRunId} in ${sourceStorePath}.`
        : `Browser smoke replay needs at least one saved live X run in ${sourceStorePath}.`,
    );
  }

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify({ runs: [sourceRun] }, null, 2), "utf8");
  return sourceRun;
}

const sourceRun = seedReplayStore(runStorePath);
const expectedCards = sourceRun.selectedPosts.length;

function readerDisplayPost(post) {
  if (post?.referencedPostType === "retweeted" && post.referencedPost) {
    return post.referencedPost;
  }

  return post;
}

function hasPlayableVariant(media) {
  const variants = media.variants ?? [];
  return variants.some((variant) => variant.url);
}

function rendersMedia(media) {
  const hasPreview = Boolean(media.url ?? media.previewImageUrl);

  if (!hasPreview) {
    return false;
  }

  if (media.type === "video" || media.type === "animated_gif") {
    return hasPlayableVariant(media);
  }

  return true;
}

function linkHref(link) {
  return link.unwoundUrl ?? link.expandedUrl ?? link.url ?? "";
}

function hasUsefulLinkPreview(link) {
  return Boolean((link.preview?.images ?? []).some((image) => image.url) || link.preview?.title || link.preview?.description);
}

function isMediaLink(link) {
  if (link.mediaKey) {
    return true;
  }

  const value = `${link.displayUrl ?? ""} ${link.expandedUrl ?? ""} ${link.unwoundUrl ?? ""} ${link.url ?? ""}`.toLowerCase();

  return value.includes("pic.x.com") || value.includes("/photo/") || value.includes("/video/") || value.includes("pbs.twimg.com/media");
}

function isXStatusLink(link) {
  try {
    const url = new URL(linkHref(link));
    const host = url.hostname.replace(/^www\./, "").toLowerCase();

    return (host === "x.com" || host === "twitter.com") && /\/status\/\d+/.test(url.pathname);
  } catch {
    return false;
  }
}

function isReferencedStatusLink(post, link) {
  if (isMediaLink(link)) {
    return false;
  }

  if (post.referencedPostType !== "quoted") {
    return false;
  }

  if (post.referencedPost?.url && linkHref(link).startsWith(post.referencedPost.url)) {
    return true;
  }

  return isXStatusLink(link);
}

function shouldRenderPreviewCard(post, link) {
  if (!hasUsefulLinkPreview(link)) {
    return false;
  }

  const hasAttachedVideo = (post.media ?? []).some((media) => media.type === "video" || media.type === "animated_gif");

  if (hasAttachedVideo) {
    return false;
  }

  if (post.media?.length && post.referencedPostType === "quoted") {
    return false;
  }

  return !isReferencedStatusLink(post, link);
}

const expectedMediaItems = sourceRun.selectedPosts.reduce((count, item) => {
  const displayPost = readerDisplayPost(item.post);
  const postMediaCount = Math.min((displayPost.media ?? []).filter(rendersMedia).length, 4);
  const quotedMediaCount =
    displayPost.referencedPostType === "quoted"
      ? Math.min((displayPost.referencedPost?.media ?? []).filter(rendersMedia).length, 4)
      : 0;

  return count + postMediaCount + quotedMediaCount;
}, 0);
const expectedInlineVideos = sourceRun.selectedPosts.reduce((count, item) => {
  const displayPost = readerDisplayPost(item.post);
  const postVideoCount = Math.min(
    (displayPost.media ?? []).filter((media) => (media.type === "video" || media.type === "animated_gif") && rendersMedia(media)).length,
    4,
  );
  const quotedVideoCount =
    displayPost.referencedPostType === "quoted"
      ? Math.min(
          (displayPost.referencedPost?.media ?? []).filter((media) => (media.type === "video" || media.type === "animated_gif") && rendersMedia(media)).length,
          4,
        )
      : 0;

  return count + postVideoCount + quotedVideoCount;
}, 0);
const expectedQuoteCards = sourceRun.selectedPosts.filter((item) => {
  const post = readerDisplayPost(item.post);

  if (post.referencedPostType !== "quoted") {
    return false;
  }

  if (post.referencedPost) {
    return true;
  }

  return (post.links ?? []).some((link) => {
    const value = `${link.displayUrl ?? ""} ${link.expandedUrl ?? ""} ${link.unwoundUrl ?? ""} ${link.url ?? ""}`.toLowerCase();
    return /(x\.com|twitter\.com)\/[^/\s]+\/status\/\d+/.test(value);
  });
}).length;
const expectedQuoteCardsWithMedia = sourceRun.selectedPosts.filter((item) => {
  const post = readerDisplayPost(item.post);

  return post.referencedPostType === "quoted" && (post.referencedPost?.media ?? []).filter(rendersMedia).length > 0;
}).length;
const expectedLinkCards = sourceRun.selectedPosts.reduce((count, item) => {
  const displayPost = readerDisplayPost(item.post);

  return count + (displayPost.links ?? []).filter((link) => shouldRenderPreviewCard(displayPost, link)).length;
}, 0);
const child = spawnServer({
  host,
  port,
  stdio: ["ignore", "pipe", "pipe"],
  extraEnv: {
    RUN_STORE_PATH: runStorePath,
    TIMELINE_SOURCE: "replay",
    OPENAI_API_KEY: "",
  },
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

const childExit = new Promise((resolve) => {
  child.once("exit", (code, signal) => {
    resolve({ code, signal });
  });
});

let browser;

try {
  await Promise.race([
    waitForHealth({ host, port, timeoutMs: 5000 }),
    childExit.then((exit) => {
      throw new Error(`Server exited before browser smoke health check passed (code ${exit.code ?? "null"}, signal ${exit.signal ?? "null"}).`);
    }),
  ]);

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`http://${host}:${port}`, { waitUntil: "networkidle" });

  const sourceLabel = await page.locator("#source-toggle-label").textContent({ timeout: 10_000 });
  if (sourceLabel === "Online") {
    await page.click("#source-toggle");
    await page.waitForFunction(() => document.querySelector("#source-toggle-label")?.textContent === "Offline", undefined, { timeout: 10_000 });
  }

  await page.click("#refresh-button");
  await page.waitForFunction(() => document.querySelector("#task-progress")?.hidden === false, undefined, { timeout: 10_000 });
  await page.waitForFunction(
    (expected) =>
      document.querySelectorAll(".tweet-card").length === expected &&
      document.querySelectorAll(".translation").length === expected &&
      document.querySelector("#task-progress")?.hidden === true,
    expectedCards,
    { timeout: 10_000 },
  );
  await page.waitForSelector(".tweet-card", { timeout: 10_000 });

  const cards = await page.locator(".tweet-card").count();
  const translations = await page.locator(".translation").count();
  const originals = await page.locator(".original-link").count();
  const metrics = await page.locator(".metric-item").count();
  const signals = await page.locator(".signal-details").count();
  const signalSummaries = await page.locator(".signal-summary").count();
  const signalTracks = await page.locator(".signal-summary-rail, .signal-track").count();
  const mediaItems = await page.locator(".media-item").count();
  const mediaButtons = await page.locator(".media-button").count();
  const quoteCards = await page.locator(".quote-card").count();
  const linkCards = await page.locator(".link-card").count();
  const badOriginalLinks = await page.locator(".original-link").evaluateAll((links) =>
    links
      .map((link) => link.getAttribute("href") ?? "")
      .filter((href) => !/^https:\/\/x\.com\/[^/]+\/status\/\d+/.test(href)),
  );
  const rankBox = await page.locator(".rank-badge").first().boundingBox();

  if (cards < 1 || cards > 10) {
    throw new Error(`Expected 1 to 10 tweet cards, found ${cards}.`);
  }

  if (translations !== cards) {
    throw new Error(`Expected one translation per card, found ${translations} translations for ${cards} cards.`);
  }

  if (cards !== sourceRun.selectedPosts.length) {
    throw new Error(`Expected ${sourceRun.selectedPosts.length} replay cards, found ${cards}.`);
  }

  if (originals !== cards) {
    throw new Error(`Expected one Original link per card, found ${originals} for ${cards} cards.`);
  }

  if (badOriginalLinks.length) {
    throw new Error(`Expected Original links to point to X status URLs, found invalid links: ${badOriginalLinks.join(", ")}.`);
  }

  if (metrics !== cards * 4) {
    throw new Error(`Expected four metric items per card, found ${metrics} for ${cards} cards.`);
  }

  if (signals !== cards) {
    throw new Error(`Expected one Signal disclosure per card, found ${signals} for ${cards} cards.`);
  }

  if (signalSummaries !== cards) {
    throw new Error(`Expected one Signal action per card, found ${signalSummaries} for ${cards} cards.`);
  }

  if (signalTracks !== 0) {
    throw new Error(`Expected Signal to avoid rail-style progress bars, found ${signalTracks} tracks.`);
  }

  const signalScoreValues = await page.locator(".signal-summary-score").evaluateAll((scores) =>
    scores.map((score) => Number(score.textContent?.trim())),
  );

  if (signalScoreValues.some((value) => !Number.isFinite(value) || value < 0 || value > 10)) {
    throw new Error(`Expected Signal summary scores to use a 0-10 scale, found ${signalScoreValues.join(", ")}.`);
  }

  await page.locator(".signal-summary").first().click();
  const openSignalBodies = await page.locator(".signal-details.is-open .signal-body:not([hidden])").count();

  if (openSignalBodies < 1) {
    throw new Error("Expected Signal action to expand scoring details.");
  }

  if (mediaItems !== expectedMediaItems) {
    throw new Error(`Expected ${expectedMediaItems} rendered media items, found ${mediaItems}.`);
  }

  if (mediaButtons !== expectedMediaItems) {
    throw new Error(`Expected ${expectedMediaItems} clickable media buttons, found ${mediaButtons}.`);
  }

  if (linkCards !== expectedLinkCards) {
    throw new Error(`Expected ${expectedLinkCards} X-like external preview cards, found ${linkCards}.`);
  }

  if (expectedInlineVideos > 0) {
    const firstVideo = page.locator(".media-item video").first();
    await firstVideo.scrollIntoViewIfNeeded();
    await page.waitForFunction(
      () => {
        const video = document.querySelector(".media-item video");

        return Boolean(video && video.readyState >= 2 && !video.paused && video.currentTime > 0);
      },
      undefined,
      { timeout: 25_000 },
    );

    const videoState = await firstVideo.evaluate((video) => ({
      src: video.currentSrc || video.src,
      readyState: video.readyState,
      paused: video.paused,
      currentTime: video.currentTime,
    }));

    if (!videoState.src.includes("/api/media/proxy?")) {
      throw new Error(`Expected inline X video to use local media proxy, found ${videoState.src}.`);
    }
  }

  const photoButtons = await page.locator('.media-button[data-media-type="photo"]').count();
  const badSingleMediaGeometry = await page.locator(".tweet-card > .tweet-main > .media-grid.media-count-1").evaluateAll((grids) =>
    grids
      .map((grid) => {
        const gridBox = grid.getBoundingClientRect();
        const item = grid.querySelector(".media-item");
        const ratio = item ? Number(getComputedStyle(item).getPropertyValue("--media-ratio-value")) : 0;
        const actualRatio = gridBox.width / gridBox.height;

        return {
          width: gridBox.width,
          height: gridBox.height,
          ratio,
          actualRatio,
        };
      })
      .filter((media) => {
        if (!Number.isFinite(media.ratio) || media.ratio <= 0) {
          return true;
        }

        return media.height > 512 || Math.abs(media.actualRatio - media.ratio) > 0.04;
      }),
  );

  if (badSingleMediaGeometry.length) {
    throw new Error(`Expected single media to preserve X-like source aspect ratio within a 510px timeline cap, found ${JSON.stringify(badSingleMediaGeometry)}.`);
  }

  if (photoButtons > 0) {
    await page.locator('.media-button[data-media-type="photo"]').first().click();
    await page.waitForSelector("#media-viewer:not([hidden])", { timeout: 10_000 });

    const viewerImageSrc = await page.locator("#media-viewer-image").getAttribute("src");
    if (!viewerImageSrc || !viewerImageSrc.includes("pbs.twimg.com/media")) {
      throw new Error(`Expected media viewer to show saved X media, found ${viewerImageSrc ?? "missing image src"}.`);
    }

    await page.waitForFunction(() => {
      const image = document.querySelector("#media-viewer-image");

      return image && !image.hidden && image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
    }, undefined, { timeout: 10_000 });

    const viewerImageBox = await page.locator("#media-viewer-image").evaluate((image) => {
      const rect = image.getBoundingClientRect();

      return {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    });

    if (
      viewerImageBox.top < -1 ||
      viewerImageBox.left < -1 ||
      viewerImageBox.right > viewerImageBox.viewportWidth + 1 ||
      viewerImageBox.bottom > viewerImageBox.viewportHeight + 1
    ) {
      throw new Error(`Expected media viewer image to fit inside the viewport, found ${JSON.stringify(viewerImageBox)}.`);
    }

    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector("#media-viewer")?.hidden === true, undefined, { timeout: 10_000 });
  }

  const videoButtons = await page.locator('.media-button[data-media-type="video"], .media-button[data-media-type="animated_gif"]').count();
  if (videoButtons > 0) {
    const inlineVideoState = await page.locator(".media-button video").first().evaluate((video) => ({
      autoplay: video.autoplay,
      muted: video.muted,
      playsInline: video.playsInline,
      src: video.getAttribute("src") ?? "",
    }));

    if (!inlineVideoState.autoplay || !inlineVideoState.muted || !inlineVideoState.playsInline || !inlineVideoState.src) {
      throw new Error(`Expected timeline video media to autoplay muted inline, found ${JSON.stringify(inlineVideoState)}.`);
    }

    await page.locator('.media-button[data-media-type="video"], .media-button[data-media-type="animated_gif"]').first().click();
    await page.waitForSelector("#media-viewer:not([hidden])", { timeout: 10_000 });

    const videoViewerState = await page.locator("#media-viewer").evaluate((viewer) => {
      const video = viewer.querySelector("#media-viewer-video");

      return {
        videoVisible: video ? !video.hidden : false,
        videoSrc: video?.getAttribute("src") ?? "",
      };
    });

    if (videoViewerState.videoVisible && !videoViewerState.videoSrc) {
      throw new Error(`Expected visible video viewer to have a playable src, found ${JSON.stringify(videoViewerState)}.`);
    }

    if (!videoViewerState.videoVisible) {
      throw new Error(`Expected rendered video media to play locally from saved variants, found ${JSON.stringify(videoViewerState)}.`);
    }

    await page.keyboard.press("Escape");
    await page.waitForFunction(() => document.querySelector("#media-viewer")?.hidden === true, undefined, { timeout: 10_000 });
  }

  if (quoteCards !== expectedQuoteCards) {
    throw new Error(`Expected ${expectedQuoteCards} quote cards, found ${quoteCards}.`);
  }

  const quoteCardsWithMedia = await page.locator(".quote-card-has-media").count();
  if (quoteCardsWithMedia !== expectedQuoteCardsWithMedia) {
    throw new Error(`Expected ${expectedQuoteCardsWithMedia} media quote cards, found ${quoteCardsWithMedia}.`);
  }

  const squeezedQuoteMedia = await page
    .locator(
      ".quote-card-has-media .media-count-2, .quote-card-has-media .media-count-3, .quote-card-has-media .media-count-4, .quote-card-has-media .media-single-video",
    )
    .evaluateAll((grids) =>
      grids
        .map((grid) => {
          const cardBox = grid.closest(".quote-card")?.getBoundingClientRect();
          const mediaBox = grid.getBoundingClientRect();

          return cardBox ? Math.abs(cardBox.width - mediaBox.width) : 0;
        })
        .filter((difference) => difference > 4),
  );

  if (squeezedQuoteMedia.length) {
    throw new Error(`Expected multi-media and video quote media to fill quote card width, found width differences: ${squeezedQuoteMedia.join(", ")}.`);
  }

  const badQuoteVideoRatios = await page.locator(".quote-card-has-media .media-single-video").evaluateAll((grids) =>
    grids
      .map((grid) => {
        const rect = grid.getBoundingClientRect();
        return rect.width / rect.height;
      })
      .filter((ratio) => ratio < 1.72 || ratio > 1.82),
  );

  if (badQuoteVideoRatios.length) {
    throw new Error(`Expected single quote videos to use an X-like 16:9 preview frame, found ratios: ${badQuoteVideoRatios.join(", ")}.`);
  }

  const badTwoMediaRatios = await page.locator(".media-grid.media-count-2").evaluateAll((grids) =>
    grids
      .map((grid) => {
        const rect = grid.getBoundingClientRect();
        return rect.width / rect.height;
      })
      .filter((ratio) => ratio < 1.72 || ratio > 1.82),
  );

  if (badTwoMediaRatios.length) {
    throw new Error(`Expected two-media galleries to use an X-like 16:9 frame, found ratios: ${badTwoMediaRatios.join(", ")}.`);
  }

  const badMultiMediaRatios = await page.locator(".media-grid.media-count-3, .media-grid.media-count-4").evaluateAll((grids) =>
    grids
      .map((grid) => {
        const rect = grid.getBoundingClientRect();
        const expected = Number(getComputedStyle(grid).getPropertyValue("--media-gallery-ratio-value") || "1");
        return {
          expected,
          actual: rect.width / rect.height,
        };
      })
      .filter((ratio) => !Number.isFinite(ratio.expected) || Math.abs(ratio.actual - ratio.expected) > 0.04),
  );

  if (badMultiMediaRatios.length) {
    throw new Error(`Expected 3/4-media galleries to follow saved X-derived source shape, found ratios: ${JSON.stringify(badMultiMediaRatios)}.`);
  }

  if (!rankBox || rankBox.height > 34) {
    throw new Error(`Expected compact rank badge, found height ${rankBox?.height ?? "missing"}.`);
  }

  mkdirSync(dirname(screenshotPath), { recursive: true });
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`OK browser smoke replay: ${cards} cards from ${sourceRun.id}. Screenshot: ${screenshotPath}`);
} catch (error) {
  if (output.trim()) {
    console.error(output.trim());
  }
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  if (browser) {
    await browser.close();
  }
  child.kill("SIGTERM");
  rmSync(runStorePath, { force: true });
}
