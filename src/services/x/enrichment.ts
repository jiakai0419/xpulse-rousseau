import type { ReferencedPost, TimelinePost, UsageRecord } from "../../domain/tweet.ts";
import { DEFAULT_X_REQUEST_TIMEOUT_MS, fetchTextWithTimeout } from "../http/fetchWithTimeout.ts";
import type { XTimelineResponse } from "./apiTypes.ts";
import {
  X_READER_EXPANSIONS,
  X_READER_MEDIA_FIELDS,
  X_READER_TWEET_FIELDS,
  X_READER_USER_FIELDS,
  X_TWEET_LOOKUP_ENDPOINT,
} from "./fieldProfile.ts";
import { attachReferencedPosts, collectMissingReferencedIds, indexesFromPayload, referencedPostFromPost } from "./normalize.ts";
import { rateLimitFromResponse } from "./rateLimit.ts";
import type { XRawTimelineSnapshot } from "./rawSnapshotStore.ts";

export type XLookupEnrichmentOptions = {
  accessToken: string;
  requestTimeoutMs?: number;
  onRawSnapshot?: (snapshot: XRawTimelineSnapshot) => void | Promise<void>;
  onUsage?: (usage: UsageRecord) => void;
};

export function buildTweetLookupUrl(ids: string[]): URL {
  const url = new URL("https://api.x.com/2/tweets");

  url.searchParams.set("ids", ids.join(","));
  url.searchParams.set("expansions", X_READER_EXPANSIONS);
  url.searchParams.set("tweet.fields", X_READER_TWEET_FIELDS);
  url.searchParams.set("user.fields", X_READER_USER_FIELDS);
  url.searchParams.set("media.fields", X_READER_MEDIA_FIELDS);

  return url;
}

async function fetchTweetLookupBatch(options: XLookupEnrichmentOptions, ids: string[], page: number): Promise<{
  referencedPostsById: Map<string, ReferencedPost>;
  rateLimit?: UsageRecord["rateLimit"];
}> {
  const url = buildTweetLookupUrl(ids);
  const { response, text: responseText } = await fetchTextWithTimeout(
    url,
    {
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
      },
    },
    {
      label: "X tweet lookup request",
      timeoutMs: options.requestTimeoutMs ?? DEFAULT_X_REQUEST_TIMEOUT_MS,
    },
  );
  let payload: XTimelineResponse | { raw: string } = {};

  try {
    payload = responseText ? JSON.parse(responseText) as XTimelineResponse : {};
  } catch {
    payload = { raw: responseText };
  }

  const rateLimit = rateLimitFromResponse(response);

  await options.onRawSnapshot?.({
    id: `xraw_${Date.now()}_lookup_${page}`,
    createdAt: new Date().toISOString(),
    endpoint: X_TWEET_LOOKUP_ENDPOINT,
    query: Object.fromEntries(url.searchParams.entries()),
    page,
    mode: "lookup",
    status: response.status,
    rateLimit,
    payload,
  });

  if (!response.ok) {
    throw new Error(`X tweet lookup request failed with ${response.status}: ${responseText}`);
  }

  if (!("data" in payload) && !("includes" in payload)) {
    return { referencedPostsById: new Map(), rateLimit };
  }

  const typedPayload = payload as XTimelineResponse;
  const indexes = indexesFromPayload(typedPayload);
  const referencedPostsById = new Map(
    (typedPayload.data ?? []).map((post) => [post.id, referencedPostFromPost(post, indexes)]),
  );

  return { referencedPostsById, rateLimit };
}

export async function enrichMissingReferencedPosts(options: XLookupEnrichmentOptions, posts: TimelinePost[]): Promise<void> {
  const requestedIds = new Set<string>();
  let requestCount = 0;
  let failedRequestCount = 0;
  let latestRateLimit: UsageRecord["rateLimit"];
  let attachedCount = 0;
  const requestedItemIds: string[] = [];

  try {
    for (let depth = 0; depth < 3; depth += 1) {
      const missingIds = collectMissingReferencedIds(posts).filter((id) => !requestedIds.has(id));

      if (!missingIds.length) {
        break;
      }

      for (let index = 0; index < missingIds.length; index += 100) {
        const ids = missingIds.slice(index, index + 100);

        ids.forEach((id) => requestedIds.add(id));
        requestedItemIds.push(...ids);
        requestCount += 1;

        try {
          const page = await fetchTweetLookupBatch(options, ids, requestCount);
          latestRateLimit = page.rateLimit;
          attachedCount += attachReferencedPosts(posts, page.referencedPostsById);
        } catch (error) {
          failedRequestCount += 1;
          throw error;
        }
      }
    }
  } finally {
    if (requestCount) {
      options.onUsage?.({
        provider: "x",
        operation: "x.lookup",
        label: "X tweet lookup",
        method: "GET",
        endpoint: X_TWEET_LOOKUP_ENDPOINT,
        itemCount: attachedCount,
        itemIds: requestedItemIds,
        requestCount,
        failedRequestCount: failedRequestCount || undefined,
        rateLimit: latestRateLimit,
        createdAt: new Date().toISOString(),
      });
    }
  }
}
