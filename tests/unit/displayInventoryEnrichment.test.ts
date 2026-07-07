import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyOriginalEvidenceXArticlePreviews,
  enrichDisplayInventorySamples,
  originalEvidenceByPostIdFromEntries,
  originalEvidenceEntriesFromStorePayload,
} from "../../scripts/display-inventory-enrichment.mjs";
import { inventorySampleFromRawSample } from "../../scripts/display-inventory-samples.mjs";

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

function xArticlePost(id = "post-1") {
  return post({
    id,
    text: "Read this",
    links: [
      {
        url: "https://t.co/article",
        expandedUrl: "https://x.com/i/article/2064000000000000000",
        displayUrl: "x.com/i/article/2064...",
      },
    ],
  });
}

function inventorySample(timelinePost: any) {
  return inventorySampleFromRawSample(
    {
      runId: "run-real",
      runCreatedAt: "2026-06-10T00:00:00.000Z",
      timelinePost,
    },
    "history-selected",
    1,
  );
}

test("Original evidence store payloads support array and entries object shapes", () => {
  const arrayPayload = [{ id: "post-a" }];
  const entriesPayload = { entries: [{ postId: "post-b" }] };

  assert.deepEqual(originalEvidenceEntriesFromStorePayload(arrayPayload), arrayPayload);
  assert.deepEqual(originalEvidenceEntriesFromStorePayload(entriesPayload), entriesPayload.entries);
  assert.deepEqual(originalEvidenceEntriesFromStorePayload({}), []);
});

test("Original evidence lookup accepts id and postId fields", () => {
  const byId = originalEvidenceByPostIdFromEntries([
    { id: "post-a", facts: { textStart: "A" } },
    { postId: "post-b", facts: { textStart: "B" } },
    { facts: { textStart: "ignored" } },
  ]);

  assert.equal(byId.get("post-a")?.facts.textStart, "A");
  assert.equal(byId.get("post-b")?.facts.textStart, "B");
  assert.equal(byId.has(""), false);
});

test("Original X Article evidence enriches samples and refreshes missing-data fields", () => {
  const timelinePost = xArticlePost("article-post");
  const sample = inventorySample(timelinePost);

  assert.deepEqual(sample.missingData, ["x_article_preview_metadata"]);

  const summary = applyOriginalEvidenceXArticlePreviews([sample], [
    {
      id: "article-post",
      facts: {
        textStart: "Post\nArticle\nA captured article title\nA captured article description",
      },
    },
  ]);

  assert.equal(summary.xArticlePreviewEvidenceApplied, 1);
  assert.equal(sample.xArticlePreviewEvidenceApplied, 1);
  assert.equal(timelinePost.links[0].preview.title, "A captured article title");

  return enrichDisplayInventorySamples([sample], {
    enrichLinkPreviews: true,
    enrichXArticlePreviews: false,
    enrichSelectedPostLinkPreviews: async () => {},
  }).then(() => {
    assert.deepEqual(sample.missingData, []);
  });
});

test("inventory enrichment preserves the current link-preview gate", async () => {
  const timelinePost = xArticlePost("gated-post");
  const sample = inventorySample(timelinePost);
  let called = false;

  const summary = await enrichDisplayInventorySamples([sample], {
    enrichLinkPreviews: false,
    originalEvidenceEntries: [
      {
        id: "gated-post",
        facts: {
          textStart: "Post\nArticle\nA title that should not be applied while gated",
        },
      },
    ],
    enrichSelectedPostLinkPreviews: async () => {
      called = true;
    },
  });

  assert.equal(called, false);
  assert.equal(summary.refreshed, false);
  assert.equal(sample.xArticlePreviewEvidenceApplied, undefined);
  assert.deepEqual(sample.missingData, ["x_article_preview_metadata"]);
});

test("inventory enrichment calls link preview enrichment and refreshes derived fields", async () => {
  const timelinePost = post({
    links: [
      {
        url: "https://t.co/site",
        expandedUrl: "https://example.com/story",
        displayUrl: "example.com/story",
      },
    ],
  });
  const sample = inventorySample(timelinePost);
  let receivedCache: unknown;

  assert.deepEqual(sample.risks, ["external_link_without_preview_metadata"]);

  const summary = await enrichDisplayInventorySamples([sample], {
    enrichLinkPreviews: true,
    linkPreviewCache: { kind: "cache" },
    enrichSelectedPostLinkPreviews: async (posts: any[], options: any) => {
      receivedCache = options.cache;
      posts[0].links[0].preview = {
        title: "Example story",
        images: [{ url: "https://example.com/card.png" }],
      };
    },
  });

  assert.deepEqual(receivedCache, { kind: "cache" });
  assert.equal(summary.linkPreviewEnriched, true);
  assert.deepEqual(sample.risks, []);
});
