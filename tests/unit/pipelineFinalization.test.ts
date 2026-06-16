import assert from "node:assert/strict";
import { test } from "node:test";
import type { LinkPreviewCacheRepository } from "../../src/services/linkPreview/cache.ts";
import { finalizeSelectedPosts } from "../../src/services/pipeline/finalization.ts";
import { installPipelineOpenAIStub } from "../helpers/openAI.ts";
import { testPost } from "../helpers/posts.ts";

test("finalizeSelectedPosts attaches translations and enriches selected link previews", async () => {
  const restoreFetch = installPipelineOpenAIStub();
  const progressLabels: string[] = [];
  const usageLabels: string[] = [];
  const linkPreviewCache: LinkPreviewCacheRepository = {
    async get(key) {
      return {
        key,
        targetUrl: "https://example.com/story",
        finalUrl: "https://example.com/story",
        status: "resolved",
        createdAt: "2026-06-05T00:00:00.000Z",
        preview: {
          title: "Example Story",
          description: "A cached external preview.",
          images: [{ url: "https://example.com/cover.png", width: 1200, height: 630 }],
        },
      };
    },
    async set() {},
  };
  const top = [
    {
      post: testPost({
        id: "selected",
        text: "Selected post with an external link https://example.com/story",
        links: [
          {
            url: "https://t.co/story",
            expandedUrl: "https://example.com/story",
            displayUrl: "example.com/story",
          },
        ],
      }),
      score: { total: 82, dimensions: [] },
    },
  ];

  try {
    const result = await finalizeSelectedPosts(top, {
      apiKey: "sk-test",
      model: "gpt-test-translation",
      batchSize: 10,
      linkPreviewCache,
      now: new Date("2026-06-05T00:00:00.000Z"),
      onProgress: (progress) => progressLabels.push(progress.label ?? ""),
      onUsage: (usage) => usageLabels.push(usage.label),
    });

    assert.equal(result.selectedPosts[0].translation?.model, "gpt-test-translation");
    assert.equal(result.selectedPosts[0].translation?.textZh, "测试翻译：Selected post with an external link https://example.com/story");
    assert.equal(result.translations.get("selected")?.textZh, result.selectedPosts[0].translation?.textZh);
    assert.equal(result.selectedPosts[0].post.links?.[0].preview?.title, "Example Story");
    assert.equal(result.selectedPosts[0].post.links?.[0].unwoundUrl, "https://example.com/story");
    assert.deepEqual(progressLabels, ["Translating selected posts", "Translating selected posts", "Translating selected posts", "Resolving link previews"]);
    assert.deepEqual(usageLabels, ["Translation"]);
  } finally {
    restoreFetch();
  }
});
