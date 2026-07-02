import { mkdtempSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  contentfulOriginalProbeResult,
  originalCaptureAuthorSlug,
  originalCaptureTarget,
  originalProbeMatchesCssClip,
  originalValidationErrors,
  retryableOriginalCaptureErrors,
  sanitizeOriginalCaptureSlug,
  scaleClipForScreenshot,
} from "./display-original-capture-core.mjs";
import { buildOriginalScreenshotQuality } from "./display-screenshot-quality.mjs";

export { retryableOriginalCaptureErrors, scaleClipForScreenshot } from "./display-original-capture-core.mjs";

export function loadOriginalCaptureBatch(batchPath) {
  return JSON.parse(readFileSync(batchPath, "utf8")).samples ?? [];
}

export async function readXOriginalArticleEvidence(tab, sampleOrPostId) {
  return tab.playwright.evaluate((target) => {
    const normalize = (value) =>
      String(value ?? "")
        .replace(/https?:\/\/\S+/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    const fullFingerprint = normalize(target.textStart);
    const fingerprint = fullFingerprint.slice(0, 72);
    const articleMatches = (article) => {
      const hasStatusLink = Array.from(article.querySelectorAll("a[href]")).some((link) =>
        String(link.getAttribute("href") ?? "").includes(`/status/${target.postId}`),
      );

      if (hasStatusLink) {
        return true;
      }

      if (fingerprint.length >= 24 && normalize(article.innerText).includes(fingerprint)) {
        return true;
      }

      const terms = fullFingerprint.split(" ").filter((term) => term.length > 4).slice(0, 8);
      return terms.length >= 3 && terms.every((term) => normalize(article.innerText).includes(term));
    };
    const root = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).find(articleMatches);

    if (!root) {
      return {
        found: false,
        foundExactArticle: false,
        articleCount: document.querySelectorAll('article[data-testid="tweet"]').length,
        textStart: document.body?.innerText?.trim().slice(0, 1600) ?? "",
        title: document.title,
        url: location.href,
      };
    }

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
    const articleRect = rect(root);
    const width = Math.max(1, Math.min(Math.ceil(root.getBoundingClientRect().width), window.innerWidth));
    const height = Math.max(1, Math.min(Math.ceil(root.getBoundingClientRect().height), window.innerHeight));

    return {
      found: true,
      clip: {
        x: Math.max(0, Math.floor(root.getBoundingClientRect().x)),
        y: Math.max(0, Math.floor(root.getBoundingClientRect().y)),
        width,
        height,
      },
      facts: {
        articleCount: document.querySelectorAll('article[data-testid="tweet"]').length,
        articleRect,
        cardWrappers: Array.from(root.querySelectorAll('[data-testid*="card"], [data-testid="card.wrapper"]')).map((node) => ({
          testId: node.getAttribute("data-testid"),
          text: node.innerText.trim().slice(0, 400),
          rect: rect(node),
        })),
        foundExactArticle: true,
        matchMethod: Array.from(root.querySelectorAll("a[href]")).some((link) =>
          String(link.getAttribute("href") ?? "").includes(`/status/${target.postId}`),
        )
          ? "status_link"
          : "text_fingerprint",
        media: mediaElements.map((element) => ({
          tag: element.tagName.toLowerCase(),
          alt: element.getAttribute("alt") ?? "",
          autoplay: Boolean(element.autoplay),
          currentTime: Math.round((Number(element.currentTime) || 0) * 100) / 100,
          muted: Boolean(element.muted),
          paused: Boolean(element.paused),
          rect: rect(element),
          src: element.currentSrc || element.src || "",
        })),
        textStart: root.innerText.trim().slice(0, 1600),
        title: document.title,
        url: location.href,
      },
    };
  }, originalCaptureTarget(sampleOrPostId));
}

export async function collectXOriginalFacts(tab, sampleOrPostId) {
  const evidence = await readXOriginalArticleEvidence(tab, sampleOrPostId);

  if (evidence.found) {
    return evidence.facts;
  }

  return {
    articleCount: evidence.articleCount,
    foundExactArticle: false,
    textStart: evidence.textStart,
    title: evidence.title,
    url: evidence.url,
  };
}

