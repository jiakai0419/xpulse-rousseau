import type { Author } from "../../domain/tweet.ts";
import { buildXOAuthConfig, getFreshStoredXTokens, tokenNeedsRefresh } from "./oauth.ts";
import type { XStoredTokens, XTokenStore } from "./tokenStore.ts";

export type XActiveSourceIdentity =
  | { source: "oauth"; user: Author }
  | { source: "manual"; userId: string };

export type XResolvedCredentials = {
  source: XActiveSourceIdentity["source"];
  userId: string;
  accessToken: string;
  identity: XActiveSourceIdentity;
};

export function manualXCredentials(env: Record<string, string | undefined>): XResolvedCredentials | undefined {
  if (!env.X_USER_ID || !env.X_USER_ACCESS_TOKEN) {
    return undefined;
  }

  return {
    source: "manual",
    userId: env.X_USER_ID,
    accessToken: env.X_USER_ACCESS_TOKEN,
    identity: { source: "manual", userId: env.X_USER_ID },
  };
}

export function oauthXCredentials(tokens: XStoredTokens | undefined): XResolvedCredentials | undefined {
  if (!tokens?.accessToken || !tokens.user?.id) {
    return undefined;
  }

  return {
    source: "oauth",
    userId: tokens.user.id,
    accessToken: tokens.accessToken,
    identity: { source: "oauth", user: tokens.user },
  };
}

function oauthIdentityCanRemainActive(
  env: Record<string, string | undefined>,
  tokens: XStoredTokens,
): boolean {
  // Tokens without an expiry are stable. Expiring identities are stable only when
  // this process has everything needed to refresh them without changing accounts.
  return !tokens.expiresAt || Boolean(tokens.refreshToken && env.X_CLIENT_ID);
}

export function resolveXCredentials(
  env: Record<string, string | undefined>,
  tokens: XStoredTokens | undefined,
  now = new Date(),
): XResolvedCredentials | undefined {
  const oauth = oauthXCredentials(tokens);
  const manual = manualXCredentials(env);

  if (oauth && oauthIdentityCanRemainActive(env, tokens!)) {
    return oauth;
  }

  if (manual) {
    return manual;
  }

  return oauth && !tokenNeedsRefresh(tokens!, now) ? oauth : undefined;
}

export async function resolveFreshXCredentials(
  env: Record<string, string | undefined>,
  store: XTokenStore | undefined,
  now = new Date(),
): Promise<XResolvedCredentials | undefined> {
  const manual = manualXCredentials(env);

  if (!store) {
    return manual;
  }

  let tokens: XStoredTokens | undefined;

  try {
    tokens = await store.get();
  } catch (error) {
    if (manual) {
      return manual;
    }

    throw error;
  }

  const oauth = oauthXCredentials(tokens);

  if (oauth && oauthIdentityCanRemainActive(env, tokens!)) {
    if (!tokenNeedsRefresh(tokens!, now)) {
      return oauth;
    }

    const refreshed = await getFreshStoredXTokens(store, buildXOAuthConfig(env), now);
    return oauthXCredentials(refreshed);
  }

  // An OAuth identity that will expire but cannot be refreshed is never advertised
  // ahead of a manual identity, even while its current token still has time left.
  // That keeps account selection stable for the lifetime of an open Reader page.
  if (manual) {
    return manual;
  }

  return oauth && !tokenNeedsRefresh(tokens!, now) ? oauth : undefined;
}
