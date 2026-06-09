import assert from "node:assert/strict";
import { test } from "node:test";
import { contentFingerprint, openAICacheKey } from "../../src/services/openai/cache.ts";
import { testPost } from "../helpers/posts.ts";

function scoringKey(post = testPost()) {
  return openAICacheKey({
    operation: "scoring",
    model: "gpt-test",
    promptVersion: "scoring-v2",
    post,
  });
}

test("OpenAI cache key ignores latest engagement metrics", () => {
  const quiet = testPost({
    id: "stable-post",
    text: "A stable source post that should keep the same OpenAI judgment.",
    metrics: { replies: 0, reposts: 0, likes: 0, impressions: 0 },
  });
  const active = testPost({
    id: "stable-post",
    text: "A stable source post that should keep the same OpenAI judgment.",
    metrics: { replies: 120, reposts: 230, likes: 5000, impressions: 900000 },
  });

  assert.equal(contentFingerprint(quiet), contentFingerprint(active));
  assert.equal(scoringKey(quiet).key, scoringKey(active).key);
});

test("OpenAI cache key changes by operation, requested model, prompt version, and source content", () => {
  const post = testPost({
    id: "cache-post",
    text: "The original claim has a concrete number: 37%.",
  });
  const changedText = testPost({
    id: "cache-post",
    text: "The original claim has a concrete number: 52%.",
  });
  const changedReference = testPost({
    id: "cache-post",
    text: "The original claim has a concrete number: 37%.",
    referencedPostType: "quoted",
    referencedPostId: "quote-1",
    referencedPost: {
      id: "quote-1",
      text: "Quoted evidence changed.",
      author: { id: "quote-author", name: "Quote Author", username: "quote_author" },
      createdAt: "2026-06-03T08:00:00.000Z",
      url: "https://x.com/quote_author/status/quote-1",
      metrics: {},
    },
  });

  const base = openAICacheKey({
    operation: "scoring",
    model: "gpt-test",
    promptVersion: "scoring-v2",
    post,
  });
  const translation = openAICacheKey({
    operation: "translation",
    model: "gpt-test",
    promptVersion: "scoring-v2",
    post,
  });
  const newModel = openAICacheKey({
    operation: "scoring",
    model: "gpt-test-new",
    promptVersion: "scoring-v2",
    post,
  });
  const newPrompt = openAICacheKey({
    operation: "scoring",
    model: "gpt-test",
    promptVersion: "scoring-v3",
    post,
  });

  assert.notEqual(base.key, translation.key);
  assert.notEqual(base.key, newModel.key);
  assert.notEqual(base.key, newPrompt.key);
  assert.notEqual(base.key, scoringKey(changedText).key);
  assert.notEqual(base.key, scoringKey(changedReference).key);
});