export async function revealXOriginalInterstitials(tab) {
  const target = await tab.playwright
    .evaluate(() => {
      const visible = (element) => {
        const box = element.getBoundingClientRect();
        return box.width > 0 && box.height > 0;
      };
      const candidates = Array.from(document.querySelectorAll('button, a, div[role="button"], span')).filter(visible);
      const element = candidates.find((candidate) => /^show probable spam$/i.test(String(candidate.textContent ?? "").trim()));

      if (!element) {
        return undefined;
      }

      const box = element.getBoundingClientRect();
      return {
        x: Math.max(1, Math.round(box.x + box.width / 2)),
        y: Math.max(1, Math.round(box.y + box.height / 2)),
      };
    })
    .catch(() => undefined);

  if (target?.x && target?.y) {
    if (tab.cua?.click) {
      await tab.cua.click(target).catch(() => {});
    } else {
      await tab.playwright
        .evaluate((point) => {
          document.elementFromPoint(point.x, point.y)?.click();
        }, target)
        .catch(() => {});
    }
    await tab.playwright.waitForTimeout(1_200).catch(() => {});
    return true;
  }

  return false;
}

export async function waitForXOriginalArticle(tab, sampleOrPostId, timeoutMs = 45_000) {
  const page = tab.playwright;
  const target = originalCaptureTarget(sampleOrPostId);
  const startedAt = Date.now();
  let scrollStep = 0;

  while (Date.now() - startedAt < timeoutMs) {
    const state = await page
      .evaluate((targetInfo) => {
        const normalize = (value) =>
          String(value ?? "")
            .replace(/https?:\/\/\S+/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
        const fullFingerprint = normalize(targetInfo.textStart);
        const fingerprint = fullFingerprint.slice(0, 72);
        const articleMatches = (candidate) => {
          const hasStatusLink = Array.from(candidate.querySelectorAll("a[href]")).some((link) =>
            String(link.getAttribute("href") ?? "").includes(`/status/${targetInfo.postId}`),
          );

          if (hasStatusLink) {
            return true;
          }

          if (fingerprint.length >= 24 && normalize(candidate.innerText).includes(fingerprint)) {
            return true;
          }

          const terms = fullFingerprint.split(" ").filter((term) => term.length > 4).slice(0, 8);
          return terms.length >= 3 && terms.every((term) => normalize(candidate.innerText).includes(term));
        };
        const text = document.body?.innerText?.slice(0, 2000) ?? "";
        const article = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).find(articleMatches);

        if (!article) {
          return {
            found: false,
            text,
            maxScrollY: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
          };
        }

        article.scrollIntoView({ block: "start", inline: "nearest" });
        const box = article.getBoundingClientRect();
        return {
          found: box.width > 0 && box.height > 0,
          text,
          maxScrollY: Math.max(0, document.documentElement.scrollHeight - window.innerHeight),
        };
      }, target)
      .catch(() => ({ found: false, text: "", maxScrollY: 0 }));

    if (state.found) {
      return true;
    }

    if (/Show probable spam/i.test(state.text)) {
      const revealed = await revealXOriginalInterstitials(tab);
      if (revealed) {
        continue;
      }
    }

    if (/See what's happening|Log in|Sign in|Continue with phone|Continue with Google|Don.t miss what.s happening/i.test(state.text)) {
      throw new Error("original_requires_auth");
    }

    await page.evaluate((info) => {
      const maxScrollY = Number(info.maxScrollY) || 0;
      if (maxScrollY <= 0) {
        window.scrollTo(0, 0);
        return;
      }

      window.scrollTo(0, Math.min(maxScrollY, Math.round((info.step + 1) * window.innerHeight * 0.8)));
    }, { maxScrollY: state.maxScrollY, step: scrollStep });
    scrollStep += 1;
    await page.waitForTimeout(500);
  }

  throw new Error(`Timed out waiting for Original article status/${target.postId}.`);
}

export async function waitForXOriginalMedia(tab, sampleOrPostId) {
  await tab.playwright.evaluate(async (target) => {
    const normalize = (value) => String(value ?? "").replace(/https?:\/\/\S+/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    const fullFingerprint = normalize(target.textStart);
    const fingerprint = fullFingerprint.slice(0, 72);
    const article = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).find((candidate) => {
      const hasStatusLink = Array.from(candidate.querySelectorAll("a[href]")).some((link) =>
        String(link.getAttribute("href") ?? "").includes(`/status/${target.postId}`),
      );

      if (hasStatusLink) {
        return true;
      }

      if (fingerprint.length >= 24 && normalize(candidate.innerText).includes(fingerprint)) {
        return true;
      }

      const terms = fullFingerprint.split(" ").filter((term) => term.length > 4).slice(0, 8);
      return terms.length >= 3 && terms.every((term) => normalize(candidate.innerText).includes(term));
    });

    if (!article) {
      return;
    }

    article.scrollIntoView({ block: "start", inline: "nearest" });

    const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
    await wait(2200);
  }, originalCaptureTarget(sampleOrPostId));
}

