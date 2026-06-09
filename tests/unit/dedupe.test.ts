import assert from "node:assert/strict";
import { test } from "node:test";
import { dedupeTimelinePosts, normalizePostText } from "../../src/services/filtering/dedupe.ts";
import { testPost } from "../helpers/posts.ts";

test("normalizePostText collapses whitespace without removing links", () => {
  assert.equal(normalizePostText("Hello   World https://example.com/x"), "Hello World https://example.com/x");
});

test("dedupeTimelinePosts removes exact text duplicates", () => {
  const first = testPost({ id: "1", text: "Same useful idea", seenBy: ["a"] });
  const second = testPost({ id: "2", text: "Same useful idea", author: { id: "b", name: "B", username: "b" }, seenBy: ["b"] });

  const result = dedupeTimelinePosts([first, second]);

  assert.equal(result.posts.length, 1);
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.duplicates[0].reason, "exact_text");
  assert.deepEqual(result.posts[0].seenBy.sort(), ["a", "b"]);
});

test("dedupeTimelinePosts removes repeated retweets of the same original post", () => {
  const first = testPost({ id: "1", referencedPostType: "retweeted", referencedPostId: "origin-1", seenBy: ["a"] });
  const second = testPost({ id: "2", referencedPostType: "retweeted", referencedPostId: "origin-1", author: { id: "b", name: "B", username: "b" }, seenBy: ["b"] });

  const result = dedupeTimelinePosts([first, second]);

  assert.equal(result.posts.length, 1);
  assert.equal(result.duplicates.length, 1);
  assert.equal(result.duplicates[0].reason, "retweet");
});
