import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { displayOracleFailureIssues, evaluateDisplayOracleSample } from "../../scripts/display-oracle-core.mjs";

const tempDir = mkdtempSync(join(tmpdir(), "xpulse-display-oracle-test-"));
const localScreenshot = join(tempDir, "local.png");
const originalScreenshot = join(tempDir, "original.png");
writeFileSync(localScreenshot, "local screenshot placeholder", "utf8");
writeFileSync(originalScreenshot, "original screenshot placeholder", "utf8");

const contentfulProbe = {
  blank: false,
  reason: "contentful",
  width: 600,
  height: 400,
};

function sample(overrides = {}) {
  return {
    postId: "post-1",
    localScreenshot,
    localScreenshotProbe: contentfulProbe,
    localFacts: {
      inlineLinks: [],
      linkCards: [],
      linkChips: [],
      mediaGrids: [],
      quoteCards: [],
      videos: [],
    },
    flags: {},
    risks: [],
    missingData: [],
    ...overrides,
  };
}

function original(overrides = {}) {
  return {
    id: "post-1",
    screenshot: originalScreenshot,
    probe: contentfulProbe,
    facts: {
      foundExactArticle: true,
      media: [],
      textStart: "Original X post",
    },
    ...overrides,
  };
}

test("Display Oracle blocks samples without mandatory Original evidence", () => {
  const result = evaluateDisplayOracleSample(sample(), undefined);

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blocked, ["missing_original_evidence"]);
});

test("Display Oracle blocks samples without mandatory local evidence", () => {
  const result = evaluateDisplayOracleSample(
    {
      postId: "post-1",
      localFacts: undefined,
      localScreenshot: undefined,
      localScreenshotProbe: undefined,
    },
    original(),
  );

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blocked, ["missing_local_screenshot", "missing_local_screenshot_probe", "missing_local_facts"]);
  assert.deepEqual(result.factDiffs, []);
});

test("Display Oracle treats blank Original screenshots as an audit failure", () => {
  const result = evaluateDisplayOracleSample(
    sample(),
    original({
      probe: {
        blank: true,
        reason: "mostly_white",
      },
    }),
  );

  assert.equal(result.status, "blocked");
  assert.ok(result.blocked.includes("original_screenshot_blank:mostly_white"));
});

test("Display Oracle blocks Original screenshots that were captured as a viewport fallback", () => {
  const result = evaluateDisplayOracleSample(
    sample(),
    original({
      screenshotMode: "viewport_after_blank_clip",
      probe: {
        blank: false,
        reason: "contentful",
        width: 3000,
        height: 1463,
      },
      facts: {
        foundExactArticle: true,
        articleRect: {
          x: 843,
          y: 53,
          width: 599,
          height: 529,
        },
        media: [],
        textStart: "Original X post",
      },
    }),
  );

  assert.equal(result.status, "blocked");
  assert.ok(result.blocked.includes("original_screenshot_not_target_article:viewport_after_blank_clip"));
});

test("Display Oracle blocks article clips without capture method metadata", () => {
  const result = evaluateDisplayOracleSample(
    sample(),
    original({
      screenshotMode: "article_clip",
      probe: {
        blank: false,
        reason: "contentful",
        width: 599,
        height: 900,
      },
      facts: {
        foundExactArticle: true,
        articleRect: {
          x: 843,
          y: 0,
          width: 599,
          height: 900,
        },
        media: [],
        textStart: "Original X post",
      },
    }),
  );

  assert.equal(result.status, "blocked");
  assert.ok(result.blocked.includes("original_screenshot_missing_capture_method"));
});

test("Display Oracle blocks article clips wider than the Original article", () => {
  const result = evaluateDisplayOracleSample(
    sample(),
    original({
      screenshotMode: "article_clip",
      probe: {
        blank: false,
        reason: "contentful",
        width: 749,
        height: 900,
      },
      facts: {
        foundExactArticle: true,
        articleRect: {
          x: 843,
          y: 0,
          width: 599,
          height: 900,
        },
        media: [],
        textStart: "Original X post",
      },
      screenshotQuality: {
        mode: "article_clip",
        clip: {
          x: 843,
          y: 0,
          width: 599,
          height: 900,
        },
        articleRect: {
          x: 843,
          y: 0,
          width: 599,
          height: 900,
        },
      },
    }),
  );

  assert.equal(result.status, "blocked");
  assert.ok(result.blocked.includes("original_screenshot_probe_width_mismatch"));
});