export async function originalArticleClip(tab, sampleOrPostId) {
  return tab.playwright.evaluate((target) => {
    const normalize = (value) =>
      String(value ?? "")
        .replace(/https?:\/\/\S+/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
    const fingerprint = normalize(target.textStart).slice(0, 96);
    const article = Array.from(document.querySelectorAll('article[data-testid="tweet"]')).find((candidate) => {
      const hasStatusLink = Array.from(candidate.querySelectorAll("a[href]")).some((link) =>
        String(link.getAttribute("href") ?? "").includes(`/status/${target.postId}`),
      );

      if (hasStatusLink) {
        return true;
      }

      if (fingerprint.length >= 40 && normalize(candidate.innerText).includes(fingerprint)) {
        return true;
      }

      const terms = normalize(target.textStart).split(" ").filter((term) => term.length > 4).slice(0, 8);
      return terms.length >= 3 && terms.every((term) => normalize(candidate.innerText).includes(term));
    });

    if (!article) {
      return undefined;
    }

    const box = article.getBoundingClientRect();
    const width = Math.max(1, Math.min(Math.ceil(box.width), window.innerWidth));
    const height = Math.max(1, Math.min(Math.ceil(box.height), window.innerHeight));
    return {
      x: Math.max(0, Math.floor(box.x)),
      y: Math.max(0, Math.floor(box.y)),
      width,
      height,
    };
  }, originalCaptureTarget(sampleOrPostId));
}

async function viewportDimensions(tab) {
  return tab.playwright
    .evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
    }))
    .catch(() => undefined);
}

