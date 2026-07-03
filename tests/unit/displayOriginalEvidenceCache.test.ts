import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  mergeOriginalEvidenceEntries,
  normalizeOriginalEvidenceDocument,
  originalEvidenceCoverage,
  validOriginalEvidenceEntry,
} from "../../scripts/display-evidence-core.mjs";
import {
  buildOriginalEvidenceCacheReport,
  compactOriginalEvidenceSample,
  markdownOriginalEvidenceCacheReport,
  originalEvidenceNextCaptureBatch,
} from "../../scripts/display-original-evidence-cache-core.mjs";

const tempDir = mkdtempSync(join(tmpdir(), "xpulse-original-evidence-cache-test-"));
const screenshot = join(tempDir, "original.png");
writeFileSync(screenshot, "screenshot placeholder", "utf8");

const contentfulProbe = {
  blank: false,
  reason: "contentful",
};

function evidence(id: string, overrides = {}) {
  return {
    id,
    screenshot,
    probe: contentfulProbe,
    facts: {
      foundExactArticle: true,
    },
    ...overrides,
  };
}

test("normalizes array and store-shaped Original evidence documents", () => {
  assert.deepEqual(normalizeOriginalEvidenceDocument([evidence("1")]).map((item) => item.id), ["1"]);
  assert.deepEqual(normalizeOriginalEvidenceDocument({ entries: [evidence("2")] }).map((item) => item.id), ["2"]);
});

test("Original evidence cache core compacts owner-readable samples", () => {
  assert.deepEqual(
    compactOriginalEvidenceSample({
      index: 7,
      postId: "123",
      url: "https://x.com/example/status/123",
      author: {
        username: "example",
      },
      buckets: ["video"],
      risks: ["autoplay"],
      missingData: ["card"],
      textStart: "hello",
      ignoredLargeField: "not persisted",
    }),
    {
      index: 7,
      postId: "123",
      url: "https://x.com/example/status/123",
      author: "@example",
      buckets: ["video"],
      risks: ["autoplay"],
      missingData: ["card"],
      textStart: "hello",
    },
  );
});

test("Original evidence cache core plans invalid evidence before missing evidence", () => {
  const nextBatch = originalEvidenceNextCaptureBatch(
    {
      covered: [{ sample: { postId: "covered" }, entry: evidence("covered") }],
      invalid: [
        {
          sample: { index: 1, postId: "invalid", url: "https://x.com/a/status/1" },
          entry: evidence("invalid"),
          issues: ["screenshot_blank:mostly_white"],
        },
      ],
      missing: [
        { index: 2, postId: "missing-a", url: "https://x.com/a/status/2" },
        { index: 3, postId: "missing-b", url: "https://x.com/a/status/3" },
      ],
    },
    2,
  );

  assert.deepEqual(
    nextBatch.map((sample) => sample.postId),
    ["invalid", "missing-a"],
  );
});

test("Original evidence cache core builds stable JSON and Markdown reports", () => {
  const report = buildOriginalEvidenceCacheReport({
    createdAt: "2026-07-03T00:00:00.000Z",
    inventoryReportPath: ".data/display-gap-inventory/report.json",
    storePath: ".data/display-original-evidence/original-evidence-store.json",
    importedPath: "capture/original-chrome-results.json",
    importedCount: 2,
    assetReport: {
      persistedExternalScreenshots: 1,
      repairedMissingScreenshots: 0,
      unresolvedMissingScreenshots: 0,
      ambiguousMissingScreenshots: 0,
    },
    inventorySampleCount: 3,
    coverage: {
      covered: [{ sample: { postId: "1" }, entry: evidence("1") }],
      invalid: [
        {
          sample: { index: 2, postId: "2", url: "https://x.com/a/status/2" },
          entryId: "2",
          issues: ["missing_facts"],
        },
      ],
      missing: [{ index: 3, postId: "3", url: "https://x.com/a/status/3" }],
    },
    nextBatch: [{ index: 2, postId: "2", url: "https://x.com/a/status/2" }],
    resolvePath: (value) => `/abs/${value}`,
  });

  assert.equal(report.coveredCount, 1);
  assert.equal(report.invalidCount, 1);
  assert.equal(report.missingCount, 1);
  assert.equal(report.importedPath, "/abs/capture/original-chrome-results.json");
  assert.deepEqual(report.invalid[0], {
    sample: {
      index: 2,
      postId: "2",
      url: "https://x.com/a/status/2",
      author: undefined,
      buckets: [],
      risks: [],
      missingData: [],
      textStart: undefined,
    },
    issues: ["missing_facts"],
    entryId: "2",
  });

  const markdown = markdownOriginalEvidenceCacheReport(report);
  assert.match(markdown, /# Original Rendering Evidence/);
  assert.match(markdown, /Cached valid samples: 1/);
  assert.match(markdown, /\| 2 \| \[2\]\(https:\/\/x.com\/a\/status\/2\)/);
  assert.match(markdown, /Invalid Cached Evidence/);
  assert.match(markdown, /missing_facts/);
});

test("validOriginalEvidenceEntry requires screenshot, contentful probe, and facts", () => {
  assert.equal(validOriginalEvidenceEntry(evidence("1")).valid, true);

  const invalid = validOriginalEvidenceEntry(
    evidence("2", {
      probe: {
        blank: true,
        reason: "mostly_white",
      },
      facts: undefined,
    }),
  );

  assert.equal(invalid.valid, false);
  assert.ok(invalid.issues.includes("screenshot_blank:mostly_white"));
  assert.ok(invalid.issues.includes("missing_facts"));
});

test("validOriginalEvidenceEntry rejects non-target Original screenshot captures", () => {
  const invalid = validOriginalEvidenceEntry(
    evidence("1", {
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
      },
    }),
  );

  assert.equal(invalid.valid, false);
  assert.ok(invalid.issues.includes("original_screenshot_not_target_article:viewport_after_blank_clip"));
});

