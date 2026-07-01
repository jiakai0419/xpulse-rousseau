import assert from "node:assert/strict";
import { test } from "node:test";
import {
  enrichPostXArticlePreviewsFromEvidence,
  inventorySampleForJson,
  inventorySampleFromRawSample,
  refreshInventorySampleDerivedFields,
} from "../../scripts/display-inventory-samples.mjs";

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

test("inventory samples derive display risks and missing data from one real post shape", () => {
  const timelinePost = post({
    referencedPostType: "quoted",
    links: [
      {
        url: "https://t.co/quote",
        expandedUrl: "https://x.com/someone/status/123",
        displayUrl: "x.com/someone/status/123",
      },
    ],
    media: [
      {
        mediaKey: "7_video",
        type: "video",
        previewImageUrl: "https://pbs.twimg.com/ext_tw_video_thumb/1/img/demo.jpg",
        variants: [],
      },
    ],
  });

  const sample = inventorySampleFromRawSample(
    {
      runId: "run-real",
      runCreatedAt: "2026-06-10T00:00:00.000Z",
      fetchIndex: 3,
      timelinePost,
    },
    "history-trace",
    1,
  );

  assert.deepEqual(sample.risks, ["media_plus_quote", "quote_placeholder", "video_without_playable_variant", "x_status_link_without_quote_body"]);
  assert.deepEqual(sample.missingData, ["media_dimensions", "quoted_post_body", "video_variants"]);
});

test("X Article evidence enrichment refreshes inventory sample derived fields", () => {
  const timelinePost = post({
    links: [
      {
        url: "https://t.co/article",
        expandedUrl: "https://x.com/i/article/2064000000000000000",
        displayUrl: "x.com/i/article/2064...",
      },
    ],
  });
  const sample = inventorySampleFromRawSample(
    {
      runId: "run-real",
      runCreatedAt: "2026-06-10T00:00:00.000Z",
      timelinePost,
    },
    "history-selected",
    1,
  );

  assert.deepEqual(sample.missingData, ["x_article_preview_metadata"]);

  const enriched = enrichPostXArticlePreviewsFromEvidence(timelinePost, {
    facts: {
      textStart: "Post\nArticle\nA deep X Article title\nA useful deck from the Original page",
    },
  });
  sample.xArticlePreviewEvidenceApplied = enriched;
  refreshInventorySampleDerivedFields(sample);

  assert.equal(enriched, 1);
  assert.deepEqual(sample.missingData, []);
  assert.equal(timelinePost.links[0].preview.title, "A deep X Article title");
});

test("inventory JSON keeps evidence fields used by downstream display tooling", () => {
  const quoted = post({
    id: "quote-1",
    author: author("quoted"),
    text: "Read https://x.com/i/article/2064",
  });
  const timelinePost = post({
    text: "Main post",
    metrics: { replies: 1, reposts: 2, likes: 3, views: 4 },
    referencedPostType: "quoted",
    referencedPost: quoted,
    links: [
      {
        url: "https://t.co/site",
        expandedUrl: "https://example.com/story",
        displayUrl: "example.com/story",
        preview: {
          title: "Example story",
          images: [{ url: "https://example.com/card.png" }],
        },
      },
    ],
    media: [
      {
        mediaKey: "3_photo",
        type: "photo",
        width: 1200,
        height: 800,
        url: "https://pbs.twimg.com/media/photo.jpg",
      },
    ],
  });
  const sample = inventorySampleFromRawSample(
    {
      runId: "run-real",
      runCreatedAt: "2026-06-10T00:00:00.000Z",
      selectedIndex: 0,
      timelinePost,
    },
    "history-selected",
    2,
  );

  sample.localScreenshot = ".data/display-gap-inventory/local.png";
  sample.localFacts = { card: { width: 600 } };

  const json = inventorySampleForJson(sample);

  assert.equal(json.postId, "post-1");
  assert.equal(json.links[0].domain, "example.com");
  assert.equal(json.links[0].previewHasImage, true);
  assert.equal(json.media[0].hasUrl, true);
  assert.equal(json.quote?.id, "quote-1");
  assert.equal(json.quote?.hasXArticleText, true);
  assert.deepEqual(json.localFacts, { card: { width: 600 } });
});
