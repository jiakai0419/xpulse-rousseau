import type { Author, PostLink, PostMedia, ReferencedPost, TimelinePost, UsageRecord } from "../../domain/tweet.ts";
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

type XApiPost = {
  id: string;
  text: string;
  author_id?: string;
  created_at?: string;
  lang?: string;
  attachments?: {
    media_keys?: string[];
  };
  entities?: {
    urls?: Array<{
      url: string;
      expanded_url?: string;
      display_url?: string;
      unwound_url?: string;
      media_key?: string;
      title?: string;
      description?: string;
      images?: Array<{
        url?: string;
        width?: number;
        height?: number;
      }>;
    }>;
  };
  note_tweet?: {
    text?: string;
    entities?: {
      urls?: Array<{
      url: string;
      expanded_url?: string;
      display_url?: string;
      unwound_url?: string;
      media_key?: string;
      title?: string;
      description?: string;
      images?: Array<{
          url?: string;
          width?: number;
          height?: number;
        }>;
      }>;
    };
  };
  public_metrics?: {
    reply_count?: number;
    retweet_count?: number;
    like_count?: number;
    quote_count?: number;
    impression_count?: number;
  };
  referenced_tweets?: Array<{
    type: "retweeted" | "quoted" | "replied_to";
    id: string;
  }>;
};

type XApiUser = {
  id: string;
  name: string;
  username: string;
  profile_image_url?: string;
};

type XApiMedia = {
  media_key: string;
  type: "photo" | "video" | "animated_gif";
  url?: string;
  preview_image_url?: string;
  duration_ms?: number;
  width?: number;
  height?: number;
  alt_text?: string;
  variants?: Array<{
    bit_rate?: number;
    content_type?: string;
    url?: string;
  }>;
};

type XTimelineResponse = {
  data?: XApiPost[];
  includes?: {
    tweets?: XApiPost[];
    users?: XApiUser[];
    media?: XApiMedia[];
  };
  meta?: {
    next_token?: string;
    result_count?: number;
  };
};

type XMeResponse = {
  data?: XApiUser;
};

