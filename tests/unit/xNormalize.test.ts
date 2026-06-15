import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReferencedPost, TimelinePost } from "../../src/domain/tweet.ts";
import type { XTimelineResponse } from "../../src/services/x/apiTypes.ts";
import { attachReferencedPosts, collectMissingReferencedIds, postsFromPayload, uniquePosts } from "../../src/services/x/normalize.ts";

test("postsFromPayload preserves reader-critical X fields during normalization", () => {
  const payload: XTimelineResponse = {
    data: [
      {
        id: "post-1",
        text: "Short text https://t.co/card https://t.co/video",
        note_tweet: {
          text: "Long note text https://t.co/card https://t.co/video",
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
                    height: 630,
                  },
                ],
              },
              {
                url: "https://t.co/video",
                display_url: "pic.x.com/video",
                media_key: "video-1",
              },
            ],
          },
        },
        author_id: "author-1",
        created_at: "2026-06-05T00:00:00.000Z",
        lang: "en",
        attachments: {
          media_keys: ["photo-1", "video-1"],
        },
        referenced_tweets: [
          {
            type: "quoted",
            id: "quote-1",
          },
        ],
        public_metrics: {
          reply_count: 1,
          retweet_count: 2,
          like_count: 3,
          quote_count: 4,
          impression_count: 500,
        },
      },
    ],
    includes: {
      tweets: [
        {
          id: "quote-1",
          text: "Quoted post",
          author_id: "quote-author",
          created_at: "2026-06-04T00:00:00.000Z",
          public_metrics: {
            like_count: 10,
          },
        },
      ],
      users: [
        {
          id: "author-1",
          name: "Author One",
          username: "author_one",
          profile_image_url: "https://pbs.twimg.com/profile_images/author.jpg",
        },
        {
          id: "quote-author",
          name: "Quote Author",
          username: "quote_author",
        },
      ],
      media: [
        {
          media_key: "photo-1",
          type: "photo",
          url: "https://pbs.twimg.com/media/photo.jpg",
          alt_text: "Photo alt",
          width: 1600,
          height: 900,
        },
        {
          media_key: "video-1",
          type: "video",
          preview_image_url: "https://pbs.twimg.com/media/video-preview.jpg",
          duration_ms: 9000,
          width: 720,
          height: 1280,
          variants: [
            {
              content_type: "application/x-mpegURL",
              url: "https://video.twimg.com/video.m3u8",
            },
            {
              bit_rate: 832000,
              content_type: "video/mp4",
              url: "https://video.twimg.com/video.mp4",
            },
          ],
        },
      ],
    },
  };

  const posts = postsFromPayload(payload);

  assert.equal(posts.length, 1);
  assert.equal(posts[0].text, "Long note text https://t.co/card https://t.co/video");
  assert.equal(posts[0].author.username, "author_one");
  assert.equal(posts[0].author.profileImageUrl, "https://pbs.twimg.com/profile_images/author.jpg");
  assert.equal(posts[0].language, "en");
  assert.deepEqual(posts[0].metrics, {
    replies: 1,
    reposts: 2,
    likes: 3,
    quotes: 4,
    impressions: 500,
  });
  assert.equal(posts[0].links?.[0].preview?.title, "Story title");
  assert.equal(posts[0].links?.[0].preview?.images?.[0].width, 1200);
  assert.equal(posts[0].links?.[1].mediaKey, "video-1");
  assert.equal(posts[0].media?.[0].altText, "Photo alt");
  assert.equal(posts[0].media?.[1].type, "video");
  assert.equal(posts[0].media?.[1].variants?.[1].url, "https://video.twimg.com/video.mp4");
  assert.equal(posts[0].referencedPostType, "quoted");
  assert.equal(posts[0].referencedPost?.author.username, "quote_author");
});

test("normalization helpers dedupe posts and attach missing referenced posts", () => {
  const posts: TimelinePost[] = [
    {
      id: "post-1",
      text: "Post one",
      author: { id: "author-1", name: "Author One", username: "author_one" },
      createdAt: "2026-06-05T00:00:00.000Z",
      url: "https://x.com/author_one/status/post-1",
      metrics: {},
      referencedPostId: "quote-1",
      referencedPostType: "quoted",
      seenBy: ["author_one"],
    },
    {
      id: "post-1",
      text: "Duplicate post one",
      author: { id: "author-1", name: "Author One", username: "author_one" },
      createdAt: "2026-06-05T00:01:00.000Z",
      url: "https://x.com/author_one/status/post-1",
      metrics: {},
      seenBy: ["author_one"],
    },
  ];
  const quotedPost: ReferencedPost = {
    id: "quote-1",
    text: "Quoted post",
    author: { id: "quote-author", name: "Quote Author", username: "quote_author" },
    createdAt: "2026-06-04T00:00:00.000Z",
    url: "https://x.com/quote_author/status/quote-1",
    metrics: {},
  };

  assert.deepEqual(uniquePosts(posts).map((post) => post.text), ["Post one"]);
  assert.deepEqual(collectMissingReferencedIds(posts), ["quote-1"]);
  assert.equal(attachReferencedPosts(posts, new Map([["quote-1", quotedPost]])), 1);
  assert.equal(posts[0].referencedPost?.author.username, "quote_author");
  assert.deepEqual(collectMissingReferencedIds(posts), []);
});
