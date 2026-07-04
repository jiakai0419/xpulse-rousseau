import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  contentfulOriginalProbeResult,
  originalCaptureAuthorSlug,
  originalCaptureTarget,
  originalProbeMatchesCssClip,
  originalValidationErrors,
  retryableOriginalCaptureErrors,
  sanitizeOriginalCaptureSlug,
  scaleClipForScreenshot,
} from "../../scripts/display-original-capture-core.mjs";
import {
  captureWithProbe,
} from "../../scripts/display-original-evidence-chrome-capture.mjs";

test("Original capture core normalizes targets and screenshot file slugs", () => {
  assert.deepEqual(originalCaptureTarget("2062933748585283776"), {
    postId: "2062933748585283776",
    textStart: "",
  });
  assert.deepEqual(originalCaptureTarget({ postId: 123, textStart: "A real X-derived post" }), {
    postId: "123",
    textStart: "A real X-derived post",
  });
  assert.deepEqual(originalCaptureTarget({ id: 456 }), {
    postId: "456",
    textStart: "",
  });

  assert.equal(originalCaptureAuthorSlug({ author: { username: "alice" } }), "alice");
  assert.equal(originalCaptureAuthorSlug({ author: { name: "Alice Example" } }), "Alice Example");
  assert.equal(sanitizeOriginalCaptureSlug("@Alice Example / Research!"), "Alice-Example-Research");
  assert.equal(sanitizeOriginalCaptureSlug(""), "unknown");
});

test("Original capture core classifies contentful probes and clip width matches", () => {
  assert.equal(contentfulOriginalProbeResult({ blank: false, reason: "contentful" }), true);
  assert.equal(contentfulOriginalProbeResult({ blank: true, reason: "mostly_white" }), false);
  assert.equal(contentfulOriginalProbeResult({ blank: false, reason: "probe_failed:png" }), false);

  assert.equal(originalProbeMatchesCssClip({ width: 600 }, { width: 650 }), true);
  assert.equal(originalProbeMatchesCssClip({ width: 600 }, { width: 720 }), false);
  assert.equal(originalProbeMatchesCssClip({ width: 0 }, { width: 720 }), true);
  assert.equal(originalProbeMatchesCssClip({ width: 600 }, undefined), true);
});

test("Original capture core validates missing article and low-quality screenshots", () => {
  assert.deepEqual(
    originalValidationErrors(
      { foundExactArticle: false },
      { blank: true, reason: "mostly_white" },
      { mode: "article_clip", captureMethod: "direct_clip" },
    ),
    ["original_exact_article_not_found", "original_screenshot_blank:mostly_white"],
  );

  assert.deepEqual(
    originalValidationErrors(
      {
        foundExactArticle: true,
        articleRect: { x: 0, width: 600 },
      },
      {
        blank: false,
        reason: "contentful",
        width: 1200,
        height: 800,
        whiteRatio: 0.4,
        darkRatio: 0.1,
        variance: 200,
      },
      {
        mode: "viewport_after_blank_clip",
        captureMethod: "viewport",
        clip: { x: 0, width: 600 },
      },
    ),
    ["original_screenshot_not_target_article:viewport_after_blank_clip"],
  );
});

test("captureWithProbe retries blank screenshots until a contentful capture is available", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "xpulse-original-capture-test-"));
  const screenshotPath = join(tempDir, "original.png");
  const screenshotCalls: Array<Record<string, unknown>> = [];
  const moves: Array<Record<string, number>> = [];

  const tab = {
    screenshot: async (options = {}) => {
      screenshotCalls.push(options);
      return Buffer.from(`screenshot-${screenshotCalls.length}`);
    },
    cua: {
      move: async (point: Record<string, number>) => {
        moves.push(point);
      },
    },
    playwright: {
      evaluate: async () => undefined,
      waitForLoadState: async () => undefined,
      waitForTimeout: async () => undefined,
    },
  };

  const result = await captureWithProbe(
    tab,
    screenshotPath,
    () =>
      screenshotCalls.length < 3
        ? {
            blank: true,
            reason: "mostly_white",
          }
        : {
            blank: false,
            reason: "contentful",
          },
    {
      x: 10,
      y: 20,
      width: 100,
      height: 120,
    },
    {
      postId: "post-1",
      textStart: "A real X-derived post",
    },
  );

  assert.equal(result.mode, "article_clip");
  assert.equal(result.probe.blank, false);
  assert.equal(screenshotCalls.length, 3);
  assert.deepEqual(screenshotCalls[0], {
    clip: {
      x: 10,
      y: 20,
      width: 100,
      height: 120,
    },
  });
  assert.ok(moves.length >= 1);
});

test("retryableOriginalCaptureErrors treats low-quality screenshots as retryable", () => {
  assert.equal(retryableOriginalCaptureErrors(["original_screenshot_not_target_article:viewport_after_blank_clip"], undefined), true);
  assert.equal(retryableOriginalCaptureErrors(["original_screenshot_likely_viewport_capture"], undefined), true);
  assert.equal(retryableOriginalCaptureErrors(["original_screenshot_probe_width_mismatch"], undefined), true);
  assert.equal(retryableOriginalCaptureErrors(["original_screenshot_likely_interstitial"], undefined), true);
  assert.equal(retryableOriginalCaptureErrors(["original_exact_article_not_found"], undefined), false);
  assert.equal(retryableOriginalCaptureErrors([], new Error("original_requires_auth")), false);
});

test("scaleClipForScreenshot maps CSS clip coordinates to screenshot pixels", () => {
  assert.deepEqual(
    scaleClipForScreenshot(
      {
        x: 843.1,
        y: 0,
        width: 598.8,
        height: 884.6,
      },
      {
        width: 2400,
        height: 1128,
      },
      {
        width: 2400,
        height: 1128,
      },
    ),
    {
      x: 843,
      y: 0,
      width: 599,
      height: 885,
    },
  );

  assert.deepEqual(
    scaleClipForScreenshot(
      {
        x: 10,
        y: 20,
        width: 100,
        height: 120,
      },
      {
        width: 200,
        height: 200,
      },
      {
        width: 400,
        height: 400,
      },
    ),
    {
      x: 20,
      y: 40,
      width: 200,
      height: 240,
    },
  );
});