test("validOriginalEvidenceEntry rejects article clips without capture method metadata", () => {
  const invalid = validOriginalEvidenceEntry(
    evidence("1", {
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
      },
    }),
  );

  assert.equal(invalid.valid, false);
  assert.ok(invalid.issues.includes("original_screenshot_missing_capture_method"));
});

test("validOriginalEvidenceEntry rejects article clips wider than the target article", () => {
  const invalid = validOriginalEvidenceEntry(
    evidence("1", {
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
      },
      screenshotQuality: {
        mode: "article_clip",
        articleRect: {
          x: 843,
          y: 0,
          width: 599,
          height: 900,
        },
        clip: {
          x: 843,
          y: 0,
          width: 599,
          height: 900,
        },
      },
    }),
  );

  assert.equal(invalid.valid, false);
  assert.ok(invalid.issues.includes("original_screenshot_probe_width_mismatch"));
});

test("validOriginalEvidenceEntry rejects old wide article clips without clip metadata", () => {
  const invalid = validOriginalEvidenceEntry(
    evidence("1", {
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
      },
    }),
  );

  assert.equal(invalid.valid, false);
  assert.ok(invalid.issues.includes("original_screenshot_probe_width_mismatch"));
});

test("validOriginalEvidenceEntry accepts viewport-cropped article evidence at image pixel width", () => {
  const valid = validOriginalEvidenceEntry(
    evidence("1", {
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
      },
      screenshotQuality: {
        mode: "article_clip",
        captureMethod: "viewport_crop",
        articleRect: {
          x: 843,
          y: 0,
          width: 599,
          height: 900,
        },
        clip: {
          x: 843,
          y: 0,
          width: 599,
          height: 900,
        },
      },
    }),
  );

  assert.equal(valid.valid, true);
});

test("validOriginalEvidenceEntry rejects likely Original interstitial screenshots", () => {
  const invalid = validOriginalEvidenceEntry(
    evidence("1", {
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
      },
    }),
  );

  assert.equal(invalid.valid, false);
  assert.ok(invalid.issues.includes("original_screenshot_likely_interstitial"));
});

test("mergeOriginalEvidenceEntries replaces older entries by post id", () => {
  const merged = mergeOriginalEvidenceEntries([evidence("1", { label: "old" })], [evidence("1", { label: "new" }), evidence("2")], "now");

  assert.deepEqual(
    merged.map((entry) => [entry.id, entry.label, entry.importedAt]),
    [
      ["1", "new", "now"],
      ["2", undefined, "now"],
    ],
  );
});

test("originalEvidenceCoverage separates covered, invalid, and missing inventory samples", () => {
  const coverage = originalEvidenceCoverage(
    [
      { postId: "1" },
      { postId: "2" },
      { postId: "3" },
    ],
    [
      evidence("1"),
      evidence("2", {
        screenshot: join(tempDir, "missing.png"),
      }),
    ],
  );

  assert.deepEqual(coverage.covered.map((item) => item.sample.postId), ["1"]);
  assert.deepEqual(coverage.invalid.map((item) => item.sample.postId), ["2"]);
  assert.deepEqual(coverage.missing.map((item) => item.postId), ["3"]);
});
