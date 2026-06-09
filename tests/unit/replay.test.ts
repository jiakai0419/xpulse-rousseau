import assert from "node:assert/strict";
import { test } from "node:test";
import { runRefresh } from "../../src/services/pipeline/runRefresh.ts";
import { createReplayRun } from "../../src/services/replay/replayRun.ts";
import { installPipelineOpenAIStub } from "../helpers/openAI.ts";
import { testPost } from "../helpers/posts.ts";

test("createReplayRun derives a local replay from a pipeline-produced trace without carrying action usage", async () => {
  const restoreFetch = installPipelineOpenAIStub();

  try {
    const sourceRun = await runRefresh({
      now: new Date("2026-06-05T08:00:00.000Z"),
      timelinePosts: [
        testPost({
          id: "a",
          text: "High-value historical post. https://t.co/story https://t.co/photo",
          links: [
            {
              url: "https://t.co/story",
              expandedUrl: "https://example.com/story",
              displayUrl: "example.com/story",
              title: "Story title",
            },
            {
              url: "https://t.co/photo",
              displayUrl: "pic.x.com/photo",
            },
          ],
          media: [
            {
              mediaKey: "media-1",
              type: "photo",
              url: "https://pbs.twimg.com/media/photo.jpg",
              width: 1200,
              height: 800,
              altText: "A chart",
            },
          ],
          referencedPostId: "quote-a",
          referencedPostType: "quoted",
          referencedPost: {
            id: "quote-a",
            text: "Quoted source context.",
            author: { id: "quote-author", name: "Quote Author", username: "quote_author" },
            createdAt: "2026-06-04T08:00:00.000Z",
            url: "https://x.com/quote_author/status/quote-a",
            metrics: { likes: 5 },
          },
        }),
        testPost({ id: "b", text: "Lower-value historical post." }),
      ],
      env: {
        OPENAI_API_KEY: "sk-test",
        OPENAI_SCORING_MODEL: "gpt-test-scoring",
        OPENAI_TRANSLATION_MODEL: "gpt-test-translation",
        SELECTED_POST_COUNT: "1",
      },
    });

    const replay = createReplayRun(sourceRun, new Date("2026-06-05T09:00:00.000Z"));

    assert.equal(replay.source, "replay");
    assert.equal(replay.replayOf?.runId, sourceRun.id);
    assert.equal(replay.usage.length, 0);
    assert.equal(replay.stats.fetched, 2);
    assert.equal(replay.stats.selected, 1);
    assert.equal(replay.selectedPosts[0].post.id, "a");
    assert.equal(replay.selectedPosts[0].post.links?.[0].displayUrl, "example.com/story");
    assert.equal(replay.selectedPosts[0].post.media?.[0].url, "https://pbs.twimg.com/media/photo.jpg");
    assert.equal(replay.selectedPosts[0].post.referencedPost?.author.username, "quote_author");
    assert.equal(replay.trace?.inputPosts[0].post.links?.[0].expandedUrl, "https://example.com/story");
    assert.equal(replay.trace?.inputPosts[0].post.media?.[0].altText, "A chart");
    assert.equal(replay.trace?.inputPosts[0].post.referencedPost?.text, "Quoted source context.");
    assert.match(replay.selectedPosts[0].translation?.textZh ?? "", /^测试翻译：High-value historical post\./);
    assert.equal(replay.trace?.source, "replay");
    assert.equal(replay.trace?.runId, replay.id);
    assert.deepEqual(replay.trace?.config.configuredModels, {
      scoring: "gpt-test-scoring",
      translation: "gpt-test-translation",
    });
  } finally {
    restoreFetch();
  }
});
