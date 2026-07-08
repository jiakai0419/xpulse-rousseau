import { fetchHomeTimeline } from "../src/services/x/client.ts";
import { buildXOAuthConfig, getFreshStoredXTokens } from "../src/services/x/oauth.ts";
import { FileXTokenStore } from "../src/services/x/tokenStore.ts";
import { inventoryRunFromPosts } from "./display-gap-inventory-core.mjs";

export function freshCaptureTokensFromEnv(env = {}) {
  const userId = env.X_USER_ID;
  const accessToken = env.X_USER_ACCESS_TOKEN;

  return userId && accessToken ? { userId, accessToken, source: "env" } : undefined;
}

export async function resolveFreshCaptureTokens(options = {}) {
  const env = options.env ?? process.env;
  const envTokens = freshCaptureTokensFromEnv(env);
  if (envTokens) {
    return envTokens;
  }

  const tokenStore = options.tokenStore ?? new FileXTokenStore();
  const buildOAuthConfig = options.buildOAuthConfig ?? buildXOAuthConfig;
  const getStoredTokens = options.getStoredTokens ?? getFreshStoredXTokens;
  const tokens = await getStoredTokens(tokenStore, buildOAuthConfig(env));
  const userId = tokens?.user?.id;
  const accessToken = tokens?.accessToken;

  return userId && accessToken ? { userId, accessToken, source: "stored-oauth" } : undefined;
}

export async function captureFreshDisplayInventoryRun(options = {}) {
  if (!options.includeFresh) {
    return { rawSnapshots: [], usage: [] };
  }

  const tokenPair = await resolveFreshCaptureTokens(options);
  if (!tokenPair) {
    throw new Error("Display inventory fresh capture needs connected X OAuth tokens or X_USER_ID/X_USER_ACCESS_TOKEN.");
  }

  const rawSnapshots = [];
  const usage = [];
  const fetchTimeline = options.fetchTimeline ?? fetchHomeTimeline;
  const buildInventoryRun = options.buildInventoryRun ?? inventoryRunFromPosts;
  const posts = await fetchTimeline({
    userId: tokenPair.userId,
    accessToken: tokenPair.accessToken,
    maxResults: options.maxResults ?? 100,
    targetResults: options.freshTarget ?? 100,
    maxPages: options.freshMaxPages ?? 5,
    onRawSnapshot: (snapshot) => {
      rawSnapshots.push(snapshot);
    },
    onUsage: (record) => {
      usage.push(record);
    },
  });

  const run = buildInventoryRun(posts, options.createdAt ?? new Date().toISOString());
  run.usage = usage;

  return { run, rawSnapshots, usage };
}
