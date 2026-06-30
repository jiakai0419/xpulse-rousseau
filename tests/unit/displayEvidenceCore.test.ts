import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  contentfulScreenshotProbe,
  evidencePostId,
  localEvidenceIssues,
  normalizeOriginalEvidenceDocument,
  oracleOriginalEvidenceIssues,
  originalEvidenceById,
  originalEvidenceValidationIssues,
} from "../../scripts/display-evidence-core.mjs";

const tempDir = mkdtempSync(join(tmpdir(), "xpulse-display-evidence-core-test-"));
const screenshot = join(tempDir, "shot.png");
writeFileSync(screenshot, "screenshot placeholder", "utf8");

const contentfulProbe = {
  blank: false,
  reason: "contentful",
};

test("display evidence core normalizes ids and Original evidence documents", () => {
  assert.equal(evidencePostId({ id: "1" }), "1");
  assert.equal(evidencePostId({ postId: "2" }), "2");
  assert.equal(evidencePostId({ displayPost: { id: "3" } }), "3");

  assert.deepEqual(normalizeOriginalEvidenceDocument([{ id: "1" }]).map((entry) => entry.id), ["1"]);
  assert.deepEqual(normalizeOriginalEvidenceDocument({ entries: [{ id: "2" }] }).map((entry) => entry.id), ["2"]);
  assert.deepEqual(normalizeOriginalEvidenceDocument({ originalEntries: [{ id: "3" }] }).map((entry) => entry.id), ["3"]);
  assert.deepEqual(normalizeOriginalEvidenceDocument({ unknown: [] }), []);

  assert.equal(originalEvidenceById([{ id: "1" }, { postId: "2" }]).get("2")?.postId, "2");
});

test("display evidence core checks contentful probes explicitly", () => {
  assert.equal(contentfulScreenshotProbe(contentfulProbe), true);
  assert.equal(contentfulScreenshotProbe({ blank: true, reason: "mostly_white" }), false);
  assert.equal(contentfulScreenshotProbe({ blank: false, reason: "probe_failed:decode" }), false);
});

test("display evidence core reports mandatory local evidence issues", () => {
  assert.deepEqual(
    localEvidenceIssues({
      localScreenshot: screenshot,
      localScreenshotProbe: contentfulProbe,
      localFacts: {},
    }),
    [],
  );

  assert.deepEqual(localEvidenceIssues({}), ["missing_local_screenshot", "missing_local_screenshot_probe", "missing_local_facts"]);
});

test("display evidence core keeps Oracle and cache Original issue names distinct", () => {
  const validOriginal = {
    id: "1",
    screenshot,
    probe: contentfulProbe,
    facts: {
      foundExactArticle: true,
    },
  };

  assert.deepEqual(oracleOriginalEvidenceIssues(validOriginal), []);
  assert.deepEqual(originalEvidenceValidationIssues(validOriginal), []);

  const blankOriginal = {
    id: "2",
    screenshot,
    probe: {
      blank: true,
      reason: "mostly_white",
    },
  };

  assert.deepEqual(oracleOriginalEvidenceIssues(blankOriginal), ["original_screenshot_blank:mostly_white", "missing_original_facts"]);
  assert.deepEqual(originalEvidenceValidationIssues(blankOriginal), ["screenshot_blank:mostly_white", "missing_facts"]);
});
