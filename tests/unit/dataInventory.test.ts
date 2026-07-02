import assert from "node:assert/strict";
import { test } from "node:test";
import {
  bytesToHuman,
  classifyDataPath,
  normalizeDataPath,
  summarizeOriginalEvidenceStore,
  summarizeRunsStore,
} from "../../scripts/data-inventory-core.mjs";

test("normalizes data paths before classification", () => {
  assert.equal(normalizeDataPath(".data/runs.json"), "runs.json");
  assert.equal(normalizeDataPath("./.data/display-oracle/report.json"), "display-oracle/report.json");
});

test("classifies local data by retention category", () => {
  assert.equal(classifyDataPath(".data/runs.json").category, "product-state");
  assert.equal(classifyDataPath(".data/openai-cache.json").category, "product-state");
  assert.equal(classifyDataPath(".data/display-gap-inventory/display-gap-baseline-225-2026-06-14/report.json").category, "canonical-evidence");
  assert.equal(classifyDataPath(".data/display-original-evidence/original-evidence-store.json").category, "canonical-evidence");
  assert.equal(classifyDataPath(".data/display-visual-review/visual-review-2026-06-15/report.md").category, "evidence-report");
  assert.equal(classifyDataPath(".data/data-inventory/data-inventory-now/report.md").category, "data-inventory-report");
  assert.equal(classifyDataPath(".data/x-audit-browser-profile/Default/Cookies").category, "browser-profile");
  assert.equal(classifyDataPath(".data/ui-smoke.png").category, "transient-debug");
  assert.equal(classifyDataPath(".data/runs.json.before-signal-zh.bak").category, "transient-debug");
  assert.equal(classifyDataPath(".data/unreviewed-local-file.json").category, "unknown-local-data");
});

test("formats byte counts for reports", () => {
  assert.equal(bytesToHuman(512), "512 B");
  assert.equal(bytesToHuman(1024), "1.00 KB");
  assert.equal(bytesToHuman(1024 * 1024 * 12), "12.0 MB");
});

test("summarizes run stores without reading post content", () => {
  const summary = summarizeRunsStore({
    runs: [
      {
        id: "run_live_old",
        source: "x",
        createdAt: "2026-06-01T00:00:00.000Z",
        selectedPosts: [{ id: "1" }, { id: "2" }],
        usage: [{ operation: "x.timeline" }],
        trace: {
          inputPosts: [{ id: "1" }, { id: "2" }, { id: "3" }],
        },
      },
      {
        id: "run_replay",
        source: "replay",
        createdAt: "2026-06-02T00:00:00.000Z",
        selectedPosts: [{ id: "4" }],
        usage: [],
      },
      {
        id: "run_live_new",
        source: "x",
        createdAt: "2026-06-03T00:00:00.000Z",
        selectedPosts: [{ id: "5" }, { id: "6" }, { id: "7" }],
        usage: [{ operation: "openai.scoring" }, { operation: "openai.translation" }],
        trace: {
          inputPosts: [{ id: "5" }],
        },
      },
    ],
  });

  assert.equal(summary.totalRuns, 3);
  assert.deepEqual(summary.sourceCounts, { x: 2, replay: 1 });
  assert.equal(summary.withTrace, 2);
  assert.equal(summary.usageLines, 3);
  assert.equal(summary.traceInputPosts, 4);
  assert.equal(summary.selectedPosts, 6);
  assert.equal(summary.minSelectedPosts, 1);
  assert.equal(summary.maxSelectedPosts, 3);
  assert.equal(summary.latestLiveRun?.id, "run_live_new");
  assert.equal(summary.newestRun?.id, "run_live_new");
  assert.equal(summary.oldestRun?.id, "run_live_old");
});

test("summarizes Original evidence stores by evidence shape only", () => {
  const summary = summarizeOriginalEvidenceStore({
    entries: [
      {
        id: "1",
        screenshot: ".data/original-1.png",
        probe: { blank: false },
        facts: { foundExactArticle: true },
        importedAt: "2026-06-01T00:00:00.000Z",
      },
      {
        id: "2",
        screenshot: ".data/original-2.png",
        facts: { foundExactArticle: false },
        importedAt: "2026-06-02T00:00:00.000Z",
      },
      {
        id: "1",
        facts: { foundExactArticle: true },
      },
    ],
  });

  assert.equal(summary.entries, 3);
  assert.equal(summary.uniquePostIds, 2);
  assert.equal(summary.withScreenshot, 2);
  assert.equal(summary.withFacts, 3);
  assert.equal(summary.withContentfulProbe, 1);
  assert.equal(summary.withTargetArticle, 2);
  assert.equal(summary.earliestImportedAt, "2026-06-01T00:00:00.000Z");
  assert.equal(summary.latestImportedAt, "2026-06-02T00:00:00.000Z");
});
