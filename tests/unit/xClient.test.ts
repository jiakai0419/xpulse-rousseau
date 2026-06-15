import assert from "node:assert/strict";
import { test } from "node:test";
import type { UsageRecord } from "../../src/domain/tweet.ts";
import type { XRawTimelineSnapshot } from "../../src/services/x/rawSnapshotStore.ts";
import { fetchHomeTimeline } from "../../src/services/x/client.ts";

function commaParam(url: URL | undefined, name: string): string[] {
  return (url?.searchParams.get(name) ?? "").split(",").filter(Boolean);
}

function assertParamIncludes(url: URL | undefined, name: string, expected: string[]) {
  const values = commaParam(url, name);

  for (const value of expected) {
    assert.ok(values.includes(value), `${name} should include ${value}`);
  }
}

test("fetchHomeTimeline records X API usage", async () => {
  const originalFetch = globalThis.fetch;
  const usage: UsageRecord[] = [];
  let requestedUrl: URL | undefined;

  globalThis.fetch = async (url) => {
    requestedUrl = new URL(String(url));

    return new Response(
      JSON.stringify({
        data: [
          {
            id: "tweet-1",
            text: "A useful post https://t.co/card https://t.co/photo",
            note_tweet: {
              text: "A useful long-form post with full text https://t.co/card https://t.co/photo",
              entities: {
                urls: [
                  {
                    url: "https://t.co/card",
                    expanded_url: "https://example.com/story-from-note",
                    display_url: "example.com/story-from-note",
                    title: "Story title from note",
                    description: "Story description from note",
                    images: [
                      {
                        url: "https://pbs.twimg.com/card_img/story-note.jpg",
                        width: 1201,
                        height: 629,
                      },
                    ],
                  },
                  {
                    url: "https://t.co/photo",
                    display_url: "pic.x.com/photo",
                  },
                ],
              },
            },
            author_id: "author-1",
            created_at: "2026-06-05T00:00:00.000Z",
            attachments: {
              media_keys: ["media-1", "media-2"],
            },
            entities: {
              urls: [
                {
                  url: "https://t.co/card",
                  expanded_url: "https://example.com/story",
                  display_url: "example.com/story",
                  title: "Story title",
                  description: "Story description",
                  images: [
                    {
                      url: "https://pbs.twimg.com/card_img/story.jpg",
                      width: 1200,
                      height: 628,
                    },
                  ],
                },
                {
                  url: "https://t.co/photo",
                  display_url: "pic.x.com/photo",
                },
                {
                  url: "https://t.co/photo",
                  display_url: "pic.x.com/photo",
                },
              ],
            },
            public_metrics: {
              like_count: 10,
            },
            referenced_tweets: [
              {
                type: "quoted",
                id: "tweet-quoted",
              },
            ],
          },
        ],
        includes: {
          tweets: [
            {
              id: "tweet-quoted",
              text: "Quoted context with a source link https://t.co/quoted",
              author_id: "author-quoted",
              created_at: "2026-06-04T23:00:00.000Z",
              entities: {
                urls: [
                  {
                    url: "https://t.co/quoted",
                    expanded_url: "https://example.com/quoted",
                    display_url: "example.com/quoted",
                  },
                ],
              },
              public_metrics: {
                like_count: 5,
              },
              attachments: {
                media_keys: ["media-quoted"],
              },
            },
          ],
          users: [
            {
              id: "author-1",
              name: "Author One",
              username: "author_one",
            },
            {
              id: "author-quoted",
              name: "Quoted Author",
              username: "quoted_author",
            },
          ],
          media: [
            {
              media_key: "media-1",
              type: "photo",
              url: "https://pbs.twimg.com/media/photo.jpg",
              width: 1200,
              height: 800,
              alt_text: "A chart",
            },
            {
              media_key: "media-2",
              type: "video",
              preview_image_url: "https://pbs.twimg.com/media/video-preview.jpg",
              duration_ms: 123456,
              width: 1280,
              height: 720,
              variants: [
                {
                  bit_rate: 832000,
                  content_type: "video/mp4",
                  url: "https://video.twimg.com/ext_tw_video/vid/640x360/video-low.mp4",
                },
                {
                  bit_rate: 2176000,
                  content_type: "video/mp4",
                  url: "https://video.twimg.com/ext_tw_video/vid/1280x720/video-high.mp4",
                },
              ],
            },
            {
              media_key: "media-quoted",
              type: "photo",
              url: "https://pbs.twimg.com/media/quoted.jpg",
              width: 900,
              height: 600,
            },
          ],
        },
      }),
      {
        status: 200,
        headers: {
          "x-rate-limit-limit": "15",
          "x-rate-limit-remaining": "14",
          "x-rate-limit-reset": "1780646400",
        },
      },
    );
  };

  try {
    const posts = await fetchHomeTimeline({
      userId: "user-1",
      accessToken: "token-1",
      maxResults: 1,
      onUsage: (record) => usage.push(record),
    });

    assert.equal(posts.length, 1);
    assert.match(requestedUrl?.searchParams.get("expansions") ?? "", /attachments\.media_keys/);
    assert.match(requestedUrl?.searchParams.get("expansions") ?? "", /referenced_tweets\.id/);
    assert.match(requestedUrl?.searchParams.get("expansions") ?? "", /referenced_tweets\.id\.attachments\.media_keys/);
    assert.match(requestedUrl?.searchParams.get("tweet.fields") ?? "", /entities/);
    assert.match(requestedUrl?.searchParams.get("media.fields") ?? "", /preview_image_url/);
    assert.match(requestedUrl?.searchParams.get("media.fields") ?? "", /variants/);
    assert.equal(posts[0].links?.length, 2);
    assert.equal(posts[0].text, "A useful long-form post with full text https://t.co/card https://t.co/photo");
    assert.equal(posts[0].links?.[0].expandedUrl, "https://example.com/story-from-note");
    assert.equal(posts[0].links?.[0].preview?.title, "Story title from note");
    assert.equal(posts[0].links?.[0].preview?.description, "Story description from note");
    assert.equal(posts[0].links?.[0].preview?.images?.[0].url, "https://pbs.twimg.com/card_img/story-note.jpg");
    assert.equal(posts[0].links?.[0].preview?.images?.[0].width, 1201);
    assert.equal(posts[0].media?.[0].url, "https://pbs.twimg.com/media/photo.jpg");
    assert.equal(posts[0].media?.[0].altText, "A chart");
    assert.equal(posts[0].media?.[1].type, "video");
    assert.equal(posts[0].media?.[1].durationMs, 123456);
    assert.equal(posts[0].media?.[1].variants?.[1].url, "https://video.twimg.com/ext_tw_video/vid/1280x720/video-high.mp4");
    assert.equal(posts[0].referencedPostType, "quoted");
    assert.equal(posts[0].referencedPost?.author.username, "quoted_author");
    assert.equal(posts[0].referencedPost?.links?.[0].displayUrl, "example.com/quoted");
    assert.equal(posts[0].referencedPost?.media?.[0].url, "https://pbs.twimg.com/media/quoted.jpg");
    assert.equal(usage.length, 1);
    assert.equal(usage[0].provider, "x");
    assert.equal(usage[0].operation, "x.timeline");
    assert.equal(usage[0].itemCount, 1);
    assert.equal(usage[0].rateLimit?.limit, 15);
    assert.equal(usage[0].rateLimit?.remaining, 14);
    assert.equal(usage[0].rateLimit?.resetAt, "2026-06-05T08:00:00.000Z");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchHomeTimeline requests the full reader-oriented X field profile", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl: URL | undefined;

  globalThis.fetch = async (url) => {
    requestedUrl = new URL(String(url));

    return new Response(JSON.stringify({ data: [] }), { status: 200 });
  };

  try {
    await fetchHomeTimeline({
      userId: "user-1",
      accessToken: "token-1",
      maxResults: 10,
      maxPages: 1,
    });

    assertParamIncludes(requestedUrl, "expansions", [
      "author_id",
      "referenced_tweets.id",
      "referenced_tweets.id.author_id",
      "referenced_tweets.id.attachments.media_keys",
      "attachments.media_keys",
      "attachments.poll_ids",
      "geo.place_id",
      "in_reply_to_user_id",
      "entities.mentions.username",
    ]);
    assertParamIncludes(requestedUrl, "tweet.fields", [
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
    ]);
    assertParamIncludes(requestedUrl, "user.fields", [
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
    ]);
    assertParamIncludes(requestedUrl, "media.fields", [
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
    ]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchHomeTimeline stores raw timeline payloads before normalization", async () => {
  const originalFetch = globalThis.fetch;
  const snapshots: XRawTimelineSnapshot[] = [];
  const rawPayload = {
    data: [
      {
        id: "tweet-raw",
        text: "Stored before normalization",
        author_id: "author-raw",
        created_at: "2026-06-05T00:00:00.000Z",
        public_metrics: {
          like_count: 3,
        },
        provider_only_field: {
          shouldStayInRawSnapshot: true,
        },
      },
    ],
    includes: {
      users: [
        {
          id: "author-raw",
          name: "Raw Author",
          username: "raw_author",
        },
      ],
    },
    meta: {
      result_count: 1,
    },
  };

  globalThis.fetch = async () => new Response(JSON.stringify(rawPayload), { status: 200 });

  try {
    const posts = await fetchHomeTimeline({
      userId: "user-1",
      accessToken: "token-1",
      maxResults: 10,
      maxPages: 1,
      onRawSnapshot: (snapshot) => {
        snapshots.push(snapshot);
      },
    });

    assert.equal(posts[0].id, "tweet-raw");
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].endpoint, "/2/users/:id/timelines/reverse_chronological");
    assert.equal(snapshots[0].mode, "baseline");
    assert.equal(snapshots[0].status, 200);
    assert.equal(snapshots[0].query["tweet.fields"].includes("note_tweet"), true);
    assert.deepEqual(snapshots[0].payload, rawPayload);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchHomeTimeline prefers since_id and falls back to baseline pages", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: URL[] = [];
  const snapshots = [];
  const usage: UsageRecord[] = [];

  globalThis.fetch = async (url) => {
    const requestedUrl = new URL(String(url));
    requestedUrls.push(requestedUrl);
    const isNewerRequest = requestedUrl.searchParams.has("since_id");
    const id = isNewerRequest ? "tweet-new" : "tweet-old";

    return new Response(
      JSON.stringify({
        data: [
          {
            id,
            text: `${id} text`,
            author_id: "author-1",
            created_at: "2026-06-05T00:00:00.000Z",
            public_metrics: {
              like_count: 1,
            },
          },
        ],
        includes: {
          users: [
            {
              id: "author-1",
              name: "Author One",
              username: "author_one",
            },
          ],
        },
      }),
      {
        status: 200,
        headers: {
          "x-rate-limit-limit": "15",
          "x-rate-limit-remaining": isNewerRequest ? "14" : "13",
        },
      },
    );
  };

  try {
    const posts = await fetchHomeTimeline({
      userId: "user-1",
      accessToken: "token-1",
      sinceId: "tweet-cursor",
      targetResults: 2,
      maxResults: 10,
      maxPages: 1,
      onRawSnapshot: (snapshot) => {
        snapshots.push(snapshot);
      },
      onUsage: (record) => usage.push(record),
    });

    assert.deepEqual(posts.map((post) => post.id), ["tweet-new", "tweet-old"]);
    assert.equal(requestedUrls[0].searchParams.get("since_id"), "tweet-cursor");
    assert.equal(requestedUrls[1].searchParams.has("since_id"), false);
    assert.equal(snapshots.length, 2);
    assert.deepEqual(snapshots.map((snapshot) => snapshot.mode), ["newer", "baseline"]);
    assert.equal(usage[0].requestCount, 2);
    assert.equal(usage[0].rateLimit?.remaining, 13);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("fetchHomeTimeline looks up missing nested quoted posts from reposted sources", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls: URL[] = [];
  const snapshots: XRawTimelineSnapshot[] = [];
  const usage: UsageRecord[] = [];

  globalThis.fetch = async (url) => {
    const requestedUrl = new URL(String(url));
    requestedUrls.push(requestedUrl);

    if (requestedUrl.pathname === "/2/tweets") {
      assert.equal(requestedUrl.searchParams.get("ids"), "quote-1");

      return new Response(
        JSON.stringify({
          data: [
            {
              id: "quote-1",
              text: "Quoted source body https://t.co/qcard https://t.co/qvideo",
              note_tweet: {
                text: "Quoted long source body https://t.co/qcard https://t.co/qvideo",
                entities: {
                  urls: [
                    {
                      url: "https://t.co/qcard",
                      expanded_url: "https://example.com/quote-card",
                      display_url: "example.com/quote-card",
                      title: "Quote card title",
                      description: "Quote card description",
                      images: [
                        {
                          url: "https://pbs.twimg.com/card_img/quote-card.jpg",
                          width: 1200,
                          height: 630,
                        },
                      ],
                    },
                    {
                      url: "https://t.co/qvideo",
                      display_url: "pic.x.com/qvideo",
                      media_key: "quote-video",
                    },
                  ],
                },
              },
              author_id: "author-quote",
              created_at: "2026-06-05T00:00:00.000Z",
              attachments: {
                media_keys: ["quote-video"],
              },
              public_metrics: {
                reply_count: 2,
                retweet_count: 3,
                like_count: 7,
                quote_count: 1,
                impression_count: 900,
              },
            },
          ],
          includes: {
            users: [
              {
                id: "author-quote",
                name: "Quote Author",
                username: "quote_author",
              },
            ],
            media: [
              {
                media_key: "quote-video",
                type: "video",
                preview_image_url: "https://pbs.twimg.com/media/quote-video-preview.jpg",
                duration_ms: 9876,
                width: 720,
                height: 1280,
                variants: [
                  {
                    content_type: "application/x-mpegURL",
                    url: "https://video.twimg.com/ext_tw_video/playlist.m3u8",
                  },
                  {
                    bit_rate: 256000,
                    content_type: "video/mp4",
                    url: "https://video.twimg.com/ext_tw_video/vid/360x640/quote-low.mp4",
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
            "x-rate-limit-remaining": "899",
          },
        },
      );
    }

    return new Response(
      JSON.stringify({
        data: [
          {
            id: "rt-1",
            text: "RT wrapper",
            author_id: "author-reposter",
            created_at: "2026-06-05T01:00:00.000Z",
            referenced_tweets: [
              {
                type: "retweeted",
                id: "source-1",
              },
            ],
            public_metrics: {
              like_count: 1,
            },
          },
        ],
        includes: {
          tweets: [
            {
              id: "source-1",
              text: "Source post with quote https://t.co/quote",
              author_id: "author-source",
              created_at: "2026-06-05T00:30:00.000Z",
              referenced_tweets: [
                {
                  type: "quoted",
                  id: "quote-1",
                },
              ],
              entities: {
                urls: [
                  {
                    url: "https://t.co/quote",
                    expanded_url: "https://x.com/quote_author/status/quote-1",
                    display_url: "x.com/quote_author/…",
                  },
                ],
              },
              public_metrics: {
                like_count: 11,
              },
            },
          ],
          users: [
            {
              id: "author-reposter",
              name: "Reposter",
              username: "reposter",
            },
            {
              id: "author-source",
              name: "Source Author",
              username: "source_author",
            },
          ],
        },
      }),
      {
        status: 200,
        headers: {
          "x-rate-limit-limit": "15",
          "x-rate-limit-remaining": "14",
        },
      },
    );
  };

  try {
    const posts = await fetchHomeTimeline({
      userId: "user-1",
      accessToken: "token-1",
      maxResults: 10,
      maxPages: 1,
      onRawSnapshot: (snapshot) => {
        snapshots.push(snapshot);
      },
      onUsage: (record) => usage.push(record),
    });

    const lookupUrl = requestedUrls.find((url) => url.pathname === "/2/tweets");
    assertParamIncludes(lookupUrl, "tweet.fields", ["note_tweet", "entities", "attachments", "public_metrics"]);
    assertParamIncludes(lookupUrl, "media.fields", ["variants", "duration_ms", "preview_image_url", "width", "height"]);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].referencedPostType, "retweeted");
    assert.equal(posts[0].referencedPost?.id, "source-1");
    assert.equal(posts[0].referencedPost?.referencedPostType, "quoted");
    assert.equal(posts[0].referencedPost?.referencedPost?.id, "quote-1");
    assert.equal(posts[0].referencedPost?.referencedPost?.author.username, "quote_author");
    assert.equal(posts[0].referencedPost?.referencedPost?.text, "Quoted long source body https://t.co/qcard https://t.co/qvideo");
    assert.equal(posts[0].referencedPost?.referencedPost?.links?.[0].preview?.title, "Quote card title");
    assert.equal(posts[0].referencedPost?.referencedPost?.links?.[0].preview?.images?.[0].url, "https://pbs.twimg.com/card_img/quote-card.jpg");
    assert.equal(posts[0].referencedPost?.referencedPost?.media?.[0].type, "video");
    assert.equal(posts[0].referencedPost?.referencedPost?.media?.[0].durationMs, 9876);
    assert.equal(posts[0].referencedPost?.referencedPost?.media?.[0].variants?.[1].url, "https://video.twimg.com/ext_tw_video/vid/360x640/quote-low.mp4");
    assert.equal(posts[0].referencedPost?.referencedPost?.metrics.impressions, 900);
    assert.equal(snapshots.length, 2);
    assert.deepEqual(snapshots.map((snapshot) => snapshot.mode), ["baseline", "lookup"]);
    assert.equal(snapshots[1].endpoint, "/2/tweets");
    assert.equal(snapshots[1].query.ids, "quote-1");
    assert.equal(requestedUrls.length, 2);
    assert.equal(usage.length, 2);
    assert.equal(usage[0].operation, "x.timeline");
    assert.equal(usage[1].operation, "x.lookup");
    assert.equal(usage[1].itemIds[0], "quote-1");
    assert.equal(usage[1].itemCount, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
