import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { normalizeOriginalEvidenceScreenshotAssets } from "../../scripts/display-evidence-assets.mjs";

const tempDir = mkdtempSync(join(tmpdir(), "xpulse-display-evidence-assets-test-"));

function evidence(id: string, screenshot: string) {
  return {
    id,
    screenshot,
    probe: {
      blank: false,
      reason: "contentful",
    },
    facts: {
      foundExactArticle: true,
    },
  };
}

test("Original evidence asset normalization persists screenshots imported from outside evidence storage", () => {
  const evidenceRoot = join(tempDir, "evidence-root");
  const assetDir = join(evidenceRoot, "original-screenshots");
  const externalDir = join(tempDir, "external");
  mkdirSync(externalDir, { recursive: true });

  const externalScreenshot = join(externalDir, "001-author-123-original.png");
  writeFileSync(externalScreenshot, "external screenshot", "utf8");

  const result = normalizeOriginalEvidenceScreenshotAssets([evidence("123", externalScreenshot)], {
    evidenceRoot,
    screenshotAssetDir: assetDir,
    updatedAt: "now",
  });

  assert.equal(result.report.persistedExternalScreenshots, 1);
  assert.equal(result.entries[0].screenshot, join(assetDir, "001-author-123-original.png"));
  assert.equal(result.entries[0].screenshotOriginalPath, externalScreenshot);
  assert.equal(result.entries[0].screenshotPersistedAt, "now");
  assert.equal(existsSync(result.entries[0].screenshot), true);
});

test("Original evidence asset normalization repairs a missing screenshot only with a unique durable match", () => {
  const evidenceRoot = join(tempDir, "repair-root");
  const captureDir = join(evidenceRoot, "chrome-capture");
  mkdirSync(captureDir, { recursive: true });

  const durableScreenshot = join(captureDir, "001-author-456-original.png");
  writeFileSync(durableScreenshot, "durable screenshot", "utf8");

  const result = normalizeOriginalEvidenceScreenshotAssets([evidence("456", join(tempDir, "gone.png"))], {
    evidenceRoot,
    screenshotAssetDir: join(evidenceRoot, "original-screenshots"),
    updatedAt: "repair-time",
  });

  assert.equal(result.report.repairedMissingScreenshots, 1);
  assert.equal(result.entries[0].screenshot, durableScreenshot);
  assert.equal(result.entries[0].screenshotOriginalPath, join(tempDir, "gone.png"));
  assert.equal(result.entries[0].screenshotRepairedAt, "repair-time");
});

test("Original evidence asset normalization leaves ambiguous missing screenshots unresolved", () => {
  const evidenceRoot = join(tempDir, "ambiguous-root");
  mkdirSync(join(evidenceRoot, "a"), { recursive: true });
  mkdirSync(join(evidenceRoot, "b"), { recursive: true });
  writeFileSync(join(evidenceRoot, "a", "001-author-789-original.png"), "a", "utf8");
  writeFileSync(join(evidenceRoot, "b", "002-author-789-original.png"), "b", "utf8");

  const missingScreenshot = join(tempDir, "still-gone.png");
  const result = normalizeOriginalEvidenceScreenshotAssets([evidence("789", missingScreenshot)], {
    evidenceRoot,
    screenshotAssetDir: join(evidenceRoot, "original-screenshots"),
  });

  assert.equal(result.report.ambiguousMissingScreenshots, 1);
  assert.equal(result.entries[0].screenshot, missingScreenshot);
});
