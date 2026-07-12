import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchTextWithTimeout } from "../../src/services/http/fetchWithTimeout.ts";

test("fetchTextWithTimeout aborts a stalled external request with a named timeout", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (_input, init) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    });

  try {
    await assert.rejects(
      () => fetchTextWithTimeout("https://api.x.com/stalled", {}, { label: "X test request", timeoutMs: 5 }),
      /X test request timed out after 5 ms/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
