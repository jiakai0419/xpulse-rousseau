import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findTokenRanges,
  linkDisplayLabel,
  linkTreatment,
  normalizedPostLinks,
  textWithoutHiddenPostLinks,
  textWithoutPostLinks,
} from "../../public/reader/linkRules.js";

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
