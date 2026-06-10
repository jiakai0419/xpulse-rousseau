import assert from "node:assert/strict";
import { test } from "node:test";
import { renderInlineLink, renderPostText } from "../../public/reader/postText.js";

function post(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    text: "A post",
    links: [],
    media: [],
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

test("renderInlineLink uses the resolved href and reader-facing label", () => {
  assert.equal(
    renderInlineLink({
      url: "https://t.co/abc",
      expandedUrl: "https://example.com/article",
      displayUrl: "example.com/article",
    }),
    '<a class="tweet-text-link" href="https://example.com/article" target="_blank" rel="noreferrer">example.com/article</a>',
  );
});

test("renderPostText replaces ordinary inline links without showing raw t.co URLs", () => {
  const html = withDocument(() =>
    renderPostText(
      post({
        text: "Read https://t.co/abc now",
        links: [
          {
            url: "https://t.co/abc",
            expandedUrl: "https://example.com/article",
            displayUrl: "example.com/article",
          },
        ],
      }),
    ),
  );

  assert.equal(
    html,
    'Read <a class="tweet-text-link" href="https://example.com/article" target="_blank" rel="noreferrer">example.com/article</a> now',
  );
  assert.doesNotMatch(html, /https:\/\/t\.co\/abc/);
});

test("renderPostText prefers the longest overlapping link token", () => {
  const html = withDocument(() =>
    renderPostText(
      post({
        text: "Read https://example.com/article/details",
        links: [
          {
            url: "https://example.com/article",
            expandedUrl: "https://example.com/article/details",
            displayUrl: "example.com/article/details",
          },
        ],
      }),
    ),
  );

  assert.equal(
    html,
    'Read <a class="tweet-text-link" href="https://example.com/article/details" target="_blank" rel="noreferrer">example.com/article/details</a>',
  );
});

test("renderPostText hides media and quoted-post links while keeping ordinary media-adjacent links inline", () => {
  const html = withDocument(() =>
    renderPostText(
      post({
        text: "Look https://t.co/photo Read https://t.co/article Quote https://t.co/quote",
        media: [{ mediaKey: "3_1" }],
        referencedPostType: "quoted",
        referencedPost: {
          url: "https://x.com/source/status/123",
        },
        links: [
          {
            url: "https://t.co/photo",
            displayUrl: "pic.x.com/photo",
            expandedUrl: "https://x.com/user/status/1/photo/1",
            mediaKey: "3_1",
          },
          {
            url: "https://t.co/article",
            expandedUrl: "https://example.com/article",
            displayUrl: "example.com/article",
            preview: {
              title: "Article",
            },
          },
          {
            url: "https://t.co/quote",
            expandedUrl: "https://x.com/source/status/123",
            displayUrl: "x.com/source/status/123",
          },
        ],
      }),
    ),
  );

  assert.equal(
    html,
    'Look Read <a class="tweet-text-link" href="https://example.com/article" target="_blank" rel="noreferrer">example.com/article</a> Quote',
  );
  assert.doesNotMatch(html, /https:\/\/t\.co\/photo/);
  assert.doesNotMatch(html, /https:\/\/t\.co\/quote/);
});

test("renderPostText escapes plain text and preserves line breaks", () => {
  const html = withDocument(() =>
    renderPostText(
      post({
        text: "Line <one>\nLine & two",
      }),
    ),
  );

  assert.equal(html, "Line &lt;one&gt;\nLine &amp; two");
});

test("renderPostText returns an empty string when hidden links remove all text", () => {
  assert.equal(
    renderPostText(
      post({
        text: "https://t.co/article",
        links: [
          {
            url: "https://t.co/article",
            expandedUrl: "https://example.com/article",
            displayUrl: "example.com/article",
            preview: {
              title: "Article",
            },
          },
        ],
      }),
    ),
    "",
  );
});
