import type { TimelinePost } from "../../domain/tweet.ts";

export type DedupeResult = {
  posts: TimelinePost[];
  duplicates: Array<{
    keptId: string;
    duplicateId: string;
    reason: "retweet" | "exact_text";
  }>;
};

export function normalizePostText(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .trim();
}

function duplicateKey(post: TimelinePost): { key: string; reason: "retweet" | "exact_text" } {
  if (post.referencedPostType === "retweeted" && post.referencedPostId) {
    return {
      key: `retweet:${post.referencedPostId}`,
      reason: "retweet",
    };
  }

  return {
    key: `text:${normalizePostText(post.text)}`,
    reason: "exact_text",
  };
}

export function dedupeTimelinePosts(posts: TimelinePost[]): DedupeResult {
  const seen = new Map<string, TimelinePost>();
  const output: TimelinePost[] = [];
  const duplicates: DedupeResult["duplicates"] = [];

  for (const post of posts) {
    const { key, reason } = duplicateKey(post);
    const existing = seen.get(key);

    if (existing) {
      existing.seenBy = [...new Set([...existing.seenBy, ...post.seenBy, post.author.username])];
      duplicates.push({
        keptId: existing.id,
        duplicateId: post.id,
        reason,
      });
      continue;
    }

    seen.set(key, post);
    output.push(post);
  }

  return {
    posts: output,
    duplicates,
  };
}
