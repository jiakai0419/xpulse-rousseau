import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { RefreshRun, RunTrace } from "../../src/domain/tweet.ts";
import { FileSeenPostRepository } from "../../src/services/seen/seenLedger.ts";
import { FileTimelineCursorRepository } from "../../src/services/x/timelineCursor.ts";
import { testPost } from "../helpers/posts.ts";

function emptyTrace(run: RefreshRun, inputPosts = run.selectedPosts.map((item) => item.post)): RunTrace {
  return {
    version: "run-trace-v1",
    runId: run.id,
    createdAt: run.createdAt,
    source: run.source,
    pipelineVersion: "reader-refresh-v1",
    config: {
      selectedPostCount: 7,
      scoringWeights: [
        { key: "immediateValue", label: "立即值得看", weight: 0.4 },
        { key: "informationDensity", label: "信息密度", weight: 0.4 },
        { key: "engagementSignal", label: "互动信号", weight: 0.2 },
      ],
      configuredModels: {
        scoring: "gpt-test",
        translation: "gpt-test",
      },
      batches: {
        scoring: 20,
        translation: 10,
      },
      promptVersions: {
        scoring: "scoring-v2",
        translation: "translation-v2",
      },
    },
    inputPosts: inputPosts.map((post, index) => ({ post, fetchIndex: index })),
    decisions: [],
  };
}

test("FileSeenPostRepository records canonical selected identities for retweets", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xpulse-seen-store-"));
  const filePath = join(dir, "seen-posts.json");
  const repository = new FileSeenPostRepository(filePath);
  const run = {
    id: "run-seen",
    createdAt: "2026-06-07T00:00:00.000Z",
    source: "x",
    stats: { fetched: 2, adsExcluded: 0, duplicatesExcluded: 0, seenExcluded: 0, scored: 2, selected: 2 },
    selectedPosts: [
      { post: testPost({ id: "normal" }), score: { total: 80, dimensions: [] } },
      {
        post: testPost({
          id: "retweet-wrapper",
          author: { id: "reposter", name: "Reposter", username: "reposter" },
          referencedPostType: "retweeted",
          referencedPostId: "source-post",
          referencedPost: {
            id: "source-post",
            text: "The reposted source post.",
            author: { id: "source-author", name: "Source Author", username: "source_author" },
            createdAt: "2026-06-07T00:00:00.000Z",
            url: "https://x.com/source_author/status/source-post",
            metrics: {},
          },
        }),
        score: { total: 70, dimensions: [] },
      },
    ],
    usage: [],
  } satisfies RefreshRun;

  try {
    await repository.markRunShown(run);
    await repository.markRunShown(run);

    const identities = Array.from(await repository.identities()).sort();
    const store = JSON.parse(await readFile(filePath, "utf8")) as {
      records: Array<{ identity: string; postId: string; canonicalPostId: string; runIds: string[] }>;
    };
    const retweetRecord = store.records.find((record) => record.identity === "post:source-post");

    assert.deepEqual(identities, ["post:normal", "post:source-post"]);
    assert.equal(retweetRecord?.postId, "retweet-wrapper");
    assert.equal(retweetRecord?.canonicalPostId, "source-post");
    assert.deepEqual(retweetRecord?.runIds, ["run-seen"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FileTimelineCursorRepository updates from fetched trace input, not only selected posts", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xpulse-cursor-store-"));
  const filePath = join(dir, "timeline-cursor.json");
  const repository = new FileTimelineCursorRepository(filePath);
  const selected = testPost({ id: "2063004755266330936" });
  const newerUnselected = testPost({ id: "2063197357437862009" });
  const run = {
    id: "run-cursor",
    createdAt: "2026-06-07T00:00:00.000Z",
    source: "x",
    stats: { fetched: 2, adsExcluded: 0, duplicatesExcluded: 0, seenExcluded: 0, scored: 2, selected: 1 },
    selectedPosts: [{ post: selected, score: { total: 80, dimensions: [] } }],
    usage: [],
  } satisfies RefreshRun;
  const tracedRun = {
    ...run,
    trace: emptyTrace(run, [selected, newerUnselected]),
  } satisfies RefreshRun;

  try {
    await repository.updateFromRun(tracedRun);

    const cursor = JSON.parse(await readFile(filePath, "utf8")) as { latestPostId: string; runId: string };

    assert.equal(cursor.latestPostId, "2063197357437862009");
    assert.equal(cursor.runId, "run-cursor");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
