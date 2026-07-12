import assert from "node:assert/strict";
import { test } from "node:test";
import { renderPost } from "../../public/reader/post.js";

function author(overrides: Record<string, unknown> = {}) {
  return {
    id: "author-1",
    name: "Ada Lovelace",
    username: "ada",
    ...overrides,
  };
}

function post(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    text: "A post",
    author: author(),
    createdAt: "2026-06-10T12:34:00.000Z",
    url: "https://x.com/ada/status/1",
    links: [],
    media: [],
    metrics: {
      replies: 1,
      reposts: 2,
      likes: 3,
      impressions: 4,
    },
    ...overrides,
  };
}

function score(overrides: Record<string, unknown> = {}) {
  return {
    total: 84,
    dimensions: [
      {
        key: "immediateValue",
        label: "Immediate value",
        score: 8.1,
        reason: "Timely and useful.",
      },
    ],
    ...overrides,
  };
}

function withDocument<T>(callback: () => T): T {
  const previousDocument = (globalThis as { document?: unknown }).document;

  (globalThis as { document?: unknown }).document = {
    createElement() {
      let value = "";

      return {
        get value() {
          return value;
        },
        set innerHTML(input: string) {
          value = String(input)
            .replaceAll("&lt;", "<")
            .replaceAll("&gt;", ">")
            .replaceAll("&amp;", "&");
        },
      };
    },
  };

  try {
    return callback();
  } finally {
    if (previousDocument === undefined) {
      delete (globalThis as { document?: unknown }).document;
    } else {
      (globalThis as { document?: unknown }).document = previousDocument;
    }
  }
}

test("renderPost composes the reader-facing post card in stable X-like order", () => {
  const quote = post({
    id: "quote-1",
    text: "Quoted insight",
    author: author({ name: "Quote Author", username: "quote_author" }),
    url: "https://x.com/quote_author/status/2",
  });
  const source = post({
    id: "source-1",
    text: "Source body <unsafe> https://t.co/quote",
    author: author({
      name: "Source Author",
      username: "source_author",
      profileImageUrl: "https://img.example/source.png",
    }),
    url: "https://x.com/source_author/status/1",
    media: [
      {
        type: "photo",
        url: "https://pbs.twimg.com/media/SOURCE.jpg",
        width: 1000,
        height: 500,
        altText: "Source media",
      },
    ],
    links: [
      {
        url: "https://t.co/quote",
        expandedUrl: "https://x.com/quote_author/status/2",
        displayUrl: "x.com/quote_author/status/2",
      },
      {
        url: "https://example.com/report",
        displayUrl: "example.com/report",
      },
    ],
    referencedPostType: "quoted",
    referencedPost: quote,
    metrics: {
      replies: 10,
      reposts: 20,
      likes: 30,
      impressions: 4000,
    },
  });
  const timelineRetweet = post({
    id: "retweet-1",
    author: author({ name: "Reposter", username: "reposter" }),
    referencedPostType: "retweeted",
    referencedPost: source,
  });

  const html = withDocument(() =>
    renderPost(
      {
        post: timelineRetweet,
        score: score(),
        translation: {
          textZh: "中文译文 https://t.co/quote",
        },
      },
      2,
    ),
  );

  assert.match(html, /<article class="tweet-card">/);
  assert.match(html, /Reposter reposted/);
  assert.match(html, /Source Author/);
  assert.match(html, /@source_author/);
  assert.match(html, /#3/);
  assert.match(html, /Source body &lt;unsafe&gt;/);
  assert.doesNotMatch(html, /https:\/\/t\.co\/quote/);
  assert.match(html, /class="media-grid media-count-1"/);
  assert.match(html, /class="quote-card"/);
  assert.match(html, /Quoted insight/);
  assert.match(html, /class="link-chip-list"/);
  assert.match(html, /example\.com\/report/);
  assert.match(html, /Chinese translation/);
  assert.match(html, /中文译文/);
  assert.match(html, /metric-replies/);
  assert.match(html, /metric-reposts/);
  assert.match(html, /metric-likes/);
  assert.match(html, /metric-views/);
  assert.match(html, /Signal: 8\.4 out of 10/);
  assert.match(html, /立即值得看/);

  const order = [
    "class=\"tweet-text\"",
    "class=\"media-grid media-count-1\"",
    "class=\"quote-card",
    "class=\"link-chip-list\"",
    "class=\"translation-block\"",
    "class=\"post-footer\"",
  ].map((marker) => html.indexOf(marker));

  assert.equal(order.every((index) => index >= 0), true);
  assert.deepEqual([...order].sort((left, right) => left - right), order);
});
