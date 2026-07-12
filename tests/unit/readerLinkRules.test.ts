import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findTokenRanges,
  isReferencedStatusLink,
  linkDisplayLabel,
  linkShouldAppearInText,
  linkTreatment,
  normalizedPostLinks,
  proxiedLinkPreviewImageUrl,
  textWithoutHiddenPostLinks,
  textWithoutPostLinks,
  xStatusId,
} from "../../public/reader/linkRules.js";

test("link preview images always use the same-origin safe proxy", () => {
  assert.equal(
    proxiedLinkPreviewImageUrl({ url: "https://images.example/card.jpg?size=large" }),
    "/api/link-preview/image?url=https%3A%2F%2Fimages.example%2Fcard.jpg%3Fsize%3Dlarge",
  );
  assert.equal(proxiedLinkPreviewImageUrl({ url: "data:image/svg+xml,bad" }), "");
});

test("normalizedPostLinks dedupes X entities and adds raw text links", () => {
  const post = {
    text: "Read https://example.com/a and https://fallback.test/path.",
    links: [
      {
        url: "https://t.co/abc",
        expandedUrl: "https://example.com/a",
        displayUrl: "example.com/a",
      },
      {
        url: "https://t.co/abc",
        expandedUrl: "https://example.com/a",
        displayUrl: "example.com/a",
      },
    ],
  };

  assert.deepEqual(normalizedPostLinks(post), [
    {
      url: "https://t.co/abc",
      expandedUrl: "https://example.com/a",
      displayUrl: "example.com/a",
    },
    {
      url: "https://fallback.test/path",
    },
  ]);
});

test("textWithoutPostLinks removes explicit and raw t.co links", () => {
  const post = {
    text: "Launch https://t.co/source\n\n\nMore detail https://t.co/extra",
    links: [
      {
        url: "https://t.co/source",
        expandedUrl: "https://example.com/source",
        displayUrl: "example.com/source",
      },
    ],
  };

  assert.equal(textWithoutPostLinks(post.text, post), "Launch\n\nMore detail");
});

test("linkTreatment hides media links and quote status links", () => {
  const mediaPost = {
    text: "Photo https://t.co/photo",
    media: [{ mediaKey: "3_1" }],
    links: [
      {
        url: "https://t.co/photo",
        expandedUrl: "https://x.com/user/status/1/photo/1",
        displayUrl: "pic.x.com/photo",
        mediaKey: "3_1",
      },
    ],
  };
  const quotedPost = {
    referencedPostType: "quoted",
    referencedPost: {
      url: "https://x.com/source/status/123",
    },
  };
  const quoteLink = {
    url: "https://t.co/quote",
    expandedUrl: "https://x.com/source/status/123",
    displayUrl: "x.com/source/status/123",
  };

  assert.equal(linkTreatment(mediaPost, mediaPost.links[0]), "media");
  assert.equal(linkTreatment(quotedPost, quoteLink), "quote");
});

test("quote treatment matches the actual referenced status id only", () => {
  const quoteLink = {
    url: "https://t.co/quote",
    expandedUrl: "https://twitter.com/source/status/123?ref=post",
  };
  const unrelatedStatusLink = {
    url: "https://t.co/other",
    expandedUrl: "https://x.com/other/status/456",
  };
  const post = {
    text: "Compare https://t.co/other with https://t.co/quote",
    referencedPostType: "quoted",
    referencedPostId: "123",
    links: [unrelatedStatusLink, quoteLink],
  };

  assert.equal(isReferencedStatusLink(post, quoteLink), true);
  assert.equal(isReferencedStatusLink(post, unrelatedStatusLink), false);
  assert.equal(linkTreatment(post, quoteLink), "quote");
  assert.equal(linkTreatment(post, unrelatedStatusLink), "inline");
  assert.equal(textWithoutHiddenPostLinks(post.text, post), "Compare https://t.co/other with");
});