test("Display Oracle accepts viewport-cropped article screenshots with image-pixel width", () => {
  const result = evaluateDisplayOracleSample(
    sample(),
    original({
      screenshotMode: "article_clip",
      captureMethod: "viewport_crop",
      probe: {
        blank: false,
        reason: "contentful",
        width: 749,
        height: 900,
      },
      facts: {
        foundExactArticle: true,
        articleRect: {
          x: 843,
          y: 0,
          width: 599,
          height: 900,
        },
        media: [],
        textStart: "Original X post",
      },
      screenshotQuality: {
        mode: "article_clip",
        captureMethod: "viewport_crop",
        clip: {
          x: 843,
          y: 0,
          width: 599,
          height: 900,
        },
        articleRect: {
          x: 843,
          y: 0,
          width: 599,
          height: 900,
        },
      },
    }),
  );

  assert.equal(result.status, "passed");
});

test("Display Oracle blocks likely Original interstitial screenshots", () => {
  const result = evaluateDisplayOracleSample(
    sample(),
    original({
      screenshotMode: "article_clip",
      captureMethod: "viewport_crop",
      probe: {
        blank: false,
        reason: "contentful",
        width: 599,
        height: 1170,
        whiteRatio: 0.9963,
        darkRatio: 0,
        variance: 28.3,
      },
      facts: {
        foundExactArticle: true,
        articleRect: {
          x: 843,
          y: 0,
          width: 599,
          height: 1170,
        },
        media: [],
        textStart: "Original X post",
      },
    }),
  );

  assert.equal(result.status, "blocked");
  assert.ok(result.blocked.includes("original_screenshot_likely_interstitial"));
});

test("Display Oracle detects X Article rich-card diffs even when a rule is missing", () => {
  const result = evaluateDisplayOracleSample(
    sample({
      risks: ["quote_x_article_card_likely", "quote_x_article_link"],
      missingData: ["quoted_x_article_preview_metadata"],
      localFacts: {
        inlineLinks: [],
        linkCards: [],
        linkChips: [],
        mediaGrids: [{ mediaItems: 1 }],
        quoteCards: [{ text: "Ryan Zhu @ryanzhuuuu x.com/i/article/2064..." }],
        videos: [],
      },
    }),
    original({
      facts: {
        foundExactArticle: true,
        media: [{ tag: "img" }, { tag: "img" }],
        textStart: "Ryan Zhu\nQuote\nRyan Zhu\n·\n21h\n Article\nWe brought Hermes Agent to iMessage, even on Linux and Windows\nTLDR...",
      },
    }),
  );

  assert.equal(result.status, "failed");
  assert.deepEqual(result.factDiffs, ["original_has_x_article_card_local_has_placeholder"]);
  assert.deepEqual(result.explanations, [
    {
      diff: "original_has_x_article_card_local_has_placeholder",
      rule: "x_article_card_rendering",
    },
  ]);
});

test("Display Oracle detects main X Article links that Original expands into article content", () => {
  const result = evaluateDisplayOracleSample(
    sample({
      risks: ["main_x_article_link"],
      missingData: ["x_article_preview_metadata"],
      localFacts: {
        inlineLinks: [{ text: "x.com/i/article/2063...", href: "https://x.com/i/article/2063647807437705216" }],
        linkCards: [],
        linkChips: [],
        mediaGrids: [],
        quoteCards: [],
        videos: [],
      },
    }),
    original({
      facts: {
        foundExactArticle: true,
        media: [{ tag: "img" }],
        textStart: "Sebastian Raschka Do AGENTS.md Files Actually Help Coding Agents? Catching up with the agent-related research literature. ".repeat(
          4,
        ),
      },
    }),
  );

  assert.equal(result.status, "failed");
  assert.deepEqual(result.factDiffs, ["original_has_main_x_article_local_has_raw_link"]);
  assert.deepEqual(result.explanations, [
    {
      diff: "original_has_main_x_article_local_has_raw_link",
      rule: "x_article_card_rendering",
    },
  ]);
});

