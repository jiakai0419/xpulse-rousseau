import assert from "node:assert/strict";
import { test } from "node:test";
import {
  auditRunFromSamples,
  buildDisplayGapInventoryReport,
  fallbackScore,
  inventoryRunFromPosts,
  markdownDisplayGapInventoryReport,
} from "../../scripts/display-gap-inventory-core.mjs";

function author(username: string) {
  return {
    id: username,
    name: username,
    username,
  };
}

function post(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    text: "A real X-derived post",
    author: author("author"),
    createdAt: "2026-06-10T00:00:00.000Z",
    url: "https://x.com/author/status/1",
    metrics: {},
    seenBy: [],
    ...overrides,
  };
}

test("inventoryRunFromPosts builds a no-OpenAI trace run for fresh evidence capture", () => {
  const posts = [post({ id: "one" }), post({ id: "two" })];
  const run = inventoryRunFromPosts(posts, "2026-06-10T00:00:00.000Z");

  assert.equal(run.id, "inventory_fresh_1781049600000");
  assert.equal(run.source, "x");
  assert.equal(run.stats.fetched, 2);
  assert.equal(run.stats.scored, 0);
  assert.deepEqual(run.selectedPosts, []);
  assert.equal(run.trace.config.configuredModels.scoring, "inventory-no-openai");
  assert.equal(run.trace.config.configuredModels.translation, "inventory-no-openai");
  assert.deepEqual(
    run.trace.inputPosts.map((input: any) => [input.post.id, input.fetchIndex]),
    [
      ["one", 0],
      ["two", 1],
    ],
  );
});

test("auditRunFromSamples reuses saved scores and translations for reader-facing reposts", () => {
  const source = post({ id: "source", text: "Source post", author: author("source") });
  const retweet = post({
    id: "retweet",
    text: "RT @source",
    author: author("reposter"),
    referencedPostType: "retweeted",
    referencedPost: source,
  });
  const traceOnly = post({ id: "trace-only", text: "Trace scored only" });
  const unknown = post({ id: "unknown", text: "No saved scoring" });
  const savedScore = { total: 8.2, dimensions: [{ name: "立即值得看", score: 8.2 }] };
  const traceScore = { total: 6.5, dimensions: [{ name: "信息密度", score: 6.5 }] };
  const translation = { translatedText: "中文译文" };
  const run = {
    id: "saved-live-run",
    selectedPosts: [{ post: retweet, score: savedScore, translation }],
    trace: {
      decisions: [{ postId: "trace-only", score: { weightedScore: traceScore } }],
    },
  };
  const samples = [
    { timelinePost: retweet, displayPost: source },
    { timelinePost: traceOnly, displayPost: traceOnly },
    { timelinePost: unknown, displayPost: unknown },
  ];

  const auditRun = auditRunFromSamples(samples, [run], {
    id: "display-inventory-test",
    createdAt: "2026-06-10T00:01:00.000Z",
  });

  assert.equal(auditRun.id, "display-inventory-test");
  assert.equal(auditRun.stats.selected, 3);
  assert.equal(auditRun.selectedPosts[0].post.id, "retweet");
  assert.deepEqual(auditRun.selectedPosts[0].score, savedScore);
  assert.deepEqual(auditRun.selectedPosts[0].translation, translation);
  assert.deepEqual(auditRun.selectedPosts[1].score, traceScore);
  assert.deepEqual(auditRun.selectedPosts[2].score, fallbackScore());
});

test("display gap inventory report counts evidence buckets, risks, and missing fields", () => {
  const report = buildDisplayGapInventoryReport({
    createdAt: "2026-06-10T00:02:00.000Z",
    sourceStorePath: ".data/runs.json",
    outputDir: ".data/display-gap-inventory/test",
    includeFresh: false,
    historicalRuns: [{ id: "run-a" }, { id: "run-b" }],
    runs: [{ id: "run-a" }, { id: "run-b" }],
    reportSamples: [
      {
        index: 1,
        pool: "history-selected",
        author: { username: "alice" },
        buckets: ["quote", "single-video"],
        risks: ["quote_video_without_playable_variant"],
        missingData: ["video_variants"],
        localScreenshot: ".data/local.png",
        url: "https://x.com/alice/status/1",
        textStart: "A | risky post",
      },
      {
        index: 2,
        pool: "history-trace",
        author: { username: "bob" },
        buckets: ["quote"],
        risks: [],
        missingData: [],
        url: "https://x.com/bob/status/2",
        textStart: "Plain",
      },
    ],
    screenshotSummary: { localAttempted: 1, localBlank: 0, localBlankSamples: [] },
  });

  assert.equal(report.sampleCount, 2);
  assert.deepEqual(report.bucketCounts, { quote: 2, "single-video": 1 });
  assert.deepEqual(report.riskCounts, { quote_video_without_playable_variant: 1 });
  assert.deepEqual(report.missingDataCounts, { video_variants: 1 });

  const markdown = markdownDisplayGapInventoryReport(report);
  assert.match(markdown, /Fresh capture: not requested/);
  assert.match(markdown, /\| quote_video_without_playable_variant \| 1 \|/);
  assert.match(markdown, /A \\| risky post/);
});
