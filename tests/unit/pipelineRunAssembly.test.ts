import assert from "node:assert/strict";
import { test } from "node:test";
import type { PostTranslation, UsageRecord, WeightedScore } from "../../src/domain/tweet.ts";
import { prepareCandidatePosts } from "../../src/services/pipeline/candidates.ts";
import { assembleRefreshRun } from "../../src/services/pipeline/runAssembly.ts";
import { testPost } from "../helpers/posts.ts";

test("assembleRefreshRun builds stats and preserves selected preview evidence in trace input", async () => {
  const quoteLink = {
    url: "https://t.co/quote",
    expandedUrl: "https://example.com/quote",
    displayUrl: "example.com/quote",
  };
  const basePost = testPost({
    id: "selected",
    text: "Selected post with an external link https://example.com/story",
    links: [
      {
        url: "https://t.co/story",
        expandedUrl: "https://example.com/story",
        displayUrl: "example.com/story",
      },
    ],
    referencedPostId: "quote-1",
    referencedPostType: "quoted",
    referencedPost: {
      id: "quote-1",
      text: "Quoted post with a link https://example.com/quote",
      author: { id: "quote-author", name: "Quote Author", username: "quote_author" },
      createdAt: "2026-06-03T08:00:00.000Z",
      url: "https://x.com/quote_author/status/quote-1",
      metrics: { likes: 3 },
      links: [quoteLink],
    },
  });
  const duplicatePost = testPost({
    id: "duplicate",
    text: basePost.text,
    author: { id: "duplicate-author", name: "Duplicate Author", username: "duplicate_author" },
  });
  const candidatePreparation = await prepareCandidatePosts([basePost, duplicatePost]);
  const score: WeightedScore = {
    total: 8.2,
    dimensions: [
      {
        key: "immediateValue",
        label: "立即值得看",
        weight: 0.4,
        score: 8.4,
        reason: "A concrete selected post.",
      },
    ],
    model: "gpt-test-scoring",
    generatedAt: "2026-06-03T09:30:00.000Z",
  };
  const translation: PostTranslation = {
    textZh: "测试翻译",
    model: "gpt-test-translation",
    generatedAt: "2026-06-03T09:31:00.000Z",
  };
  const enrichedSelectedPost = {
    ...basePost,
    links: [
      {
        ...basePost.links![0],
        unwoundUrl: "https://example.com/story",
        preview: {
          title: "Example Story",
          description: "A cached external preview.",
          images: [{ url: "https://example.com/story.png", width: 1200, height: 630 }],
        },
      },
    ],
    referencedPost: {
      ...basePost.referencedPost!,
      links: [
        {
          ...quoteLink,
          unwoundUrl: "https://example.com/quote",
          preview: {
            title: "Quoted Example",
            description: "A quoted external preview.",
            images: [{ url: "https://example.com/quote.png", width: 800, height: 600 }],
          },
        },
      ],
    },
  };
  const usage: UsageRecord = {
    provider: "openai",
    operation: "translation",
    label: "Translation",
    model: "gpt-test-translation",
    itemCount: 1,
    itemIds: ["selected"],
    inputTokens: 10,
    outputTokens: 5,
    totalTokens: 15,
    createdAt: "2026-06-03T09:31:00.000Z",
  };

  const run = assembleRefreshRun({
    runId: "run_assembly",
    createdAt: "2026-06-03T09:30:00.000Z",
    source: "x",
    fetchedPostCount: 2,
    candidatePreparation,
    ranked: [{ post: basePost, score }],
    selected: [{ post: basePost, score }],
    selectedPosts: [{ post: enrichedSelectedPost, score, translation }],
    translations: new Map([["selected", translation]]),
    usage: [usage],
    selectedPostCount: 7,
    configuredModels: {
      scoring: "gpt-test-scoring",
      translation: "gpt-test-translation",
    },
    batches: {
      scoring: 20,
      translation: 10,
    },
  });

  assert.equal(run.id, "run_assembly");
  assert.deepEqual(run.stats, {
    fetched: 2,
    adsExcluded: 0,
    duplicatesExcluded: 1,
    seenExcluded: 0,
    scored: 1,
    selected: 1,
  });
  assert.equal(run.selectedPosts[0].translation?.textZh, "测试翻译");
  assert.deepEqual(run.usage, [usage]);
  assert.equal(run.trace?.config.selectedPostCount, 7);
  assert.deepEqual(run.trace?.config.configuredModels, {
    scoring: "gpt-test-scoring",
    translation: "gpt-test-translation",
  });
  assert.deepEqual(run.trace?.config.batches, { scoring: 20, translation: 10 });
  assert.deepEqual(run.trace?.config.promptVersions, {
    scoring: "scoring-v2",
    translation: "translation-v2",
  });
  assert.equal(run.trace?.decisions.find((decision) => decision.postId === "duplicate")?.state, "duplicate_excluded");
  assert.equal(run.trace?.decisions.find((decision) => decision.postId === "selected")?.translation?.model, "gpt-test-translation");
  assert.equal(candidatePreparation.inputPosts[0].links?.[0].preview, undefined);

  const traceSelectedPost = run.trace?.inputPosts.find((snapshot) => snapshot.post.id === "selected")?.post;
  assert.equal(traceSelectedPost?.links?.[0].preview?.title, "Example Story");
  assert.equal(traceSelectedPost?.links?.[0].unwoundUrl, "https://example.com/story");
  assert.equal(traceSelectedPost?.links?.[0].preview?.images?.[0].url, "https://example.com/story.png");
  assert.equal(traceSelectedPost?.referencedPost?.links?.[0].preview?.title, "Quoted Example");
  assert.equal(traceSelectedPost?.referencedPost?.links?.[0].unwoundUrl, "https://example.com/quote");
});
