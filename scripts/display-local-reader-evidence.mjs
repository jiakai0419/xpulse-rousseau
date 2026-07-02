import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { spawnServer, waitForHealth } from "./env-utils.mjs";
import { inspectPngScreenshot } from "./screenshot-probe.mjs";

const DEFAULT_VIEWPORT = { width: 1280, height: 900 };

export function localReaderScreenshotFileName(sample, position) {
  return `${String(position).padStart(3, "0")}-${sample.pool}-${sample.displayPost.author.username}-${sample.displayPost.id}.png`
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .slice(0, 220);
}

export function localReaderEvidenceSummary(samples) {
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

export async function waitForLocalReaderMedia(card) {
  await card.evaluate(async (root) => {
    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    const waitForVideoProgress = async (video, timeoutMs) => {
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

export async function collectLocalReaderFacts(card) {
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

    return {
      card: rect(root),
      repostContext: root.querySelector(".repost-context")?.textContent?.trim() ?? "",
      authorLine: root.querySelector(".author-line")?.textContent?.trim() ?? "",
      text: root.querySelector(".tweet-text")?.textContent?.trim() ?? "",
      inlineLinks: Array.from(root.querySelectorAll(".tweet-text-link")).map((link) => ({
        text: link.textContent?.trim() ?? "",
        href: link.href,
        rect: rect(link),
      })),
      linkCards: Array.from(root.querySelectorAll(".link-card")).map((link) => ({
        text: link.textContent?.trim() ?? "",
        href: link.href,
        className: link.className,
        rect: rect(link),
      })),
      linkChips: Array.from(root.querySelectorAll(".link-chip")).map((link) => ({
        text: link.textContent?.trim() ?? "",
        href: link.href,
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
        rect: root.querySelector(".post-footer") ? rect(root.querySelector(".post-footer")) : undefined,
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

async function launchLocalReaderBrowser({ browserChannel = "chrome", browserChannelExplicit = false }) {
  try {
    return await chromium.launch({ headless: true, channel: browserChannel });
  } catch (error) {
    if (browserChannelExplicit) {
      throw error;
    }

    console.warn(`Could not launch Chrome for local display inventory; falling back to bundled Chromium: ${error instanceof Error ? error.message : error}`);
    return chromium.launch({ headless: true });
  }
}

export async function collectLocalReaderEvidence(samples, options) {
  const {
    enabled = true,
    outputDir,
    runStorePath,
    replayRun,
    host,
    port,
    browserChannel = "chrome",
    browserChannelExplicit = false,
    viewport = DEFAULT_VIEWPORT,
    onProgress = (completed, total) => {
      if (completed % 10 === 0 || completed === total) {
        console.log(`Local inventory screenshots: ${completed}/${total}`);
      }
    },
  } = options ?? {};

  if (!enabled || !samples.length) {
    return;
  }

  const screenshotDir = join(outputDir, "local-screenshots");
  mkdirSync(screenshotDir, { recursive: true });
  writeFileSync(runStorePath, JSON.stringify({ runs: [replayRun] }, null, 2), "utf8");

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

  let serverOutput = "";
  child.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });

  let browser;
  let context;

  try {
    await waitForHealth({ host, port, timeoutMs: 10_000 });
    browser = await launchLocalReaderBrowser({ browserChannel, browserChannelExplicit });
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
      const screenshotPath = join(screenshotDir, localReaderScreenshotFileName(sample, index + 1));
      const card = page.locator(".tweet-card").nth(index);
      await card.scrollIntoViewIfNeeded();
      await waitForLocalReaderMedia(card);
      await card.screenshot({ path: screenshotPath });
      sample.localScreenshot = screenshotPath;
      sample.localScreenshotProbe = inspectPngScreenshot(screenshotPath);
      sample.localFacts = await collectLocalReaderFacts(card);
      onProgress(index + 1, samples.length);
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