function numberHeader(response: Response, name: string): number | undefined {
  const value = response.headers.get(name);

  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resetAtHeader(response: Response): string | undefined {
  const reset = numberHeader(response, "x-rate-limit-reset");
  return reset ? new Date(reset * 1000).toISOString() : undefined;
}

function authorFromPost(post: XApiPost, users: Map<string, XApiUser>): Author {
  const user = post.author_id ? users.get(post.author_id) : undefined;

  return {
    id: user?.id ?? post.author_id ?? "unknown",
    name: user?.name ?? "Unknown author",
    username: user?.username ?? "unknown",
    profileImageUrl: user?.profile_image_url,
  };
}

function textFromPost(post: XApiPost): string {
  return post.note_tweet?.text ?? post.text;
}

function linksFromPost(post: XApiPost): PostLink[] | undefined {
  const seen = new Set<string>();
  const urls = post.note_tweet?.entities?.urls ?? post.entities?.urls ?? [];
  const links = urls.flatMap((link) => {
    const key = `${link.url}|${link.expanded_url ?? ""}|${link.display_url ?? ""}|${link.unwound_url ?? ""}`;

    if (seen.has(key)) {
      return [];
    }

    seen.add(key);

    return [
      {
        url: link.url,
        expandedUrl: link.expanded_url,
        displayUrl: link.display_url,
        unwoundUrl: link.unwound_url,
        mediaKey: link.media_key,
        preview:
          link.title || link.description || link.images?.some((image) => image.url)
            ? {
                title: link.title,
                description: link.description,
                images: link.images
                  ?.flatMap((image) => {
                    if (!image.url) {
                      return [];
                    }

                    return [
                      {
                        url: image.url,
                        width: image.width,
                        height: image.height,
                      },
                    ];
                  })
                  .filter((image) => image.url),
              }
            : undefined,
      },
    ];
  });

  return links.length ? links : undefined;
}

function mediaFromPost(post: XApiPost, mediaByKey: Map<string, XApiMedia>): PostMedia[] | undefined {
  const media = (post.attachments?.media_keys ?? []).flatMap((mediaKey) => {
    const item = mediaByKey.get(mediaKey);

    if (!item) {
      return [];
    }

    const variants = item.variants?.flatMap((variant) => {
      if (!variant.url) {
        return [];
      }

      return [
        {
          bitRate: variant.bit_rate,
          contentType: variant.content_type,
          url: variant.url,
        },
      ];
    });

    return [
      {
        mediaKey: item.media_key,
        type: item.type,
        url: item.url,
        previewImageUrl: item.preview_image_url,
        durationMs: item.duration_ms,
        width: item.width,
        height: item.height,
        altText: item.alt_text,
        variants: variants?.length ? variants : undefined,
      },
    ];
  });

  return media.length ? media : undefined;
}

function postUrl(postId: string, author: Author): string {
  return `https://x.com/${author.username}/status/${postId}`;
}

type XPostIndexes = {
  users: Map<string, XApiUser>;
  mediaByKey: Map<string, XApiMedia>;
  postsById: Map<string, XApiPost>;
};

function indexesFromPayload(payload: XTimelineResponse): XPostIndexes {
  const posts = [...(payload.data ?? []), ...(payload.includes?.tweets ?? [])];

  return {
    users: new Map((payload.includes?.users ?? []).map((user) => [user.id, user])),
    mediaByKey: new Map((payload.includes?.media ?? []).map((media) => [media.media_key, media])),
    postsById: new Map(posts.map((post) => [post.id, post])),
  };
}

function preferredReference(post: XApiPost): XApiPost["referenced_tweets"][number] | undefined {
  return post.referenced_tweets?.find((item) => item.type === "quoted") ?? post.referenced_tweets?.[0];
}

function metricsFromPost(post: XApiPost) {
  return {
    replies: post.public_metrics?.reply_count,
    reposts: post.public_metrics?.retweet_count,
    likes: post.public_metrics?.like_count,
    quotes: post.public_metrics?.quote_count,
    impressions: post.public_metrics?.impression_count,
  };
}

function referencedPostFromPost(post: XApiPost, indexes: XPostIndexes, stack = new Set<string>()): ReferencedPost {
  const author = authorFromPost(post, indexes.users);
  const reference = preferredReference(post);
  const nextStack = new Set(stack);
  nextStack.add(post.id);
  const nestedPost = reference && !nextStack.has(reference.id) ? indexes.postsById.get(reference.id) : undefined;

  return {
    id: post.id,
    text: textFromPost(post),
    author,
    createdAt: post.created_at ?? new Date().toISOString(),
    url: postUrl(post.id, author),
    language: post.lang,
    links: linksFromPost(post),
    media: mediaFromPost(post, indexes.mediaByKey),
    referencedPostId: reference?.id,
    referencedPostType: reference?.type,
    referencedPost: nestedPost ? referencedPostFromPost(nestedPost, indexes, nextStack) : undefined,
    metrics: metricsFromPost(post),
  };
}

const X_TIMELINE_ENDPOINT = "/2/users/:id/timelines/reverse_chronological";
const X_TWEET_LOOKUP_ENDPOINT = "/2/tweets";
const X_READER_EXPANSIONS = [
  "author_id",
  "referenced_tweets.id",
  "referenced_tweets.id.author_id",
  "referenced_tweets.id.attachments.media_keys",
  "attachments.media_keys",
  "attachments.poll_ids",
  "geo.place_id",
  "in_reply_to_user_id",
  "entities.mentions.username",
].join(",");
const X_READER_TWEET_FIELDS = [
  "attachments",
  "author_id",
  "context_annotations",
  "conversation_id",
  "created_at",
  "edit_controls",
  "edit_history_tweet_ids",
  "entities",
  "geo",
  "id",
  "in_reply_to_user_id",
  "lang",
  "possibly_sensitive",
  "public_metrics",
  "referenced_tweets",
  "reply_settings",
  "source",
  "text",
  "withheld",
  "note_tweet",
].join(",");
const X_READER_USER_FIELDS = [
  "created_at",
  "description",
  "entities",
  "id",
  "location",
  "name",
  "pinned_tweet_id",
  "profile_banner_url",
  "profile_image_url",
  "protected",
  "public_metrics",
  "url",
  "username",
  "verified",
  "verified_type",
  "withheld",
].join(",");
const X_READER_MEDIA_FIELDS = [
  "alt_text",
  "duration_ms",
  "height",
  "media_key",
  "preview_image_url",
  "public_metrics",
  "type",
  "url",
  "variants",
  "width",
].join(",");

function uniquePosts(posts: TimelinePost[]): TimelinePost[] {
  const seen = new Set<string>();
  const unique: TimelinePost[] = [];

  for (const post of posts) {
    if (seen.has(post.id)) {
      continue;
    }

    seen.add(post.id);
    unique.push(post);
  }

  return unique;
}

function postsFromPayload(payload: XTimelineResponse): TimelinePost[] {
  const indexes = indexesFromPayload(payload);

  return (payload.data ?? []).map((post) => {
    const author = authorFromPost(post, indexes.users);
    const reference = preferredReference(post);
    const referencedPost = reference ? indexes.postsById.get(reference.id) : undefined;

    return {
      id: post.id,
      text: textFromPost(post),
      author,
      createdAt: post.created_at ?? new Date().toISOString(),
      url: postUrl(post.id, author),
      language: post.lang,
      links: linksFromPost(post),
      media: mediaFromPost(post, indexes.mediaByKey),
      referencedPostId: reference?.id,
      referencedPostType: reference?.type,
      referencedPost: referencedPost ? referencedPostFromPost(referencedPost, indexes) : undefined,
      metrics: metricsFromPost(post),
      seenBy: [author.username],
    };
  });
}

function buildTweetLookupUrl(ids: string[]): URL {
  const url = new URL("https://api.x.com/2/tweets");

  url.searchParams.set("ids", ids.join(","));
  url.searchParams.set("expansions", X_READER_EXPANSIONS);
  url.searchParams.set("tweet.fields", X_READER_TWEET_FIELDS);
  url.searchParams.set("user.fields", X_READER_USER_FIELDS);
  url.searchParams.set("media.fields", X_READER_MEDIA_FIELDS);

  return url;
}

function collectMissingReferencedIds(posts: Array<TimelinePost | ReferencedPost>): string[] {
  const missing = new Set<string>();
  const visited = new Set<string>();

  const visit = (post: TimelinePost | ReferencedPost) => {
    if (visited.has(post.id)) {
      return;
    }

    visited.add(post.id);

    if (post.referencedPostId && !post.referencedPost) {
      missing.add(post.referencedPostId);
    }

    if (post.referencedPost) {
      visit(post.referencedPost);
    }
  };

  for (const post of posts) {
    visit(post);
  }

  return [...missing];
}

function attachReferencedPosts(posts: Array<TimelinePost | ReferencedPost>, referencedPostsById: Map<string, ReferencedPost>): number {
  let attached = 0;
  const visited = new Set<string>();

  const visit = (post: TimelinePost | ReferencedPost) => {
    if (visited.has(post.id)) {
      return;
    }

    visited.add(post.id);

    if (post.referencedPostId && !post.referencedPost) {
      const referencedPost = referencedPostsById.get(post.referencedPostId);

      if (referencedPost) {
        post.referencedPost = referencedPost;
        attached += 1;
      }
    }

    if (post.referencedPost) {
      visit(post.referencedPost);
    }
  };

  for (const post of posts) {
    visit(post);
  }

  return attached;
}

async function fetchTweetLookupBatch(options: XTimelineClientOptions, ids: string[], page: number): Promise<{
  referencedPostsById: Map<string, ReferencedPost>;
  rateLimit?: UsageRecord["rateLimit"];
}> {
  const url = buildTweetLookupUrl(ids);
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
  const rateLimit = {
    limit: numberHeader(response, "x-rate-limit-limit"),
    remaining: numberHeader(response, "x-rate-limit-remaining"),
    resetAt: resetAtHeader(response),
  };

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

async function enrichMissingReferencedPosts(options: XTimelineClientOptions, posts: TimelinePost[]): Promise<void> {
  const requestedIds = new Set<string>();
  let requestCount = 0;
  let latestRateLimit: UsageRecord["rateLimit"];
  let attachedCount = 0;
  const requestedItemIds: string[] = [];

  for (let depth = 0; depth < 3; depth += 1) {
    const missingIds = collectMissingReferencedIds(posts).filter((id) => !requestedIds.has(id));

    if (!missingIds.length) {
      break;
    }

    for (let index = 0; index < missingIds.length; index += 100) {
      const ids = missingIds.slice(index, index + 100);

      ids.forEach((id) => requestedIds.add(id));
      requestedItemIds.push(...ids);
      const page = await fetchTweetLookupBatch(options, ids, requestCount + 1);
      requestCount += 1;
      latestRateLimit = page.rateLimit;
      attachedCount += attachReferencedPosts(posts, page.referencedPostsById);
    }
  }

  if (!requestCount) {
    return;
  }

  options.onUsage?.({
    provider: "x",
    operation: "x.lookup",
    label: "X tweet lookup",
    method: "GET",
    endpoint: X_TWEET_LOOKUP_ENDPOINT,
    itemCount: attachedCount,
    itemIds: requestedItemIds,
    requestCount,
    rateLimit: latestRateLimit,
    createdAt: new Date().toISOString(),
  });
}

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
  const rateLimit = {
    limit: numberHeader(response, "x-rate-limit-limit"),
    remaining: numberHeader(response, "x-rate-limit-remaining"),
    resetAt: resetAtHeader(response),
  };

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
