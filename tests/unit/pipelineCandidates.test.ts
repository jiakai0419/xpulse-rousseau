import assert from "node:assert/strict";
import { test } from "node:test";
import { prepareCandidatePosts } from "../../src/services/pipeline/candidates.ts";
import { testPost } from "../helpers/posts.ts";

test("prepareCandidatePosts applies ad, duplicate, and seen filters while preserving input snapshots", async () => {
  const keptDuplicateSource = testPost({
    id: "kept-duplicate-source",
    text: "Same useful finding about inference routing.",
    author: { id: "kept-author", name: "Kept Author", username: "kept_author" },
    seenBy: ["kept_author"],
  });
  const duplicate = testPost({
    id: "duplicate",
    text: "Same useful finding about inference routing.",
    author: { id: "duplicate-author", name: "Duplicate Author", username: "duplicate_author" },
    seenBy: ["duplicate_author"],
  });
  const ad = testPost({
    id: "ad",
    text: "Use code BUILD50 for 50% off. Limited time offer. https://example.com",
  });
  const seen = testPost({
    id: "seen",
    text: "Previously displayed but otherwise good.",
    author: { id: "seen-author", name: "Seen Author", username: "seen_author" },
    seenBy: ["seen_author"],
  });
  const fresh = testPost({
    id: "fresh",
    text: "Fresh useful signal with a concrete source.",
    author: { id: "fresh-author", name: "Fresh Author", username: "fresh_author" },
    seenBy: ["fresh_author"],
  });

  const result = await prepareCandidatePosts(
    [keptDuplicateSource, duplicate, ad, seen, fresh],
    {
      async identities() {
        return new Set(["post:seen"]);
      },
      async markRunShown() {},
    },
  );

  assert.deepEqual(result.inputPosts.map((post) => post.id), ["kept-duplicate-source", "duplicate", "ad", "seen", "fresh"]);
  assert.equal(result.adDecisions.get("ad")?.excluded, true);
  assert.deepEqual(result.adFiltered.excluded.map((item) => item.post.id), ["ad"]);
  assert.deepEqual(result.deduped.duplicates, [
    {
      keptId: "kept-duplicate-source",
      duplicateId: "duplicate",
      reason: "exact_text",
    },
  ]);
  assert.deepEqual(result.inputPosts.find((post) => post.id === "kept-duplicate-source")?.seenBy, ["kept_author"]);
  const mergedSeenBy = result.deduped.posts.find((post) => post.id === "kept-duplicate-source")?.seenBy ?? [];
  assert.deepEqual([...mergedSeenBy].sort(), ["duplicate_author", "kept_author"]);
  assert.deepEqual(result.seenFiltered.excluded.map((item) => item.post.id), ["seen"]);
  assert.deepEqual(result.candidates.map((post) => post.id), ["kept-duplicate-source", "fresh"]);
});

test("prepareCandidatePosts skips seen filtering when no seen repository is provided", async () => {
  const posts = [
    testPost({ id: "one", text: "One useful post." }),
    testPost({ id: "two", text: "Two useful post." }),
  ];

  const result = await prepareCandidatePosts(posts);

  assert.deepEqual(result.seenFiltered.excluded, []);
  assert.deepEqual(result.candidates.map((post) => post.id), ["one", "two"]);
});
