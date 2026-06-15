import assert from "node:assert/strict";
import { test } from "node:test";
import type { TimelinePost, UsageRecord } from "../../src/domain/tweet.ts";
import { enrichMissingReferencedPosts } from "../../src/services/x/enrichment.ts";
import type { XRawTimelineSnapshot } from "../../src/services/x/rawSnapshotStore.ts";

test("enrichMissingReferencedPosts recursively looks up and attaches missing referenced posts", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: URL[] = [];
  const snapshots: XRawTimelineSnapshot[] = [];
  const usage: UsageRecord[] = [];
  const posts: TimelinePost[] = [
    {
      id: "timeline-1",
      text: "Timeline post",
      author: { id: "author-timeline", name: "Timeline Author", username: "timeline_author" },
      createdAt: "2026-06-05T00:00:00.000Z",
      url: "https://x.com/timeline_author/status/timeline-1",
      metrics: {},
      referencedPostId: "quote-1",
      referencedPostType: "quoted",
      seenBy: ["timeline_author"],
    },
  ];

  globalThis.fetch = async (url, init) => {
    const requestedUrl = new URL(String(url));
    requestedUrls.push(requestedUrl);
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer token-1");

    if (requestedUrl.searchParams.get("ids") === "quote-1") {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "quote-1",
              text: "First quote https://t.co/first",
              author_id: "author-quote-1",
              created_at: "2026-06-05T00:01:00.000Z",
              referenced_tweets: [
                {
                  type: "quoted",
                  id: "quote-2",
                },
              ],
              entities: {
                urls: [
                  {
                    url: "https://t.co/first",
                    expanded_url: "https://example.com/first",
                    display_url: "example.com/first",
                    title: "First title",
                  },
                ],
              },
            },
          ],
          includes: {
            users: [
              {
                id: "author-quote-1",
                name: "Quote One",
                username: "quote_one",
              },
            ],
          },
        }),
        {
          status: 200,
          headers: {
            "x-rate-limit-limit": "900",
            "x-rate-limit-remaining": "899",
            "x-rate-limit-reset": "1780646400",
          },
        },
      );
    }

    assert.equal(requestedUrl.searchParams.get("ids"), "quote-2");

    return new Response(
      JSON.stringify({
        data: [
          {
            id: "quote-2",
            text: "Nested quote https://t.co/video",
            note_tweet: {
              text: "Nested long quote https://t.co/video",
              entities: {
                urls: [
                  {
                    url: "https://t.co/video",
                    display_url: "pic.x.com/video",
                    media_key: "video-1",
                  },
                ],
              },
            },
            author_id: "author-quote-2",
            created_at: "2026-06-05T00:02:00.000Z",
            attachments: {
              media_keys: ["video-1"],
            },
            public_metrics: {
              like_count: 42,
              impression_count: 1000,
            },
          },
        ],
        includes: {
          users: [
            {
              id: "author-quote-2",
              name: "Quote Two",
              username: "quote_two",
            },
          ],
          media: [
            {
              media_key: "video-1",
              type: "video",
              preview_image_url: "https://pbs.twimg.com/media/video-preview.jpg",
              duration_ms: 9000,
              width: 720,
              height: 1280,
              variants: [
                {
                  bit_rate: 832000,
                  content_type: "video/mp4",
                  url: "https://video.twimg.com/ext_tw_video/vid/720x1280/video.mp4",
                },
              ],
            },
          ],
        },
      }),
      {
        status: 200,
        headers: {
          "x-rate-limit-limit": "900",
          "x-rate-limit-remaining": "898",
        },
      },
    );
  };

  try {
    await enrichMissingReferencedPosts(
      {
        accessToken: "token-1",
        onRawSnapshot: (snapshot) => {
          snapshots.push(snapshot);
        },
        onUsage: (record) => {
          usage.push(record);
        },
      },
      posts,
    );

    assert.deepEqual(requestedUrls.map((url) => url.searchParams.get("ids")), ["quote-1", "quote-2"]);
    assert.equal(posts[0].referencedPost?.author.username, "quote_one");
    assert.equal(posts[0].referencedPost?.links?.[0].preview?.title, "First title");
    assert.equal(posts[0].referencedPost?.referencedPost?.author.username, "quote_two");
    assert.equal(posts[0].referencedPost?.referencedPost?.text, "Nested long quote https://t.co/video");
    assert.equal(posts[0].referencedPost?.referencedPost?.media?.[0].durationMs, 9000);
    assert.equal(posts[0].referencedPost?.referencedPost?.media?.[0].variants?.[0].url, "https://video.twimg.com/ext_tw_video/vid/720x1280/video.mp4");
    assert.equal(posts[0].referencedPost?.referencedPost?.metrics.impressions, 1000);
    assert.equal(snapshots.length, 2);
    assert.deepEqual(snapshots.map((snapshot) => snapshot.mode), ["lookup", "lookup"]);
    assert.deepEqual(snapshots.map((snapshot) => snapshot.endpoint), ["/2/tweets", "/2/tweets"]);
    assert.equal(snapshots[0].query["tweet.fields"].includes("note_tweet"), true);
    assert.equal(usage.length, 1);
    assert.equal(usage[0].operation, "x.lookup");
    assert.deepEqual(usage[0].itemIds, ["quote-1", "quote-2"]);
    assert.equal(usage[0].itemCount, 2);
    assert.equal(usage[0].requestCount, 2);
    assert.equal(usage[0].rateLimit?.remaining, 898);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
