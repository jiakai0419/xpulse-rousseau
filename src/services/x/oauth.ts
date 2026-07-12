import crypto from "node:crypto";
import type { Author } from "../../domain/tweet.ts";
import { DEFAULT_X_REQUEST_TIMEOUT_MS, fetchTextWithTimeout, requestTimeoutMs } from "../http/fetchWithTimeout.ts";
import { fetchAuthenticatedUser } from "./client.ts";
import type { XStoredTokens, XTokenStore } from "./tokenStore.ts";

export type XOAuthConfig = {
  clientId?: string;
  clientSecret?: string;
  redirectUri: string;
  scopes: string[];
  authorizeUrl: string;
  tokenUrl: string;
  requestTimeoutMs: number;
};

export type XOAuthStart = {
  authorizationUrl: string;
  state: string;
  codeVerifier: string;
  redirectUri: string;
  createdAt: number;
};

type XTokenResponse = {
  access_token: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
};

export type PendingOAuthStore = Map<string, XOAuthStart>;

const DEFAULT_SCOPES = ["tweet.read", "users.read", "offline.access"];
const DEFAULT_AUTHORIZE_URL = "https://x.com/i/oauth2/authorize";
const DEFAULT_TOKEN_URL = "https://api.x.com/2/oauth2/token";

export function buildXOAuthConfig(env: Record<string, string | undefined>, origin = "http://127.0.0.1:3000"): XOAuthConfig {
  const redirectUri = env.X_REDIRECT_URI ?? `${origin}/api/auth/x/callback`;
  const scopes = (env.X_OAUTH_SCOPES ?? DEFAULT_SCOPES.join(" "))
    .split(/\s+/)
    .map((scope) => scope.trim())
    .filter(Boolean);

  return {
    clientId: env.X_CLIENT_ID,
    clientSecret: env.X_CLIENT_SECRET,
    redirectUri,
    scopes,
    authorizeUrl: env.X_AUTHORIZE_URL ?? DEFAULT_AUTHORIZE_URL,
    tokenUrl: env.X_TOKEN_URL ?? DEFAULT_TOKEN_URL,
    requestTimeoutMs: requestTimeoutMs(env.X_REQUEST_TIMEOUT_MS, DEFAULT_X_REQUEST_TIMEOUT_MS),
  };
}

export function base64Url(buffer: Buffer): string {
  return buffer.toString("base64url");
}

export function createCodeVerifier(): string {
  return base64Url(crypto.randomBytes(64));
}

export function createCodeChallenge(codeVerifier: string): string {
  return base64Url(crypto.createHash("sha256").update(codeVerifier).digest());
}

export function createOAuthState(): string {
  return base64Url(crypto.randomBytes(32));
}

export function buildAuthorizationUrl(config: XOAuthConfig, state: string, codeVerifier: string): string {
  if (!config.clientId) {
    throw new Error("X_CLIENT_ID is required to start X OAuth.");
  }

  const url = new URL(config.authorizeUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("scope", config.scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", createCodeChallenge(codeVerifier));
  url.searchParams.set("code_challenge_method", "S256");

  return url.toString();
}

export function createOAuthStart(config: XOAuthConfig, now = Date.now()): XOAuthStart {
  const state = createOAuthState();
  const codeVerifier = createCodeVerifier();

  return {
    state,
    codeVerifier,
    redirectUri: config.redirectUri,
    authorizationUrl: buildAuthorizationUrl(config, state, codeVerifier),
    createdAt: now,
  };
}

function createTokenHeaders(config: XOAuthConfig): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  if (config.clientId && config.clientSecret) {
    headers.Authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")}`;
  }

  return headers;
}

function tokensFromResponse(response: XTokenResponse, user?: Author, now = new Date()): XStoredTokens {
  const expiresAt = response.expires_in ? new Date(now.getTime() + response.expires_in * 1000).toISOString() : undefined;

  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token,
    tokenType: response.token_type,
    scope: response.scope,
    expiresAt,
    savedAt: now.toISOString(),
    user,
  };
}

async function postTokenForm(config: XOAuthConfig, form: URLSearchParams): Promise<XTokenResponse> {
  if (!config.clientId) {
    throw new Error("X_CLIENT_ID is required for X OAuth token requests.");
  }

  if (!form.has("client_id")) {
    form.set("client_id", config.clientId);
  }

  const { response, text: responseText } = await fetchTextWithTimeout(
    config.tokenUrl,
    {
      method: "POST",
      headers: createTokenHeaders(config),
      body: form,
    },
    { label: "X OAuth token request", timeoutMs: config.requestTimeoutMs },
  );

  if (!response.ok) {
    throw new Error(`X OAuth token request failed with ${response.status}: ${responseText}`);
  }

  return JSON.parse(responseText) as XTokenResponse;
}

export async function exchangeAuthorizationCode(config: XOAuthConfig, code: string, codeVerifier: string, redirectUri: string): Promise<XStoredTokens> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier,
  });

  const tokenResponse = await postTokenForm(config, form);
  const user = await fetchAuthenticatedUser(tokenResponse.access_token, config.requestTimeoutMs);

  return tokensFromResponse(tokenResponse, user);
}

export async function refreshXTokens(config: XOAuthConfig, refreshToken: string, previousUser?: Author): Promise<XStoredTokens> {
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });

  const tokenResponse = await postTokenForm(config, form);
  let user = previousUser;

  try {
    user = await fetchAuthenticatedUser(tokenResponse.access_token, config.requestTimeoutMs);
  } catch {
    user = previousUser;
  }

  const tokens = tokensFromResponse(tokenResponse, user);
  return {
    ...tokens,
    refreshToken: tokens.refreshToken ?? refreshToken,
  };
}

export function tokenNeedsRefresh(tokens: XStoredTokens, now = new Date()): boolean {
  if (!tokens.expiresAt) {
    return false;
  }

  return Date.parse(tokens.expiresAt) <= now.getTime() + 60_000;
}

export async function getFreshStoredXTokens(store: XTokenStore, config: XOAuthConfig, now = new Date()): Promise<XStoredTokens | undefined> {
  const tokens = await store.get();

  if (!tokens) {
    return undefined;
  }

  if (!tokenNeedsRefresh(tokens, now)) {
    return tokens;
  }

  if (!tokens.refreshToken) {
    throw new Error("Stored X access token is expired and no refresh token is available. Reconnect X.");
  }

  const refreshed = await refreshXTokens(config, tokens.refreshToken, tokens.user);
  await store.save(refreshed);
  return refreshed;
}
