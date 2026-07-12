import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveFreshXCredentials, resolveXCredentials } from "../../src/services/x/sourceCredentials.ts";

test("resolveXCredentials uses complete manual credentials as a fallback", () => {
  const credentials = resolveXCredentials(
    { X_USER_ID: "manual-user", X_USER_ACCESS_TOKEN: "manual-token" },
    undefined,
  );

  assert.equal(credentials?.source, "manual");
  assert.equal(credentials?.userId, "manual-user");
  assert.deepEqual(credentials?.identity, { source: "manual", userId: "manual-user" });
});

test("resolveXCredentials gives stored OAuth identity precedence over manual credentials", () => {
  const credentials = resolveXCredentials(
    { X_USER_ID: "manual-user", X_USER_ACCESS_TOKEN: "manual-token" },
    {
      accessToken: "oauth-token",
      savedAt: "2026-06-05T00:00:00.000Z",
      user: { id: "oauth-user", name: "OAuth User", username: "oauth_user" },
    },
  );

  assert.equal(credentials?.source, "oauth");
  assert.equal(credentials?.userId, "oauth-user");
  assert.equal(credentials?.accessToken, "oauth-token");
  assert.deepEqual(credentials?.identity, {
    source: "oauth",
    user: { id: "oauth-user", name: "OAuth User", username: "oauth_user" },
  });
});

test("resolveXCredentials selects manual consistently when expiring OAuth cannot refresh", () => {
  const credentials = resolveXCredentials(
    {
      X_USER_ID: "manual-user",
      X_USER_ACCESS_TOKEN: "manual-token",
    },
    {
      accessToken: "expiring-oauth-token",
      expiresAt: "2026-06-05T01:00:00.000Z",
      savedAt: "2026-06-04T23:00:00.000Z",
      user: { id: "oauth-user", name: "OAuth User", username: "oauth_user" },
    },
    new Date("2026-06-05T00:00:00.000Z"),
  );

  assert.equal(credentials?.source, "manual");
  assert.equal(credentials?.userId, "manual-user");
});

test("resolveFreshXCredentials does not switch from manual to non-refreshable OAuth", async () => {
  let saveCalled = false;
  const credentials = await resolveFreshXCredentials(
    {
      X_USER_ID: "manual-user",
      X_USER_ACCESS_TOKEN: "manual-token",
    },
    {
      async get() {
        return {
          accessToken: "expiring-oauth-token",
          expiresAt: "2026-06-05T01:00:00.000Z",
          savedAt: "2026-06-04T23:00:00.000Z",
          user: { id: "oauth-user", name: "OAuth User", username: "oauth_user" },
        };
      },
      async save() {
        saveCalled = true;
      },
      async clear() {},
    },
    new Date("2026-06-05T00:00:00.000Z"),
  );

  assert.equal(credentials?.source, "manual");
  assert.equal(saveCalled, false);
});

test("refresh-capable OAuth stays the selected identity instead of falling back to manual", async () => {
  const originalFetch = globalThis.fetch;
  const tokens = {
    accessToken: "expiring-oauth-token",
    refreshToken: "refresh-token",
    expiresAt: "2026-06-05T00:00:30.000Z",
    savedAt: "2026-06-04T23:00:00.000Z",
    user: { id: "oauth-user", name: "OAuth User", username: "oauth_user" },
  };
  const env = {
    X_CLIENT_ID: "client-1",
    X_USER_ID: "manual-user",
    X_USER_ACCESS_TOKEN: "manual-token",
  };

  globalThis.fetch = async () => new Response("refresh unavailable", { status: 503 });

  try {
    assert.equal(resolveXCredentials(env, tokens, new Date("2026-06-05T00:00:00.000Z"))?.source, "oauth");
    await assert.rejects(
      resolveFreshXCredentials(
        env,
        {
          async get() {
            return tokens;
          },
          async save() {},
          async clear() {},
        },
        new Date("2026-06-05T00:00:00.000Z"),
      ),
      /X OAuth token request failed with 503/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("resolveFreshXCredentials can use manual credentials when the OAuth store is unreadable", async () => {
  const credentials = await resolveFreshXCredentials(
    { X_USER_ID: "manual-user", X_USER_ACCESS_TOKEN: "manual-token" },
    {
      async get() {
        throw new Error("token store unreadable");
      },
      async save() {},
      async clear() {},
    },
  );

  assert.equal(credentials?.source, "manual");
});

test("resolveXCredentials reports expiring OAuth ready only when it can refresh", () => {
  const tokens = {
    accessToken: "expiring-oauth-token",
    refreshToken: "refresh-token",
    expiresAt: "2026-06-05T00:00:30.000Z",
    savedAt: "2026-06-04T23:00:00.000Z",
    user: { id: "oauth-user", name: "OAuth User", username: "oauth_user" },
  };
  const now = new Date("2026-06-05T00:00:00.000Z");

  assert.equal(resolveXCredentials({ X_CLIENT_ID: "client-1" }, tokens, now)?.source, "oauth");
  assert.equal(resolveXCredentials({}, tokens, now), undefined);
});
