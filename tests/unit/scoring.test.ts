import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeWeights } from "../../src/config/scoring.ts";
import type { OpenAICacheRecord, OpenAICacheRepository } from "../../src/services/openai/cache.ts";
import { rankPostsWithOpenAI } from "../../src/services/scoring/openAIScoring.ts";
import { testPost } from "../helpers/posts.ts";

function memoryOpenAICache(): OpenAICacheRepository {
  const records = new Map<string, OpenAICacheRecord>();

  return {
    async get(key) {
      return records.get(key);
    },
    async set(record) {
      records.set(record.key, record);
    },
  };
}

test("normalizeWeights preserves relative weighting and sums to one", () => {
  const weights = normalizeWeights([
    { key: "immediateValue", label: "A", weight: 2 },
    { key: "informationDensity", label: "B", weight: 1 },
  ]);

  assert.equal(weights[0].weight, 2 / 3);
  assert.equal(weights[1].weight, 1 / 3);
});

test("rankPostsWithOpenAI requires OpenAI configuration", async () => {
  const posts = [
    testPost({ id: "1", text: "Small observation: teams ship better when default paths are clear." }),
    testPost({ id: "2", text: "New benchmark shows a 37% inference cost reduction with routing. https://example.com" }),
  ];

  await assert.rejects(
    () =>
      rankPostsWithOpenAI(posts, {
        model: "gpt-test",
        now: new Date("2026-06-05T00:00:00.000Z"),
      }),
    /OpenAI API key and scoring model are required/,
  );
});

