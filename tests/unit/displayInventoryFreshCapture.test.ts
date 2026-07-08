import assert from "node:assert/strict";
import { test } from "node:test";
import {
  captureFreshDisplayInventoryRun,
  freshCaptureTokensFromEnv,
  resolveFreshCaptureTokens,
} from "../../scripts/display-inventory-fresh-capture.mjs";

function post(id: string) {
  return {
    id,
    text: `Post ${id}`,
    author: { id: "author", name: "Author", username: "author" },
    createdAt: "2026-06-10T00:00:00.000Z",
    url: `https://x.com/author/status/${id}`,
    metrics: {},
    seenBy: [],
  };
}

test("fresh capture tokens use env only when both user id and access token are present", () => {
  assert.deepEqual(
    freshCaptureTokensFromEnv({
      X_USER_ID: "user-1",
      X_USER_ACCESS_TOKEN: "access-1",
    }),
    { userId: "user-1", accessToken: "access-1", source: "env" },
  );
  assert.equal(freshCaptureTokensFromEnv({ X_USER_ID: "user-1" }), undefined);
  assert.equal(freshCaptureTokensFromEnv({ X_USER_ACCESS_TOKEN: "access-1" }), undefined);
});

test("resolveFreshCaptureTokens prefers explicit env tokens over stored OAuth tokens", async () => {
  let getStoredTokensCalled = false;

  const tokens = await resolveFreshCaptureTokens({
    env: {
      X_USER_ID: "env-user",
      X_USER_ACCESS_TOKEN: "env-access",
    },
    getStoredTokens: async () => {
      getStoredTokensCalled = true;
      return { user: { id: "stored-user" }, accessToken: "stored-access" };
    },
  });

  assert.equal(getStoredTokensCalled, false);
  assert.deepEqual(tokens, { userId: "env-user", accessToken: "env-access", source: "env" });
});

test("resolveFreshCaptureTokens falls back to stored OAuth tokens", async () => {
  let receivedTokenStore: unknown;
  let receivedConfig: unknown;

  const tokens = await resolveFreshCaptureTokens({
    env: {
      X_USER_ID: "partial-env-user",
      X_CLIENT_ID: "client-id",
    },
    tokenStore: { kind: "token-store" },
    buildOAuthConfig: (env: any) => ({ clientId: env.X_CLIENT_ID }),
    getStoredTokens: async (tokenStore: unknown, config: unknown) => {
      receivedTokenStore = tokenStore;
      receivedConfig = config;
      return { user: { id: "stored-user" }, accessToken: "stored-access" };
    },
  });

  assert.deepEqual(receivedTokenStore, { kind: "token-store" });
  assert.deepEqual(receivedConfig, { clientId: "client-id" });
  assert.deepEqual(tokens, { userId: "stored-user", accessToken: "stored-access", source: "stored-oauth" });
});

test("fresh capture is a no-op when disabled", async () => {
  let fetchCalled = false;
  const result = await captureFreshDisplayInventoryRun({
    includeFresh: false,
    fetchTimeline: async () => {
      fetchCalled = true;
      return [];
    },
  });

  assert.equal(fetchCalled, false);
  assert.deepEqual(result, { rawSnapshots: [], usage: [] });
});

test("fresh capture fetches timeline posts, raw snapshots, usage, and no-OpenAI inventory run", async () => {
  let fetchOptions: any;
  const result = await captureFreshDisplayInventoryRun({
    includeFresh: true,
    env: {
      X_USER_ID: "env-user",
      X_USER_ACCESS_TOKEN: "env-access",
    },
    freshTarget: 42,
    freshMaxPages: 3,
    createdAt: "2026-06-10T00:00:00.000Z",
    fetchTimeline: async (options: any) => {
      fetchOptions = options;
      options.onRawSnapshot({ page: 1 });
      options.onUsage({ provider: "x", operation: "home_timeline", count: 1 });
      return [post("post-1"), post("post-2")];
    },
  });

  assert.equal(fetchOptions.userId, "env-user");
  assert.equal(fetchOptions.accessToken, "env-access");
  assert.equal(fetchOptions.maxResults, 100);
  assert.equal(fetchOptions.targetResults, 42);
  assert.equal(fetchOptions.maxPages, 3);
  assert.deepEqual(result.rawSnapshots, [{ page: 1 }]);
  assert.deepEqual(result.usage, [{ provider: "x", operation: "home_timeline", count: 1 }]);
  assert.equal(result.run.id, `inventory_fresh_${Date.parse("2026-06-10T00:00:00.000Z")}`);
  assert.equal(result.run.source, "x");
  assert.equal(result.run.stats.fetched, 2);
  assert.equal(result.run.trace.config.configuredModels.scoring, "inventory-no-openai");
  assert.deepEqual(result.run.usage, result.usage);
});

test("fresh capture keeps default fetch limits when callers omit them", async () => {
  let fetchOptions: any;

  await captureFreshDisplayInventoryRun({
    includeFresh: true,
    env: {
      X_USER_ID: "env-user",
      X_USER_ACCESS_TOKEN: "env-access",
    },
    fetchTimeline: async (options: any) => {
      fetchOptions = options;
      return [];
    },
  });

  assert.equal(fetchOptions.maxResults, 100);
  assert.equal(fetchOptions.targetResults, 100);
  assert.equal(fetchOptions.maxPages, 5);
});

test("fresh capture fails clearly when no usable X token exists", async () => {
  await assert.rejects(
    () =>
      captureFreshDisplayInventoryRun({
        includeFresh: true,
        env: {},
        buildOAuthConfig: () => ({}),
        getStoredTokens: async () => undefined,
        fetchTimeline: async () => [],
      }),
    /Display inventory fresh capture needs connected X OAuth tokens/,
  );
});
