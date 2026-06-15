import type { Author, TimelinePost, UsageRecord } from "../../domain/tweet.ts";
import type { XMeResponse, XTimelineResponse } from "./apiTypes.ts";
import { enrichMissingReferencedPosts } from "./enrichment.ts";
import {
  X_READER_EXPANSIONS,
  X_READER_MEDIA_FIELDS,
  X_READER_TWEET_FIELDS,
  X_READER_USER_FIELDS,
  X_TIMELINE_ENDPOINT,
} from "./fieldProfile.ts";
import { postsFromPayload, uniquePosts } from "./normalize.ts";
import { rateLimitFromResponse } from "./rateLimit.ts";
import type { XRawTimelineSnapshot } from "./rawSnapshotStore.ts";

export type XTimelineClientOptions = {
  userId: string;
  accessToken: string;
  maxResults?: number;
  targetResults?: number;
  maxPages?: number;
  sinceId?: string;
  onRawSnapshot?: (snapshot: XRawTimelineSnapshot) => void | Promise<void>;
  onUsage?: (usage: UsageRecord) => void;
};

function buildTimelineUrl(options: XTimelineClientOptions, params: { maxResults: number; sinceId?: string; paginationToken?: string }): URL {
  const url = new URL(`https://api.x.com/2/users/${options.userId}/timelines/reverse_chronological`);

  url.searchParams.set("max_results", String(params.maxResults));
  url.searchParams.set("exclude", "replies");
  url.searchParams.set("expansions", X_READER_EXPANSIONS);
  url.searchParams.set("tweet.fields", X_READER_TWEET_FIELDS);
  url.searchParams.set("user.fields", X_READER_USER_FIELDS);
  url.searchParams.set("media.fields", X_READER_MEDIA_FIELDS);

  if (params.sinceId) {
    url.searchParams.set("since_id", params.sinceId);
  }

  if (params.paginationToken) {
    url.searchParams.set("pagination_token", params.paginationToken);
  }

  return url;
}

async function fetchTimelinePage(options: XTimelineClientOptions, params: {
  maxResults: number;
  sinceId?: string;
  paginationToken?: string;
  page: number;
  mode: "newer" | "baseline";
}): Promise<{ posts: TimelinePost[]; nextToken?: string; rateLimit?: UsageRecord["rateLimit"]; status: number }> {
  const url = buildTimelineUrl(options, params);

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${options.accessToken}`,
    },
  });
  const responseText = await response.text();
  let payload: XTimelineResponse | { raw: string } = {};

  try {
    payload = responseText ? JSON.parse(responseText) as XTimelineResponse : {};
  } catch {
    payload = { raw: responseText };
  }
  const rateLimit = rateLimitFromResponse(response);

  await options.onRawSnapshot?.({
    id: `xraw_${Date.now()}_${params.mode}_${params.page}`,
    createdAt: new Date().toISOString(),
    endpoint: X_TIMELINE_ENDPOINT,
    query: Object.fromEntries(url.searchParams.entries()),
    page: params.page,
    mode: params.mode,
    status: response.status,
    rateLimit,
    payload,
  });

  if (!response.ok) {
    throw new Error(`X timeline request failed with ${response.status}: ${responseText}`);
  }

  return {
    posts: "data" in payload || "includes" in payload || "meta" in payload ? postsFromPayload(payload as XTimelineResponse) : [],
    nextToken: "meta" in payload ? payload.meta?.next_token : undefined,
    rateLimit,
    status: response.status,
  };
}

export async function fetchHomeTimeline(options: XTimelineClientOptions): Promise<TimelinePost[]> {
  const pageSize = Math.min(Math.max(options.maxResults ?? 100, 10), 100);
  const targetResults = Math.min(Math.max(options.targetResults ?? 100, 1), 500);
  const maxPages = Math.min(Math.max(options.maxPages ?? 3, 1), 5);
  const fetchedPosts: TimelinePost[] = [];
  let requestCount = 0;
  let latestRateLimit: UsageRecord["rateLimit"];

  if (options.sinceId) {
    try {
      const page = await fetchTimelinePage(options, {
        maxResults: pageSize,
        sinceId: options.sinceId,
        page: 1,
        mode: "newer",
      });
      requestCount += 1;
      latestRateLimit = page.rateLimit;
      fetchedPosts.push(...page.posts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      if (!message.includes("X timeline request failed with 400")) {
        throw error;
      }
    }
  }

  let paginationToken: string | undefined;

  for (let pageIndex = 1; uniquePosts(fetchedPosts).length < targetResults && pageIndex <= maxPages; pageIndex += 1) {
    const page = await fetchTimelinePage(options, {
      maxResults: pageSize,
      paginationToken,
      page: pageIndex,
      mode: "baseline",
    });
    requestCount += 1;
    latestRateLimit = page.rateLimit;
    fetchedPosts.push(...page.posts);
    paginationToken = page.nextToken;

    if (!paginationToken) {
      break;
    }
  }

  const posts = uniquePosts(fetchedPosts).slice(0, targetResults);

  options.onUsage?.({
    provider: "x",
    operation: "x.timeline",
    label: "X timeline",
    method: "GET",
    endpoint: X_TIMELINE_ENDPOINT,
    itemCount: posts.length,
    itemIds: posts.map((post) => post.id),
    requestCount,
    rateLimit: latestRateLimit,
    createdAt: new Date().toISOString(),
  });

  await enrichMissingReferencedPosts(options, posts);

  return posts;
}

export async function fetchAuthenticatedUser(accessToken: string): Promise<Author> {
  const url = new URL("https://api.x.com/2/users/me");
  url.searchParams.set("user.fields", "name,username,profile_image_url");

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`X authenticated user request failed with ${response.status}: ${await response.text()}`);
  }

  const payload = await response.json() as XMeResponse;

  if (!payload.data) {
    throw new Error("X authenticated user response did not include user data.");
  }

  return {
    id: payload.data.id,
    name: payload.data.name,
    username: payload.data.username,
    profileImageUrl: payload.data.profile_image_url,
  };
}