test("rankPostsWithOpenAI ranks complete OpenAI scores", async () => {
  const originalFetch = globalThis.fetch;
  const requests: unknown[] = [];
  const posts = [
    testPost({ id: "1", text: "Small observation: teams ship better when default paths are clear." }),
    testPost({ id: "2", text: "New benchmark shows a 37% inference cost reduction with routing. https://example.com" }),
  ];

  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String((init as RequestInit).body)));

    return new Response(
      JSON.stringify({
        model: "gpt-test-scoring",
        output_text: JSON.stringify({
          scores: [
            {
              id: "1",
              immediateValue: 3,
              immediateValueReason: "Lower value.",
              informationDensity: 3,
              informationDensityReason: "Lower density.",
            },
            {
              id: "2",
              immediateValue: 9,
              immediateValueReason: "Higher value.",
              informationDensity: 8,
              informationDensityReason: "Higher density.",
            },
          ],
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
    const ranked = await rankPostsWithOpenAI(posts, {
      apiKey: "sk-test",
      model: "gpt-test-scoring",
      now: new Date("2026-06-05T00:00:00.000Z"),
    });

    assert.deepEqual(ranked.map((item) => item.post.id), ["2", "1"]);
    assert.equal(ranked[0].score.total, 75);
    assert.equal(ranked.every((item) => item.score.model === "gpt-test-scoring"), true);
    const request = requests[0] as { input: Array<{ content: Array<{ text: string }> }> };
    assert.match(request.input[0].content[0].text, /Simplified Chinese/);
    assert.match(request.input[1].content[0].text, /Simplified Chinese/);
    assert.doesNotMatch(request.input[1].content[0].text, /metrics/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rankPostsWithOpenAI scores reposted source content instead of the retweet wrapper", async () => {
  const originalFetch = globalThis.fetch;
  const requests: unknown[] = [];
  const posts = [
    testPost({
      id: "retweet",
      text: "RT @source: Truncated wrapper text...",
      referencedPostType: "retweeted",
      referencedPostId: "source",
      referencedPost: {
        id: "source",
        text: "Full source post with the claim the reader actually sees.",
        author: { id: "source-author", name: "Source Author", username: "source_author" },
        createdAt: "2026-06-05T00:00:00.000Z",
        url: "https://x.com/source_author/status/source",
        metrics: {},
      },
    }),
  ];

  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String((init as RequestInit).body)));

    return new Response(
      JSON.stringify({
        model: "gpt-test-scoring",
        output_text: JSON.stringify({
          scores: [
            {
              id: "retweet",
              immediateValue: 8,
              immediateValueReason: "Reader-facing source post is timely.",
              informationDensity: 7,
              informationDensityReason: "Reader-facing source post has concrete details.",
            },
          ],
        }),
      }),
      { status: 200 },
    );
  };

  try {
    await rankPostsWithOpenAI(posts, {
      apiKey: "sk-test",
      model: "gpt-test-scoring",
      now: new Date("2026-06-05T00:00:00.000Z"),
    });

    const request = requests[0] as { input: Array<{ content: Array<{ text: string }> }> };
    assert.match(request.input[1].content[0].text, /Full source post with the claim/);
    assert.match(request.input[1].content[0].text, /reposted/);
    assert.doesNotMatch(request.input[1].content[0].text, /Truncated wrapper/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rankPostsWithOpenAI caches OpenAI scoring while recalculating engagement locally", async () => {
  const originalFetch = globalThis.fetch;
  const cache = memoryOpenAICache();
  let requestCount = 0;
  const lowEngagement = testPost({ id: "cached", metrics: { replies: 0, reposts: 0, likes: 0, impressions: 0 } });
  const highEngagement = testPost({ id: "cached", metrics: { replies: 30, reposts: 40, likes: 1000, impressions: 500000 } });

  globalThis.fetch = async () => {
    requestCount += 1;

    return new Response(
      JSON.stringify({
        model: "gpt-test-scoring",
        output_text: JSON.stringify({
          scores: [
            {
              id: "cached",
              immediateValue: 8,
              immediateValueReason: "Cached value.",
              informationDensity: 7,
              informationDensityReason: "Cached density.",
            },
          ],
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
    const first = await rankPostsWithOpenAI([lowEngagement], {
      apiKey: "sk-test",
      model: "gpt-test-scoring",
      cache,
      now: new Date("2026-06-05T00:00:00.000Z"),
    });
    const second = await rankPostsWithOpenAI([highEngagement], {
      apiKey: "sk-test",
      model: "gpt-test-scoring",
      cache,
      now: new Date("2026-06-05T00:01:00.000Z"),
    });

    assert.equal(requestCount, 1);
    assert.equal(first[0].score.dimensions.find((dimension) => dimension.key === "engagementSignal")?.score, 0);
    assert.ok((second[0].score.dimensions.find((dimension) => dimension.key === "engagementSignal")?.score ?? 0) > 0);
    assert.ok(second[0].score.total > first[0].score.total);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rankPostsWithOpenAI repairs missing OpenAI scores with the same model", async () => {
  const originalFetch = globalThis.fetch;
  const requests: unknown[] = [];
  const usageRecords = [];
  const posts = [
    testPost({ id: "1", text: "Small observation: teams ship better when default paths are clear." }),
    testPost({ id: "2", text: "New benchmark shows a 37% inference cost reduction with routing. https://example.com" }),
  ];

  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String((init as RequestInit).body)));

    const scores =
      requests.length === 1
        ? [
            {
              id: "1",
              immediateValue: 3,
              immediateValueReason: "Returned in the first pass.",
              informationDensity: 3,
              informationDensityReason: "Returned in the first pass.",
            },
          ]
        : [
            {
              id: "2",
              immediateValue: 9,
              immediateValueReason: "Returned by repair pass.",
              informationDensity: 8,
              informationDensityReason: "Returned by repair pass.",
            },
          ];

    return new Response(
      JSON.stringify({
        model: "gpt-test-scoring",
        output_text: JSON.stringify({ scores }),
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
    const ranked = await rankPostsWithOpenAI(posts, {
      apiKey: "sk-test",
      model: "gpt-test-scoring",
      now: new Date("2026-06-05T00:00:00.000Z"),
      onUsage: (record) => usageRecords.push(record),
    });

    const repairRequest = requests[1] as { input: Array<{ content: Array<{ text: string }> }> };
    const repairPosts = JSON.parse(repairRequest.input[1].content[0].text).posts;

    assert.equal(requests.length, 2);
    assert.deepEqual(repairPosts.map((post) => post.id), ["2"]);
    assert.deepEqual(usageRecords.map((record) => record.label), ["Scoring", "Scoring repair"]);
    assert.deepEqual(ranked.map((item) => item.post.id), ["2", "1"]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("rankPostsWithOpenAI fails when OpenAI omits an input post id", async () => {
  const originalFetch = globalThis.fetch;
  const posts = [
    testPost({ id: "1", text: "New benchmark shows a 37% inference cost reduction with routing." }),
    testPost({ id: "2", text: "Small observation: teams ship better when default paths are clear." }),
  ];
  const usageRecords = [];
  const progress = [];

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        model: "gpt-test-scoring",
        output_text: JSON.stringify({
          scores: [
            {
              id: "1",
              immediateValue: 9,
              immediateValueReason: "Returned by test model.",
              informationDensity: 9,
              informationDensityReason: "Returned by test model.",
            },
          ],
        }),
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          total_tokens: 150,
        },
      }),
      { status: 200 },
    );

  try {
    await assert.rejects(
      () =>
        rankPostsWithOpenAI(posts, {
          apiKey: "sk-test",
          model: "gpt-test-scoring",
          now: new Date("2026-06-05T00:00:00.000Z"),
          onUsage: (record) => usageRecords.push(record),
          onProgress: (record) => progress.push(record),
        }),
      /OpenAI scoring failed and no local fallback was used/,
    );

    assert.equal(usageRecords.length, 2);
    assert.equal(progress.at(-1)?.label, "Scoring failed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
