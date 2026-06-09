import type { TimelinePost } from "../../src/domain/tweet.ts";

export function testPost(overrides: Partial<TimelinePost> = {}): TimelinePost {
  return {
    id: "test-post-1",
    text: "New paper claims a 37% cost reduction by routing easy requests through a smaller model.",
    author: { id: "author-1", name: "Test Author", username: "test_author" },
    createdAt: "2026-06-03T09:00:00.000Z",
    url: "https://x.com/test_author/status/test-post-1",
    metrics: { likes: 10, reposts: 2, quotes: 1, replies: 1 },
    language: "en",
    seenBy: ["test_author"],
    ...overrides,
  };
}