test("quote treatment does not guess when referenced identity is missing", () => {
  const link = { expandedUrl: "https://x.com/someone/status/789" };

  assert.equal(isReferencedStatusLink({ referencedPostType: "quoted" }, link), false);
  assert.equal(xStatusId("https://www.x.com/someone/status/789/photo/1"), "789");
  assert.equal(xStatusId("https://example.com/status/789"), "");
});

test("linkTreatment renders ordinary previews only when attached media is absent", () => {
  const previewLink = {
    url: "https://t.co/article",
    expandedUrl: "https://example.com/article",
    displayUrl: "example.com/article",
    preview: {
      title: "A useful article",
      description: "Preview copy",
    },
  };

  assert.equal(linkTreatment({ text: "", media: [], links: [previewLink] }, previewLink), "preview");
  assert.equal(linkTreatment({ text: "", media: [{ mediaKey: "3_1" }], links: [previewLink] }, previewLink), "inline");
});

test("linkTreatment keeps only one primary no-media preview card", () => {
  const firstPreview = {
    url: "https://t.co/one",
    expandedUrl: "https://one.example/article",
    displayUrl: "one.example/article",
    preview: {
      title: "First preview",
    },
  };
  const secondPreview = {
    url: "https://t.co/two",
    expandedUrl: "https://two.example/article",
    displayUrl: "two.example/article",
    preview: {
      title: "Second preview",
    },
  };
  const post = {
    text: "Read https://t.co/one and https://t.co/two",
    media: [],
    links: [firstPreview, secondPreview],
  };

  assert.equal(linkTreatment(post, firstPreview), "preview");
  assert.equal(linkTreatment(post, secondPreview), "inline");
  assert.equal(linkShouldAppearInText(post, firstPreview), true);
  assert.equal(textWithoutHiddenPostLinks(post.text, post), "Read https://t.co/one and https://t.co/two");
});

test("textWithoutHiddenPostLinks keeps inline links and removes rich-object links", () => {
  const post = {
    text: "Here https://example.com/a https://x.com/source/status/123",
    referencedPostType: "quoted",
    referencedPost: {
      url: "https://x.com/source/status/123",
    },
    links: [
      {
        url: "https://example.com/a",
      },
      {
        url: "https://x.com/source/status/123",
      },
    ],
  };

  assert.equal(textWithoutHiddenPostLinks(post.text, post), "Here https://example.com/a");
});

test("preview links stay visible when followed by more body text", () => {
  const link = {
    url: "https://t.co/docs",
    expandedUrl: "https://docs.z.ai/devpack/latest",
    displayUrl: "docs.z.ai/devpack/latest...",
    preview: {
      title: "How to Switch Models",
    },
  };
  const post = {
    text: "Plans include Lite and Pro.\nhttps://t.co/docs\n\nMore details next week.",
    links: [link],
  };

  assert.equal(linkTreatment(post, link), "preview");
  assert.equal(linkShouldAppearInText(post, link), true);
  assert.equal(textWithoutHiddenPostLinks(post.text, post), post.text);
});

test("trailing preview links are hidden from body text while keeping their card", () => {
  const link = {
    url: "https://t.co/story",
    expandedUrl: "https://example.com/story",
    displayUrl: "example.com/story",
    preview: {
      title: "Story",
    },
  };
  const post = {
    text: "Read more: https://t.co/story",
    links: [link],
  };

  assert.equal(linkTreatment(post, link), "preview");
  assert.equal(linkShouldAppearInText(post, link), false);
  assert.equal(textWithoutHiddenPostLinks(post.text, post), "Read more:");
});

test("link labels and token ranges stay deterministic for renderer replacement", () => {
  assert.equal(
    linkDisplayLabel({
      expandedUrl: "https://www.example.com/path/",
    }),
    "example.com/path",
  );
  assert.deepEqual(findTokenRanges("x t.co/a y t.co/a", "t.co/a"), [
    { start: 2, end: 8 },
    { start: 11, end: 17 },
  ]);
});
