import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildSamplePool,
  buildSelectedSamplePool,
  bucketsFromFlags,
  displayFlags,
  postBuckets,
  readerDisplayPost,
} from "../../scripts/render-buckets.mjs";

function author(id: string) {
  return {
    id,
    name: id,
    username: id,
  };
}

function post(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    text: "A post",
    author: author("author"),
    createdAt: "2026-06-10T00:00:00.000Z",
    url: "https://x.com/author/status/1",
    metrics: {},
    seenBy: [],
    ...overrides,
  };
}

test("readerDisplayPost uses the reposted source as the reader-facing post", () => {
  const source = post({ id: "source", text: "source text", author: author("source-author") });
  const retweet = post({
    id: "retweet",
    author: author("reposter"),
    referencedPostType: "retweeted",
    referencedPost: source,
  });

  assert.equal(readerDisplayPost(retweet).id, "source");
  assert.equal(displayFlags(retweet).retweet, true);
  assert.deepEqual([...postBuckets(retweet)], ["retweet", "text-only"]);
});

test("displayFlags identifies quote media, playable video, and link-preview shapes", () => {
  const quoted = post({
    id: "quoted",
    author: author("quoted-author"),
    media: [
      {
        mediaKey: "7_quoted",
        type: "video",
        previewImageUrl: "https://pbs.twimg.com/ext_tw_video_thumb/1/img/demo.jpg",
        variants: [{ url: "https://video.twimg.com/ext_tw_video/1/vid/avc1/1280x720/demo.mp4", contentType: "video/mp4" }],
      },
    ],
  });
  const timelinePost = post({
    referencedPostType: "quoted",
    referencedPost: quoted,
    links: [
      {
        url: "https://t.co/article",
        expandedUrl: "https://example.com/article",
        displayUrl: "example.com/article",
        preview: { title: "External article" },
      },
      {
        url: "https://t.co/quote",
        expandedUrl: "https://x.com/quoted/status/2",
        displayUrl: "x.com/quoted/status/2",
      },
    ],
    media: [
      {
        mediaKey: "3_photo",
        type: "photo",
        url: "https://pbs.twimg.com/media/photo.jpg",
      },
    ],
  });

  const flags = displayFlags(timelinePost);
  const buckets = bucketsFromFlags(flags);

  assert.equal(flags.quote, true);
  assert.equal(flags.quoteHasMedia, true);
  assert.equal(flags.quoteHasVideo, true);
  assert.equal(flags.mediaCount, 1);
  assert.equal(flags.externalPreviewLinks, 1);
  assert.equal(flags.xStatusLinks, 1);
  assert.deepEqual(
    buckets.filter((bucket) => ["quote", "quote-media", "quote-video", "single-photo", "external-preview", "media-plus-link", "x-status-link"].includes(bucket)),
    ["quote", "quote-media", "quote-video", "single-photo", "external-preview", "media-plus-link", "x-status-link"],
  );
});

test("displayFlags identifies X article links in main and quoted posts", () => {
  const quoted = post({
    id: "quoted-article",
    author: author("quoted-author"),
    links: [
      {
        url: "https://t.co/article",
        expandedUrl: "https://x.com/i/article/2064783001465331804",
        displayUrl: "x.com/i/article/2064...",
      },
    ],
  });
  const timelinePost = post({
    referencedPostType: "quoted",
    referencedPost: quoted,
    links: [
      {
        url: "https://t.co/main-article",
        expandedUrl: "https://x.com/i/article/2064000000000000000",
        displayUrl: "x.com/i/article/2064...",
      },
    ],
  });

  const flags = displayFlags(timelinePost);
  const buckets = bucketsFromFlags(flags);

  assert.equal(flags.xArticleLinks, 1);
  assert.equal(flags.quoteXArticleLinks, 1);
  assert.equal(buckets.includes("x-article-link"), true);
  assert.equal(buckets.includes("quote-x-article-link"), true);
});

test("sample pools distinguish broad trace inputs from selected Top posts", () => {
  const selected = post({ id: "selected", text: "Selected post" });
  const traceOnly = post({
    id: "trace-video",
    text: "Trace-only video",
    media: [
      {
        mediaKey: "7_video",
        type: "video",
        previewImageUrl: "https://pbs.twimg.com/ext_tw_video_thumb/2/img/demo.jpg",
        variants: [{ url: "https://video.twimg.com/ext_tw_video/2/vid/avc1/1280x720/demo.mp4", contentType: "video/mp4" }],
      },
    ],
  });
  const run = {
    id: "run-real-derived",
    source: "x",
    createdAt: "2026-06-10T00:00:00.000Z",
    selectedPosts: [{ post: selected, score: { total: 7, dimensions: [] } }],
    trace: {
      inputPosts: [
        { post: selected, fetchIndex: 0 },
        { post: traceOnly, fetchIndex: 1 },
      ],
    },
  };

  const tracePool = buildSamplePool([run]);
  const selectedPool = buildSelectedSamplePool([run]);

  assert.equal(tracePool.length, 2);
  assert.equal(selectedPool.length, 1);
  assert.equal(tracePool.some((sample) => sample.buckets.includes("playable-video")), true);
  assert.equal(selectedPool.some((sample) => sample.buckets.includes("playable-video")), false);
});
