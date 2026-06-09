import assert from "node:assert/strict";
import { test } from "node:test";
import { runRefresh } from "../../src/services/pipeline/runRefresh.ts";
import { installPipelineOpenAIStub } from "../helpers/openAI.ts";
import { testPost } from "../helpers/posts.ts";

type OpenAIRequestRecord = {
  schemaName: string;
  ids: string[];
};

function installRecordingPipelineOpenAIStub(records: OpenAIRequestRecord[]): () => void {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String((init as RequestInit).body));
    const schemaName = body.text.format.name;
    const posts = JSON.parse(body.input[1].content[0].text).posts as Array<{ id: string; text: string }>;
    records.push({
      schemaName,
      ids: posts.map((post) => post.id),
    });

    if (schemaName === "x_post_scores") {
      return new Response(
        JSON.stringify({
          model: "gpt-test-scoring",
          output_text: JSON.stringify({
            scores: posts.map((post, index) => ({
              id: post.id,
              immediateValue: Math.max(1, 10 - index),
              immediateValueReason: `Recorded score for ${post.id}.`,
              informationDensity: Math.max(1, 9 - index),
              informationDensityReason: `Recorded density for ${post.id}.`,
            })),
          }),
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            total_tokens: 150,
          },
        }),
        { status: 200 },
      );
    }

    if (schemaName === "x_post_translations") {
      return new Response(
        JSON.stringify({
          model: "gpt-test-translation",
          output_text: JSON.stringify({
            translations: posts.map((post) => ({
              id: post.id,
              textZh: `测试翻译：${post.text}`,
            })),
          }),
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            total_tokens: 150,
          },
        }),
        { status: 200 },
      );
    }

    throw new Error(`Unexpected schema ${schemaName}`);
  };

  return () => {
    globalThis.fetch = originalFetch;
  };
}

test("runRefresh filters ads, dedupes, and returns top selected posts", async () => {
  const restoreFetch = installPipelineOpenAIStub();
  const posts = [
    testPost({ id: "1", text: "Use code BUILD50 for 50% off. Limited time offer. https://example.com" }),
    testPost({
      id: "2",
      text: "New paper claims a 37% reduction in inference cost by routing requests.",
      author: { id: "author-2", name: "Author Two", username: "author_two" },
      seenBy: ["author_two"],
      metrics: { likes: 100, reposts: 20, quotes: 4 },
    }),
    testPost({
      id: "3",
      text: "New paper claims a 37% reduction in inference cost by routing requests.",
      author: { id: "dupe-author", name: "Duplicate Author", username: "dupe_author" },
      seenBy: ["dupe_author"],
    }),
    testPost({
      id: "4",
      text: "A product lesson: default workflows beat configuration-heavy interfaces.",
      author: { id: "author-4", name: "Author Four", username: "author_four" },
      seenBy: ["author_four"],
      metrics: { likes: 90, reposts: 10, quotes: 3 },
    }),
    testPost({
      id: "5",
      text: "Local-first software changes latency of thought, not just privacy.",
      author: { id: "author-5", name: "Author Five", username: "author_five" },
      seenBy: ["author_five"],
      metrics: { likes: 80, reposts: 8, quotes: 2 },
    }),
  ];

  try {
    const run = await runRefresh({
      now: new Date("2026-06-03T09:30:00.000Z"),
      timelinePosts: posts,
      env: {
        OPENAI_API_KEY: "sk-test",
        OPENAI_SCORING_MODEL: "gpt-test-scoring",
        OPENAI_TRANSLATION_MODEL: "gpt-test-translation",
      },
    });

    assert.equal(run.stats.fetched, 5);
    assert.equal(run.stats.adsExcluded, 1);
    assert.equal(run.stats.duplicatesExcluded, 1);
    assert.equal(run.stats.selected, 3);
    assert.equal(run.selectedPosts.every((item) => item.translation?.textZh), true);
    assert.equal(run.selectedPosts.every((item) => item.translation?.model === "gpt-test-translation"), true);
    assert.equal(run.usage.length, 2);
    assert.equal(run.trace?.version, "run-trace-v1");
    assert.equal(run.trace?.source, "x");
    assert.equal(run.trace?.inputPosts.length, 5);
    assert.equal(run.trace?.decisions.find((decision) => decision.postId === "1")?.state, "ad_excluded");
    assert.equal(run.trace?.decisions.find((decision) => decision.postId === "3")?.state, "duplicate_excluded");
    assert.equal(run.trace?.decisions.find((decision) => decision.postId === "3")?.duplicate?.keptId, "2");
    assert.equal(run.trace?.decisions.find((decision) => decision.postId === "2")?.state, "selected");
    assert.deepEqual(run.trace?.inputPosts.find((item) => item.post.id === "2")?.post.seenBy, ["author_two"]);
  } finally {
    restoreFetch();
  }
});