test("Display Oracle does not treat X Article preview-card hrefs as raw exposed links", () => {
  const result = evaluateDisplayOracleSample(
    sample({
      risks: ["main_x_article_link"],
      missingData: [],
      localFacts: {
        inlineLinks: [],
        linkCards: [
          {
            text: "x.com Do AGENTS.md Files Actually Help Coding Agents? Article summary",
            href: "https://x.com/i/article/2063647807437705216",
          },
        ],
        linkChips: [],
        mediaGrids: [],
        quoteCards: [],
        videos: [],
      },
    }),
    original({
      facts: {
        foundExactArticle: true,
        media: [{ tag: "img" }],
        textStart: "Sebastian Raschka Do AGENTS.md Files Actually Help Coding Agents? Catching up with the agent-related research literature. ".repeat(
          4,
        ),
      },
    }),
  );

  assert.equal(result.status, "passed");
  assert.deepEqual(result.factDiffs, []);
});

test("Display Oracle detects stacked local preview cards when Original renders one primary card", () => {
  const result = evaluateDisplayOracleSample(
    sample({
      flags: {
        externalPreviewLinks: 6,
      },
      localFacts: {
        inlineLinks: [],
        linkCards: [{ text: "One" }, { text: "Two" }, { text: "Three" }],
        linkChips: [],
        mediaGrids: [],
        quoteCards: [],
        videos: [],
      },
    }),
    original({
      facts: {
        foundExactArticle: true,
        media: [],
        cardWrappers: [
          {
            testId: "card.wrapper",
            text: "Primary card",
          },
          {
            testId: "card.layoutLarge.media",
            text: "Primary card",
          },
        ],
        textStart: "Original post with one primary preview card",
      },
    }),
  );

  assert.equal(result.status, "failed");
  assert.deepEqual(result.factDiffs, ["local_renders_multiple_external_preview_cards"]);
});

test("Display Oracle detects missing local preview cards when Original has an external card", () => {
  const result = evaluateDisplayOracleSample(
    sample({
      flags: {
        externalNoPreviewLinks: 1,
      },
      risks: ["external_link_without_preview_metadata"],
      localFacts: {
        inlineLinks: [{ text: "cnn.com/story", href: "https://www.cnn.com/story" }],
        linkCards: [],
        linkChips: [],
        mediaGrids: [],
        quoteCards: [],
        videos: [],
      },
    }),
    original({
      facts: {
        foundExactArticle: true,
        media: [],
        cardWrappers: [
          {
            testId: "card.wrapper",
            text: "The oceans are in deep trouble",
          },
        ],
        textStart: "Original post with a rich external card",
      },
    }),
  );

  assert.equal(result.status, "failed");
  assert.deepEqual(result.factDiffs, ["original_has_external_preview_local_missing_card"]);
});

test("Display Oracle passes when mandatory evidence is present and facts do not diverge", () => {
  const result = evaluateDisplayOracleSample(
    sample({
      localFacts: {
        inlineLinks: [],
        linkCards: [],
        linkChips: [],
        mediaGrids: [{ mediaItems: 1 }],
        quoteCards: [],
        videos: [{ autoplay: true, muted: true, paused: false, currentTime: 1.2 }],
      },
      flags: {
        mediaCount: 1,
        playableVideo: true,
      },
    }),
    original({
      facts: {
        foundExactArticle: true,
        media: [{ tag: "video", paused: false, currentTime: 2.3 }],
        textStart: "Video post",
      },
    }),
  );

  assert.equal(result.status, "passed");
  assert.deepEqual(result.factDiffs, []);
});

test("Display Oracle allowDiffs never allows blocked evidence to pass", () => {
  assert.deepEqual(displayOracleFailureIssues({ blockedCount: 1, failedCount: 0 }, { allowDiffs: true }), [
    {
      kind: "blocked",
      count: 1,
    },
  ]);
});

test("Display Oracle strict all-inventory mode fails on fact diffs even when allowDiffs is set", () => {
  assert.deepEqual(
    displayOracleFailureIssues(
      {
        blockedCount: 0,
        failedCount: 2,
      },
      {
        allowDiffs: true,
        requireAllInventorySamples: true,
      },
    ),
    [
      {
        kind: "failed",
        count: 2,
      },
    ],
  );
});

test("Display Oracle allowDiffs can collect non-strict fact diffs without failing", () => {
  assert.deepEqual(
    displayOracleFailureIssues(
      {
        blockedCount: 0,
        failedCount: 2,
      },
      {
        allowDiffs: true,
        requireAllInventorySamples: false,
      },
    ),
    [],
  );
});
