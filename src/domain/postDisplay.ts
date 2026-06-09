import type { ReferencedPost, TimelinePost } from "./tweet.ts";

export type ReaderDisplayPost = TimelinePost | ReferencedPost;

export function readerDisplayPost(post: TimelinePost): ReaderDisplayPost {
  if (post.referencedPostType === "retweeted" && post.referencedPost) {
    return post.referencedPost;
  }

  return post;
}

export function readerAuthorKey(post: TimelinePost): string {
  const author = readerDisplayPost(post).author;
  return author.id || author.username.toLowerCase();
}

export function readerMetrics(post: TimelinePost) {
  return readerDisplayPost(post).metrics;
}
