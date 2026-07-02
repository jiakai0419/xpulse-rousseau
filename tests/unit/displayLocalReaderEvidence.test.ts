import assert from "node:assert/strict";
import { test } from "node:test";
import {
  collectLocalReaderEvidence,
  localReaderEvidenceSummary,
  localReaderScreenshotFileName,
} from "../../scripts/display-local-reader-evidence.mjs";

function sample(overrides: Record<string, unknown> = {}) {
  return {
    index: 1,
    pool: "history-selected",
    displayPost: {
      id: "2064000000000000000",
      author: {
        username: "author/name with spaces",
      },
    },
    ...overrides,
  };
}

test("local Reader screenshot file names are stable and filesystem-safe", () => {
  const name = localReaderScreenshotFileName(sample(), 7);

  assert.equal(name, "007-history-selected-author-name-with-spaces-2064000000000000000.png");
  assert.equal(name.length <= 220, true);
});

test("local Reader evidence summary reports attempted and blank screenshots", () => {
  const summary = localReaderEvidenceSummary([
    sample({
      index: 3,
      localScreenshot: ".data/local/003.png",
      localScreenshotProbe: { blank: true, reason: "mostly_white" },
    }),
    sample({
      index: 4,
      displayPost: { id: "post-4", author: { username: "author4" } },
      localScreenshot: ".data/local/004.png",
      localScreenshotProbe: { blank: false, reason: "contentful" },
    }),
    sample({
      index: 5,
      displayPost: { id: "post-5", author: { username: "author5" } },
    }),
  ]);

  assert.equal(summary.localAttempted, 2);
  assert.equal(summary.localBlank, 1);
  assert.deepEqual(summary.localBlankSamples, [
    {
      index: 3,
      id: "2064000000000000000",
      reason: "mostly_white",
      screenshot: ".data/local/003.png",
    },
  ]);
});

test("local Reader evidence capture is a no-op when disabled", async () => {
  const item = sample();

  await collectLocalReaderEvidence([item], { enabled: false });

  assert.equal(item.localScreenshot, undefined);
  assert.equal(item.localFacts, undefined);
});
