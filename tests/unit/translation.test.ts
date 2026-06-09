import assert from "node:assert/strict";
import { test } from "node:test";
import type { OpenAICacheRecord, OpenAICacheRepository } from "../../src/services/openai/cache.ts";
import { translatePosts } from "../../src/services/ai/translation.ts";
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

test("translatePosts requires OpenAI configuration", async () => {
  await assert.rejects(
    () =>
      translatePosts([
        testPost({
          id: "en",
          text: "New benchmark shows a 37% reduction in inference cost.",
        }),
      ]),
    /OpenAI API key and translation model are required/,
  );
});

test("translatePosts returns complete OpenAI translations", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        model: "gpt-test-translation",
        output_text: JSON.stringify({
          translations: [
            {
              id: "en",
              textZh: "新的基准显示推理成本降低了 37%。",
            },
            {
              id: "zh",
              textZh: "这条内容已经是中文，不需要额外翻译。",
            },
          ],
        }),
        usage: {
          input_tokens: 80,
          output_tokens: 40,
          total_tokens: 120,
        },
      }),
      { status: 200 },
    );

  try {
    const translations = await translatePosts(
      [
        testPost({
          id: "en",
          text: "New benchmark shows a 37% reduction in inference cost.",
        }),
        testPost({
          id: "zh",
          text: "这条内容已经是中文，不需要额外翻译。",
          language: "zh",
        }),
      ],
      {
        apiKey: "sk-test",
        model: "gpt-test-translation",
        now: new Date("2026-06-05T08:00:00.000Z"),
      },
    );

    assert.equal(translations.get("en")?.model, "gpt-test-translation");
    assert.equal(translations.get("en")?.textZh, "新的基准显示推理成本降低了 37%。");
    assert.equal(translations.get("zh")?.textZh, "这条内容已经是中文，不需要额外翻译。");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("translatePosts translates reposted source content instead of the retweet wrapper", async () => {
  const originalFetch = globalThis.fetch;
  const requests: unknown[] = [];

  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String((init as RequestInit).body)));

    return new Response(
      JSON.stringify({
        model: "gpt-test-translation",
        output_text: JSON.stringify({
          translations: [
            {
              id: "retweet-1",
              textZh: "原帖的完整中文翻译。",
            },
          ],
        }),
      }),
      { status: 200 },
    );
  };

  try {
    await translatePosts(
      [
        testPost({
          id: "retweet-1",
          text: "RT @source_author: Truncated wrapper…",
          author: { id: "reposter", name: "Reposter", username: "reposter" },
          referencedPostId: "source-1",
          referencedPostType: "retweeted",
          referencedPost: {
            id: "source-1",
            text: "The original source post has the complete claim and media context.",
            author: { id: "source", name: "Source Author", username: "source_author" },
            createdAt: "2026-06-05T08:00:00.000Z",
            url: "https://x.com/source_author/status/source-1",
            metrics: { likes: 42 },
            language: "en",
          },
        }),
      ],
      {
        apiKey: "sk-test",
        model: "gpt-test-translation",
        now: new Date("2026-06-05T08:00:00.000Z"),
      },
    );

    const request = requests[0] as { input: Array<{ content: Array<{ text: string }> }> };
    const prompt = request.input[1].content[0].text;

    assert.match(prompt, /The original source post has the complete claim/);
    assert.match(prompt, /reposted/);
    assert.doesNotMatch(prompt, /Truncated wrapper/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("translatePosts repairs missing OpenAI translations with the same model", async () => {
  const originalFetch = globalThis.fetch;
  const requests: unknown[] = [];
  const usageRecords = [];

  globalThis.fetch = async (_url, init) => {
    requests.push(JSON.parse(String((init as RequestInit).body)));

    const translations =
      requests.length === 1
        ? [
            {
              id: "en",
              textZh: "新的基准显示推理成本降低了 37%。",
            },
          ]
        : [
            {
              id: "zh",
              textZh: "这条内容已经是中文，不需要额外翻译。",
            },
          ];

    return new Response(
      JSON.stringify({
        model: "gpt-test-translation",
        output_text: JSON.stringify({ translations }),
        usage: {
          input_tokens: 80,
          output_tokens: 40,
          total_tokens: 120,
        },
      }),
      { status: 200 },
    );
  };

  try {
    const translations = await translatePosts(
      [
        testPost({
          id: "en",
          text: "New benchmark shows a 37% reduction in inference cost.",
        }),
        testPost({
          id: "zh",
          text: "这条内容已经是中文，不需要额外翻译。",
          language: "zh",
        }),
      ],
      {
        apiKey: "sk-test",
        model: "gpt-test-translation",
        now: new Date("2026-06-05T08:00:00.000Z"),
        onUsage: (record) => usageRecords.push(record),
      },
    );
    const repairRequest = requests[1] as { input: Array<{ content: Array<{ text: string }> }> };
    const repairPosts = JSON.parse(repairRequest.input[1].content[0].text).posts;

    assert.equal(requests.length, 2);
    assert.deepEqual(repairPosts.map((post) => post.id), ["zh"]);
    assert.deepEqual(usageRecords.map((record) => record.label), ["Translation", "Translation repair"]);
    assert.equal(translations.get("zh")?.textZh, "这条内容已经是中文，不需要额外翻译。");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("translatePosts reuses cached OpenAI translations", async () => {
  const originalFetch = globalThis.fetch;
  const cache = memoryOpenAICache();
  let requestCount = 0;
  const post = testPost({
    id: "en",
    text: "New benchmark shows a 37% reduction in inference cost.",
  });

  globalThis.fetch = async () => {
    requestCount += 1;

    return new Response(
      JSON.stringify({
        model: "gpt-test-translation",
        output_text: JSON.stringify({
          translations: [
            {
              id: "en",
              textZh: "新的基准显示推理成本降低了 37%。",
            },
          ],
        }),
        usage: {
          input_tokens: 80,
          output_tokens: 40,
          total_tokens: 120,
        },
      }),
      { status: 200 },
    );
  };

  try {
    await translatePosts([post], {
      apiKey: "sk-test",
      model: "gpt-test-translation",
      cache,
      now: new Date("2026-06-05T08:00:00.000Z"),
    });
    const translations = await translatePosts([post], {
      apiKey: "sk-test",
      model: "gpt-test-translation",
      cache,
      now: new Date("2026-06-05T08:01:00.000Z"),
    });

    assert.equal(requestCount, 1);
    assert.equal(translations.get("en")?.textZh, "新的基准显示推理成本降低了 37%。");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("translatePosts fails when OpenAI omits an input post id", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        model: "gpt-test-translation",
        output_text: JSON.stringify({
          translations: [
            {
              id: "en",
              textZh: "新的基准显示推理成本降低了 37%。",
            },
          ],
        }),
        usage: {
          input_tokens: 80,
          output_tokens: 40,
          total_tokens: 120,
        },
      }),
      { status: 200 },
    );

  try {
    await assert.rejects(
      () =>
        translatePosts(
          [
            testPost({
              id: "en",
              text: "New benchmark shows a 37% reduction in inference cost.",
            }),
            testPost({
              id: "zh",
              text: "这条内容已经是中文，不需要额外翻译。",
              language: "zh",
            }),
          ],
          {
            apiKey: "sk-test",
            model: "gpt-test-translation",
            now: new Date("2026-06-05T08:00:00.000Z"),
          },
        ),
      /OpenAI translation failed and no local fallback was used/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
