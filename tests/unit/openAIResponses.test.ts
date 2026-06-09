import assert from "node:assert/strict";
import { test } from "node:test";
import { callOpenAIJson } from "../../src/services/openai/responses.ts";

test("callOpenAIJson reports request timeout clearly", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (_url, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        reject(new DOMException("This operation was aborted", "AbortError"));
      });
    });

  try {
    await assert.rejects(
      callOpenAIJson({
        apiKey: "sk-test",
        model: "gpt-test",
        system: "Return JSON.",
        user: "Return JSON.",
        schemaName: "test_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["ok"],
          properties: {
            ok: { type: "boolean" },
          },
        },
        timeoutMs: 5,
      }),
      /OpenAI request timed out after 5ms\./,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("callOpenAIJson reports fetch failures with their cause", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;
    throw new TypeError("fetch failed", { cause: new Error("socket closed") });
  };

  try {
    await assert.rejects(
      callOpenAIJson({
        apiKey: "sk-test",
        model: "gpt-test",
        system: "Return JSON.",
        user: "Return JSON.",
        schemaName: "test_schema",
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["ok"],
          properties: {
            ok: { type: "boolean" },
          },
        },
        maxAttempts: 2,
        retryDelayMs: 0,
      }),
      /OpenAI request failed before response: fetch failed\. Cause: socket closed/,
    );
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("callOpenAIJson retries transient fetch failures before a response exists", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;

  globalThis.fetch = async () => {
    calls += 1;

    if (calls === 1) {
      throw new TypeError("fetch failed", { cause: new Error("connect timeout") });
    }

    return new Response(
      JSON.stringify({
        model: "gpt-test",
        output_text: JSON.stringify({ ok: true }),
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          total_tokens: 2,
        },
      }),
      { status: 200 },
    );
  };

  try {
    const result = await callOpenAIJson<{ ok: boolean }>({
      apiKey: "sk-test",
      model: "gpt-test",
      system: "Return JSON.",
      user: "Return JSON.",
      schemaName: "test_schema",
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["ok"],
        properties: {
          ok: { type: "boolean" },
        },
      },
      retryDelayMs: 0,
    });

    assert.equal(calls, 2);
    assert.equal(result.data.ok, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