function cropViewportScreenshotToClip(inputPath, outputPath, clip, viewport, probe) {
  const scaledClip = scaleClipForScreenshot(clip, viewport, probe);
  if (!scaledClip) {
    return false;
  }

  const tempDir = mkdtempSync(join(tmpdir(), "xpulse-original-crop-"));
  const cropPath = join(tempDir, "article-clip.png");

  try {
    const result = spawnSync(
      "sips",
      [
        "--cropToHeightWidth",
        String(scaledClip.height),
        String(scaledClip.width),
        "--cropOffset",
        String(scaledClip.y),
        String(scaledClip.x),
        inputPath,
        "--out",
        cropPath,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    if (result.status !== 0) {
      return false;
    }

    renameSync(cropPath, outputPath);
    return true;
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function captureArticleClipFromViewport(tab, screenshotPath, inspectScreenshot, clip, sampleOrPostId) {
  const foundArticle = await waitForScreenshotPaint(tab, sampleOrPostId, clip, 1);
  const activeClip = (await originalArticleClip(tab, sampleOrPostId).catch(() => undefined)) ?? (foundArticle === false ? undefined : clip);
  if (!activeClip) {
    return undefined;
  }

  const viewport = await viewportDimensions(tab);
  const screenshot = await tab.screenshot({});
  writeFileSync(screenshotPath, screenshot);
  const viewportProbe = inspectScreenshot ? inspectScreenshot(screenshotPath) : undefined;

  if (inspectScreenshot && !contentfulOriginalProbeResult(viewportProbe)) {
    return undefined;
  }

  if (!cropViewportScreenshotToClip(screenshotPath, screenshotPath, activeClip, viewport, viewportProbe)) {
    return undefined;
  }

  const probe = inspectScreenshot ? inspectScreenshot(screenshotPath) : undefined;
  if (inspectScreenshot && !contentfulOriginalProbeResult(probe)) {
    return undefined;
  }

  return {
    mode: "article_clip",
    captureMethod: "viewport_crop",
    clip: activeClip,
    probe,
  };
}

async function waitForScreenshotPaint(tab, sampleOrPostId, clip, attempt) {
  await tab.playwright.waitForLoadState({ state: "domcontentloaded", timeoutMs: 5_000 }).catch(() => {});

  const foundArticle = await tab.playwright
    .evaluate(async (target) => {
      const normalize = (value) =>
        String(value ?? "")
          .replace(/https?:\/\/\S+/g, "")
          .replace(/\s+/g, " ")
          .trim()
          .toLowerCase();
      const fullFingerprint = normalize(target.textStart);
      const fingerprint = fullFingerprint.slice(0, 72);
      const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
      const findArticle = () => Array.from(document.querySelectorAll('article[data-testid="tweet"]')).find((candidate) => {
        const hasStatusLink = Array.from(candidate.querySelectorAll("a[href]")).some((link) =>
          String(link.getAttribute("href") ?? "").includes(`/status/${target.postId}`),
        );

        if (hasStatusLink) {
          return true;
        }

        if (fingerprint.length >= 24 && normalize(candidate.innerText).includes(fingerprint)) {
          return true;
        }

        const terms = fullFingerprint.split(" ").filter((term) => term.length > 4).slice(0, 8);
        return terms.length >= 3 && terms.every((term) => normalize(candidate.innerText).includes(term));
      });
      let article = findArticle();

      if (!article) {
        window.scrollTo(0, 0);
        await wait(450);
        article = findArticle();
      }

      if (!article) {
        return false;
      }

      article.scrollIntoView({ block: "start", inline: "nearest" });
      await wait(80);
      window.scrollBy(0, 1);
      window.scrollBy(0, -1);
      await wait(160);
      return true;
    }, originalCaptureTarget(sampleOrPostId))
    .catch(() => false);

  if (clip && tab.cua?.move) {
    const x = Math.max(1, Math.round(clip.x + Math.min(clip.width - 1, Math.max(1, clip.width / 2))));
    const y = Math.max(1, Math.round(clip.y + Math.min(clip.height - 1, Math.max(1, clip.height / 3))));
    await tab.cua.move({ x, y }).catch(() => {});
  }

  await tab.playwright.waitForTimeout(350 + attempt * 250);
  return foundArticle;
}

export async function captureWithProbe(tab, screenshotPath, inspectScreenshot, clip, sampleOrPostId) {
  const modes = clip ? ["article_clip"] : ["viewport"];

  for (const mode of modes) {
    const options = mode === "article_clip" ? { clip } : {};

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const foundArticle = await waitForScreenshotPaint(tab, sampleOrPostId, clip, attempt);
      const activeClip =
        mode === "article_clip"
          ? (await originalArticleClip(tab, sampleOrPostId).catch(() => undefined)) ?? (foundArticle === false ? undefined : clip)
          : undefined;

      if (mode === "article_clip" && !activeClip) {
        await tab.playwright.waitForTimeout(900 * attempt);
        continue;
      }

      const screenshotOptions = mode === "article_clip" ? { clip: activeClip } : options;
      const screenshot = await tab.screenshot(screenshotOptions);
      writeFileSync(screenshotPath, screenshot);
      const probe = inspectScreenshot ? inspectScreenshot(screenshotPath) : undefined;

      if (!inspectScreenshot || (contentfulOriginalProbeResult(probe) && originalProbeMatchesCssClip(probe, activeClip ?? clip))) {
        return {
          mode,
          captureMethod: mode === "article_clip" ? "direct_clip" : undefined,
          clip: activeClip,
          probe,
        };
      }

      if (mode === "article_clip" && contentfulOriginalProbeResult(probe) && !originalProbeMatchesCssClip(probe, activeClip ?? clip)) {
        break;
      }

      await tab.playwright.waitForTimeout(900 * attempt);
    }
  }

  if (clip) {
    const cropped = await captureArticleClipFromViewport(tab, screenshotPath, inspectScreenshot, clip, sampleOrPostId);
    if (cropped) {
      return cropped;
    }
  }

  const screenshot = await tab.screenshot({});
  writeFileSync(screenshotPath, screenshot);
    return {
      mode: clip ? "viewport_after_blank_clip" : "viewport",
      captureMethod: "viewport",
      clip,
      probe: inspectScreenshot ? inspectScreenshot(screenshotPath) : undefined,
    };
  }

async function captureOriginalEvidenceEntry({ browser, sample, index, batchLength, captureDir, inspectScreenshot, timeoutMs, maxCaptureAttempts }) {
  const postId = String(sample.postId);
  const slug = `${String(index + 1).padStart(3, "0")}-${sanitizeOriginalCaptureSlug(originalCaptureAuthorSlug(sample))}-${postId}`;
  const screenshotPath = join(captureDir, `${slug}-original.png`);
  let lastEntry;

  for (let captureAttempt = 1; captureAttempt <= maxCaptureAttempts; captureAttempt += 1) {
    const tab = await browser.tabs.new();

    try {
      await tab.goto(sample.url);
      await revealXOriginalInterstitials(tab);
      await waitForXOriginalArticle(tab, sample, timeoutMs);
      await revealXOriginalInterstitials(tab);
      await waitForXOriginalMedia(tab, sample);
      const evidence = await readXOriginalArticleEvidence(tab, sample);
      const clip = evidence.found ? evidence.clip : await originalArticleClip(tab, sample);
      const initialFacts = evidence.found ? evidence.facts : await collectXOriginalFacts(tab, sample);
      await revealXOriginalInterstitials(tab);
      const screenshotResult = await captureWithProbe(tab, screenshotPath, inspectScreenshot, clip, sample);
      const postCaptureEvidence = await readXOriginalArticleEvidence(tab, sample);
      const facts = postCaptureEvidence.found
        ? postCaptureEvidence.facts
        : {
            ...(initialFacts ?? {}),
            foundExactArticle: false,
          };
      const screenshotMode = screenshotResult.mode;
      const captureMethod = screenshotResult.captureMethod;
      const screenshotClip = screenshotResult.clip ?? clip;
      const probe = screenshotResult.probe;
      const screenshotQuality = buildOriginalScreenshotQuality({ screenshotMode, captureMethod, clip: screenshotClip, facts, probe });
      const validationErrors = originalValidationErrors(facts, probe, screenshotQuality);

      lastEntry = {
        id: postId,
        index: sample.index,
        label: sample.buckets?.join(",") || "inventory",
        url: sample.url,
        screenshot: screenshotPath,
        screenshotMode,
        captureMethod,
        screenshotQuality,
        probe,
        facts,
        captureAttempt,
      };

      if (!validationErrors.length) {
        return lastEntry;
      }

      lastEntry.error = validationErrors.join(", ");

      if (captureAttempt < maxCaptureAttempts && retryableOriginalCaptureErrors(validationErrors)) {
        console.warn(`${index + 1}/${batchLength} retry ${postId}: ${lastEntry.error}`);
        continue;
      }

      return lastEntry;
    } catch (error) {
      lastEntry = {
        id: postId,
        index: sample.index,
        url: sample.url,
        screenshot: screenshotPath,
        captureAttempt,
        error: error instanceof Error ? error.message : String(error),
      };

      if (captureAttempt < maxCaptureAttempts && retryableOriginalCaptureErrors([], error)) {
        console.warn(`${index + 1}/${batchLength} retry ${postId}: ${lastEntry.error}`);
        continue;
      }

      return lastEntry;
    } finally {
      await tab.close().catch(() => {});
    }
  }

  return lastEntry;
}

export async function captureOriginalEvidenceBatch({
  browser,
  batchPath,
  outputDir,
  inspectScreenshot,
  limit,
  timeoutMs = 45_000,
  maxCaptureAttempts = Number(process.env.DISPLAY_ORIGINAL_CAPTURE_ATTEMPTS || 3),
}) {
  if (!browser) {
    throw new Error("captureOriginalEvidenceBatch needs a connected Chrome browser runtime.");
  }

  const batch = loadOriginalCaptureBatch(batchPath).slice(0, limit ?? undefined);
  const captureDir = outputDir || `.data/display-original-evidence/chrome-capture-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const captureAttempts = Number.isFinite(maxCaptureAttempts) && maxCaptureAttempts > 0 ? Math.floor(maxCaptureAttempts) : 3;
  mkdirSync(captureDir, { recursive: true });
  const entries = [];

  for (const [index, sample] of batch.entries()) {
    const entry = await captureOriginalEvidenceEntry({
      browser,
      sample,
      index,
      batchLength: batch.length,
      captureDir,
      inspectScreenshot,
      timeoutMs,
      maxCaptureAttempts: captureAttempts,
    });

    entries.push(entry);

    if (entry.error) {
      console.warn(`${index + 1}/${batch.length} invalid ${entry.id}: ${entry.error}`);
    } else {
      console.log(`${index + 1}/${batch.length} captured ${entry.id}`);
    }
  }

  const resultPath = join(captureDir, "original-chrome-results.json");
  writeFileSync(resultPath, JSON.stringify(entries, null, 2), "utf8");
  return {
    outputDir: captureDir,
    resultPath,
    entries,
  };
}
