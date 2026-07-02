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
