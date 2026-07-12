import type { Author, PostLink, PostMedia, ReferencedPost, TimelinePost } from "../../domain/tweet.ts";
import type { XApiMedia, XApiPost, XApiUser, XTimelineResponse } from "./apiTypes.ts";

export type XPostIndexes = {
  users: Map<string, XApiUser>;
  mediaByKey: Map<string, XApiMedia>;
  postsById: Map<string, XApiPost>;
};

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

export function indexesFromPayload(payload: XTimelineResponse): XPostIndexes {
  const posts = [...(payload.data ?? []), ...(payload.includes?.tweets ?? [])];

  return {
    users: new Map((payload.includes?.users ?? []).map((user) => [user.id, user])),
    mediaByKey: new Map((payload.includes?.media ?? []).map((media) => [media.media_key, media])),
    postsById: new Map(posts.map((post) => [post.id, post])),
  };
}

function preferredReference(post: XApiPost): NonNullable<XApiPost["referenced_tweets"]>[number] | undefined {
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

export function referencedPostFromPost(post: XApiPost, indexes: XPostIndexes, stack = new Set<string>()): ReferencedPost {
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

export function uniquePosts(posts: TimelinePost[]): TimelinePost[] {
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

export function postsFromPayload(payload: XTimelineResponse): TimelinePost[] {
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

export function collectMissingReferencedIds(posts: Array<TimelinePost | ReferencedPost>): string[] {
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

export function attachReferencedPosts(posts: Array<TimelinePost | ReferencedPost>, referencedPostsById: Map<string, ReferencedPost>): number {
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
