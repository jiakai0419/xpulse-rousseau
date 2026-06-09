import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildAuthorizationUrl,
  buildXOAuthConfig,
  createCodeChallenge,
  createCodeVerifier,
  tokenNeedsRefresh,
} from "../../src/services/x/oauth.ts";

test("buildXOAuthConfig uses local callback and minimal read scopes by default", () => {
  const config = buildXOAuthConfig({ X_CLIENT_ID: "client-1" }, "http://127.0.0.1:3000");

  assert.equal(config.redirectUri, "http://127.0.0.1:3000/api/auth/x/callback");
  assert.deepEqual(config.scopes, ["tweet.read", "users.read", "offline.access"]);
});

test("createCodeVerifier and createCodeChallenge produce URL-safe PKCE values", () => {
  const verifier = createCodeVerifier();
  const challenge = createCodeChallenge(verifier);

  assert.equal(/^[A-Za-z0-9_-]+$/.test(verifier), true);
  assert.equal(/^[A-Za-z0-9_-]+$/.test(challenge), true);
  assert.equal(challenge.length, 43);
});

test("buildAuthorizationUrl produces X OAuth authorize URL", () => {
  const config = buildXOAuthConfig({
    X_CLIENT_ID: "client-1",
    X_REDIRECT_URI: "http://127.0.0.1:3000/api/auth/x/callback",
  });
  const url = new URL(buildAuthorizationUrl(config, "state-1", "verifier-1"));

  assert.equal(url.origin + url.pathname, "https://x.com/i/oauth2/authorize");
  assert.equal(url.searchParams.get("response_type"), "code");
  assert.equal(url.searchParams.get("client_id"), "client-1");
  assert.equal(url.searchParams.get("state"), "state-1");
  assert.equal(url.searchParams.get("code_challenge_method"), "S256");
  assert.equal(url.searchParams.get("scope"), "tweet.read users.read offline.access");
});

test("tokenNeedsRefresh refreshes tokens within one minute of expiry", () => {
  const now = new Date("2026-06-04T09:00:00.000Z");

  assert.equal(
    tokenNeedsRefresh({
      accessToken: "token",
      expiresAt: "2026-06-04T09:00:30.000Z",
      savedAt: now.toISOString(),
    }, now),
    true,
  );

  assert.equal(
    tokenNeedsRefresh({
      accessToken: "token",
      expiresAt: "2026-06-04T09:05:00.000Z",
      savedAt: now.toISOString(),
    }, now),
    false,
  );
});
