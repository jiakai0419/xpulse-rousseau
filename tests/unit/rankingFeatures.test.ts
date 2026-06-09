import assert from "node:assert/strict";
import { test } from "node:test";
import type { RefreshRun } from "../../src/domain/tweet.ts";
import { engagementSignalDimension, engagementSignalScore } from "../../src/services/scoring/engagement.ts";
import { selectTopByAuthorDiversity } from "../../src/services/selection/authorDiversity.ts";
import { filterSeenPosts, seenIdentityForPost } from "../../src/services/seen/seenLedger.ts";
import { newestPostId } from "../../src/services/x/timelineCursor.ts";
import { testPost } from "../helpers/posts.ts";

test("engagementSignalScore uses latest metrics on a 0-10 scale", () => {
  const quiet = testPost({ metrics: { replies: 0, reposts: 0, likes: 0, impressions: 0 } });
  const active = testPost({ metrics: { replies: 12, reposts: 30, likes: 900, impressions: 120000 } });

  assert.equal(engagementSignalScore(quiet), 0);
  assert.ok(engagementSignalScore(active) > engagementSignalScore(quiet));
  assert.ok(engagementSignalScore(active) <= 10);
  assert.match(engagementSignalDimension(active, 0.2).reason, /互动量/);
});

test("engagementSignalScore uses reposted source metrics for retweets", () => {
  const retweet = testPost({
    id: "retweet",
    metrics: { replies: 0, reposts: 1, likes: 0, impressions: 10 },
    referencedPostType: "retweeted",
    referencedPostId: "source",
    referencedPost: {
      id: "source",
      text: "Source post with real engagement.",
      author: { id: "source-author", name: "Source Author", username: "source_author" },
      createdAt: "2026-06-03T09:00:00.000Z",
      url: "https://x.com/source_author/status/source",
      metrics: { replies: 482, reposts: 1274, likes: 6492, impressions: 2653928 },
    },
  });

  assert.ok(engagementSignalScore(retweet) > 0);
  assert.match(engagementSignalDimension(retweet, 0.2).reason, /2,653,928|265\.4万/);
});

test("selectTopByAuthorDiversity keeps the highest-ranked post per author after scoring", () => {
  const authorA = { id: "a", name: "Author A", username: "author_a" };
  const authorB = { id: "b", name: "Author B", username: "author_b" };
  const ranked = [
    { post: testPost({ id: "a-1", author: authorA }), score: { total: 90, dimensions: [] } },
    { post: testPost({ id: "a-2", author: authorA }), score: { total: 89, dimensions: [] } },
    { post: testPost({ id: "b-1", author: authorB }), score: { total: 70, dimensions: [] } },
  ];

  const result = selectTopByAuthorDiversity(ranked, 7);

  assert.deepEqual(result.selected.map((item) => item.post.id), ["a-1", "b-1"]);
  assert.equal(result.skipped[0].item.post.id, "a-2");
  assert.equal(result.skipped[0].keptPostId, "a-1");
});

test("selectTopByAuthorDiversity uses the reader-facing source author for retweets", () => {
  const sourceAuthor = { id: "source-author", name: "Source Author", username: "source_author" };
  const retweetAuthor = { id: "retweeter", name: "Retweeter", username: "retweeter" };
  const ranked = [
    {
      post: testPost({
        id: "retweet",
        author: retweetAuthor,
        referencedPostType: "retweeted",
        referencedPostId: "source-1",
        referencedPost: {
          id: "source-1",
          text: "Best source post.",
          author: sourceAuthor,
          createdAt: "2026-06-03T09:00:00.000Z",
          url: "https://x.com/source_author/status/source-1",
          metrics: {},
        },
      }),
      score: { total: 90, dimensions: [] },
    },
    { post: testPost({ id: "source-2", author: sourceAuthor }), score: { total: 80, dimensions: [] } },
  ];

  const result = selectTopByAuthorDiversity(ranked, 7);

  assert.deepEqual(result.selected.map((item) => item.post.id), ["retweet"]);
  assert.equal(result.skipped[0].item.post.id, "source-2");
});

test("filterSeenPosts excludes only previously displayed identities", () => {
  const fresh = testPost({ id: "fresh" });
  const old = testPost({ id: "old" });
  const retweet = testPost({ id: "retweet", referencedPostType: "retweeted", referencedPostId: "original" });
  const seen = new Set([seenIdentityForPost(old), "post:original"]);
  const result = filterSeenPosts([fresh, old, retweet], seen);

  assert.deepEqual(result.kept.map((post) => post.id), ["fresh"]);
  assert.deepEqual(result.excluded.map((item) => item.post.id), ["old", "retweet"]);
});

test("newestPostId returns the highest X snowflake id", () => {
  assert.equal(
    newestPostId([
      testPost({ id: "2063004755266330936" }),
      testPost({ id: "2063197357437862009" }),
      testPost({ id: "2062948594597208557" }),
    ]),
    "2063197357437862009",
  );
});

test("seen ledger identities can be marked from a completed live run", async () => {
  const records: string[] = [];
  const repository = {
    async identities() {
      return new Set(records);
    },
    async markRunShown(run: RefreshRun) {
      records.push(...run.selectedPosts.map((item) => seenIdentityForPost(item.post)));
    },
  };
  const run = {
    id: "run-1",
    createdAt: "2026-06-06T00:00:00.000Z",
    source: "x",
    stats: { fetched: 1, adsExcluded: 0, duplicatesExcluded: 0, scored: 1, selected: 1 },
    selectedPosts: [{ post: testPost({ id: "shown" }), score: { total: 80, dimensions: [] } }],
    usage: [],
  } satisfies RefreshRun;

  await repository.markRunShown(run);

  assert.deepEqual(Array.from(await repository.identities()), ["post:shown"]);
});
