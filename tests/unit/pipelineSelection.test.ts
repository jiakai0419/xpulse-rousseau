import assert from "node:assert/strict";
import { test } from "node:test";
import { scoreAndSelectPosts } from "../../src/services/pipeline/selection.ts";
import { testPost } from "../helpers/posts.ts";

test("scoreAndSelectPosts ranks every candidate and keeps one selected post per author", async () => {
  const originalFetch = globalThis.fetch;
  const sameAuthor = { id: "author-a", name: "Author A", username: "author_a" };
  const posts = [
    testPost({ id: "author-a-best", text: "Best post from A.", author: sameAuthor, seenBy: ["author_a"] }),
    testPost({ id: "author-a-second", text: "Second post from A.", author: sameAuthor, seenBy: ["author_a"] }),
    testPost({
      id: "author-b",
      text: "Independent post from B.",
      author: { id: "author-b", name: "Author B", username: "author_b" },
      seenBy: ["author_b"],
    }),
  ];

  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(String((init as RequestInit).body));
    const requestedPosts = JSON.parse(body.input[1].content[0].text).posts as Array<{ id: string }>;

    return new Response(
      JSON.stringify({
        model: "gpt-test-scoring",
        output_text: JSON.stringify({
          scores: requestedPosts.map((post, index) => ({
            id: post.id,
            immediateValue: Math.max(1, 10 - index),
            immediateValueReason: `测试立即值得看 ${post.id}`,
            informationDensity: Math.max(1, 9 - index),
            informationDensityReason: `测试信息密度 ${post.id}`,
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
  };

  try {
    const result = await scoreAndSelectPosts(posts, {
      apiKey: "sk-test",
      model: "gpt-test-scoring",
      selectedPostCount: 7,
      batchSize: 20,
      now: new Date("2026-06-05T00:00:00.000Z"),
    });

    assert.deepEqual(result.ranked.map((item) => item.post.id), ["author-a-best", "author-a-second", "author-b"]);
    assert.deepEqual(result.top.map((item) => item.post.id), ["author-a-best", "author-b"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
