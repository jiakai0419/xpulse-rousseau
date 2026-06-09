import assert from "node:assert/strict";
import { test } from "node:test";
import type { LinkPreviewCacheRecord, LinkPreviewCacheRepository } from "../../src/services/linkPreview/cache.ts";
import { enrichSelectedPostLinkPreviews, parseHtmlLinkPreview } from "../../src/services/linkPreview/enrich.ts";
import { testPost } from "../helpers/posts.ts";

function memoryLinkPreviewCache(): LinkPreviewCacheRepository & { records: Map<string, LinkPreviewCacheRecord> } {
  const records = new Map<string, LinkPreviewCacheRecord>();

  return {
    records,
    async get(key) {
      return records.get(key);
    },
    async set(record) {
      records.set(record.key, record);
    },
  };
}

test("parseHtmlLinkPreview reads Open Graph and Twitter metadata", () => {
  const preview = parseHtmlLinkPreview(
    `
      <html>
        <head>
          <meta property="og:title" content="Making Claude a chemist">
          <meta name="description" content="Anthropic science note &amp; demo">
          <meta property="og:image" content="/card.png">
          <meta property="og:image:width" content="1200">
          <meta property="og:image:height" content="628">
        </head>
      </html>
    `,
    "https://anthropic.com/news/claude-chemist",
  );

  assert.equal(preview?.title, "Making Claude a chemist");
  assert.equal(preview?.description, "Anthropic science note & demo");
  assert.equal(preview?.images?.[0].url, "https://anthropic.com/card.png");
  assert.equal(preview?.images?.[0].width, 1200);
  assert.equal(preview?.images?.[0].height, 628);
});

test("enrichSelectedPostLinkPreviews fetches and caches external preview metadata", async () => {
  const cache = memoryLinkPreviewCache();
  let fetchCount = 0;
  const post = testPost({
    id: "external-link",
    text: "Read this https://t.co/story",
    links: [
      {
        url: "https://t.co/story",
        expandedUrl: "https://example.com/story",
        displayUrl: "example.com/story",
      },
    ],
  });

  const fetcher: typeof fetch = async () => {
    fetchCount += 1;
    return new Response(
      `
        <html>
          <head>
            <meta property="og:title" content="Story title">
            <meta property="og:description" content="Story summary">
            <meta property="og:image" content="https://cdn.example.com/story.jpg">
          </head>
        </html>
      `,
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  };

  await enrichSelectedPostLinkPreviews([post], { cache, fetcher, now: new Date("2026-06-07T00:00:00.000Z") });

  assert.equal(fetchCount, 1);
  assert.equal(post.links?.[0].preview?.title, "Story title");
  assert.equal(post.links?.[0].preview?.description, "Story summary");
  assert.equal(post.links?.[0].preview?.images?.[0].url, "https://cdn.example.com/story.jpg");
  assert.equal(cache.records.size, 1);

  const secondPost = testPost({
    id: "external-link-again",
    text: "Same link https://t.co/story2",
    links: [
      {
        url: "https://t.co/story2",
        expandedUrl: "https://example.com/story",
        displayUrl: "example.com/story",
      },
    ],
  });

  await enrichSelectedPostLinkPreviews([secondPost], { cache, fetcher, now: new Date("2026-06-07T00:00:00.000Z") });

  assert.equal(fetchCount, 1);
  assert.equal(secondPost.links?.[0].preview?.title, "Story title");
});

test("enrichSelectedPostLinkPreviews skips X media/status links and existing previews", async () => {
  const cache = memoryLinkPreviewCache();
  let fetchCount = 0;
  const post = testPost({
    id: "skip-links",
    text: "Media and quote https://t.co/photo https://x.com/user/status/123",
    links: [
      {
        url: "https://t.co/photo",
        displayUrl: "pic.x.com/photo",
        mediaKey: "media-1",
      },
      {
        url: "https://x.com/user/status/123",
        expandedUrl: "https://x.com/user/status/123",
        displayUrl: "x.com/user/status/123",
      },
      {
        url: "https://t.co/article",
        expandedUrl: "https://x.com/i/article/2063647807437705216",
        displayUrl: "x.com/i/article/2063…",
      },
      {
        url: "https://t.co/ready",
        expandedUrl: "https://example.com/ready",
        displayUrl: "example.com/ready",
        preview: { title: "Already resolved" },
      },
    ],
  });
  const fetcher: typeof fetch = async () => {
    fetchCount += 1;
    throw new Error("fetch should not be called");
  };

  await enrichSelectedPostLinkPreviews([post], { cache, fetcher });

  assert.equal(fetchCount, 0);
  assert.equal(post.links?.[3].preview?.title, "Already resolved");
  assert.equal(cache.records.size, 0);
});