test("runRefresh filters previously shown posts before OpenAI scoring", async () => {
  const requests: OpenAIRequestRecord[] = [];
  const restoreFetch = installRecordingPipelineOpenAIStub(requests);
  const posts = [
    testPost({
      id: "seen",
      text: "Previously selected post.",
      author: { id: "seen-author", name: "Seen Author", username: "seen_author" },
      seenBy: ["seen_author"],
    }),
    testPost({
      id: "fresh",
      text: "Fresh post with new information.",
      author: { id: "fresh-author", name: "Fresh Author", username: "fresh_author" },
      seenBy: ["fresh_author"],
    }),
  ];

  try {
    const run = await runRefresh({
      now: new Date("2026-06-03T09:30:00.000Z"),
      timelinePosts: posts,
      seenRepository: {
        async identities() {
          return new Set(["post:seen"]);
        },
        async markRunShown() {},
      },
      env: {
        OPENAI_API_KEY: "sk-test",
        OPENAI_SCORING_MODEL: "gpt-test-scoring",
        OPENAI_TRANSLATION_MODEL: "gpt-test-translation",
      },
    });

    assert.equal(run.stats.seenExcluded, 1);
    assert.deepEqual(run.selectedPosts.map((item) => item.post.id), ["fresh"]);
    assert.deepEqual(requests.find((request) => request.schemaName === "x_post_scores")?.ids, ["fresh"]);
    assert.deepEqual(requests.find((request) => request.schemaName === "x_post_translations")?.ids, ["fresh"]);
    assert.equal(run.trace?.decisions.find((decision) => decision.postId === "seen")?.state, "seen_excluded");
  } finally {
    restoreFetch();
  }
});

test("runRefresh applies author diversity after scoring and preserves skipped scores in trace", async () => {
  const restoreFetch = installPipelineOpenAIStub();
  const sameAuthor = { id: "author-a", name: "Author A", username: "author_a" };
  const posts = [
    testPost({
      id: "author-a-best",
      text: "First high-signal post from author A.",
      author: sameAuthor,
      seenBy: ["author_a"],
    }),
    testPost({
      id: "author-a-second",
      text: "Second high-signal post from author A.",
      author: sameAuthor,
      seenBy: ["author_a"],
    }),
    testPost({
      id: "author-b",
      text: "Independent post from author B.",
      author: { id: "author-b", name: "Author B", username: "author_b" },
      seenBy: ["author_b"],
    }),
  ];

  try {
    const run = await runRefresh({
      now: new Date("2026-06-03T09:30:00.000Z"),
      timelinePosts: posts,
      env: {
        OPENAI_API_KEY: "sk-test",
        OPENAI_SCORING_MODEL: "gpt-test-scoring",
        OPENAI_TRANSLATION_MODEL: "gpt-test-translation",
      },
    });

    const skippedSameAuthor = run.trace?.decisions.find((decision) => decision.postId === "author-a-second");

    assert.deepEqual(run.selectedPosts.map((item) => item.post.id), ["author-a-best", "author-b"]);
    assert.equal(run.stats.scored, 3);
    assert.equal(run.stats.selected, 2);
    assert.equal(skippedSameAuthor?.state, "scored_not_selected");
    assert.equal(skippedSameAuthor?.score?.rank, 2);
    assert.equal(skippedSameAuthor?.selected?.selected, false);
    assert.equal(skippedSameAuthor?.translation?.generated, false);
  } finally {
    restoreFetch();
  }
});

test("runRefresh selects up to seven posts by default", async () => {
  const restoreFetch = installPipelineOpenAIStub();
  const posts = Array.from({ length: 12 }, (_, index) =>
    testPost({
      id: `post-${index + 1}`,
      text: `Research note ${index + 1}: a concrete signal with ${index + 10}% movement and a source link https://example.com/${index + 1}`,
      author: { id: `author-${index + 1}`, name: `Author ${index + 1}`, username: `author_${index + 1}` },
      seenBy: [`author_${index + 1}`],
      createdAt: new Date(Date.UTC(2026, 5, 3, 9, index)).toISOString(),
      metrics: {
        likes: 20 + index,
        reposts: index,
        quotes: Math.floor(index / 2),
        replies: Math.floor(index / 3),
      },
    }),
  );

  try {
    const run = await runRefresh({
      now: new Date("2026-06-03T09:30:00.000Z"),
      timelinePosts: posts,
      env: {
        OPENAI_API_KEY: "sk-test",
        OPENAI_SCORING_MODEL: "gpt-test-scoring",
        OPENAI_TRANSLATION_MODEL: "gpt-test-translation",
      },
    });

    assert.equal(run.stats.scored, 12);
    assert.equal(run.stats.selected, 7);
    assert.equal(run.selectedPosts.length, 7);
    assert.equal(run.selectedPosts.every((item) => item.translation?.model === "gpt-test-translation"), true);
    assert.equal(run.trace?.config.selectedPostCount, 7);
    assert.equal(run.trace?.decisions.filter((decision) => decision.selected?.selected).length, 7);
    assert.equal(run.trace?.decisions.filter((decision) => decision.state === "scored_not_selected").length, 5);
  } finally {
    restoreFetch();
  }
});

test("runRefresh does not locally score real X source without OpenAI", async () => {
  await assert.rejects(
    () =>
      runRefresh({
        source: "x",
        now: new Date("2026-06-03T09:30:00.000Z"),
        timelinePosts: [testPost({ id: "x-1", text: "Concrete post from X source." })],
        env: {},
      }),
    /OPENAI_API_KEY is required for live X refresh/,
  );
});
