import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  captureWithProbe,
  retryableOriginalCaptureErrors,
  scaleClipForScreenshot,
} from "../../scripts/display-original-evidence-chrome-capture.mjs";

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
