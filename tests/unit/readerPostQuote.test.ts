import assert from "node:assert/strict";
import { test } from "node:test";
import { renderQuotedPost } from "../../public/reader/postQuote.js";

function author(overrides: Record<string, unknown> = {}) {
  return {
    id: "author-1",
    name: "Quote Author",
    username: "quote_author",
    ...overrides,
  };
}

function post(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    text: "A post",
    author: author(),
    createdAt: "2026-06-10T12:34:00.000Z",
    url: "https://x.com/quote_author/status/post-1",
    links: [],
    media: [],
    metrics: {},
    seenBy: [],
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

test("renderQuotedPost returns empty markup for non-quoted posts", () => {
  assert.equal(renderQuotedPost(post()), "");
});

test("renderQuotedPost returns empty markup when quoted evidence is missing", () => {
  assert.equal(
    renderQuotedPost(
      post({
        referencedPostType: "quoted",
      }),
    ),
    "",
  );
});

test("renderQuotedPost renders a placeholder when only the quoted status link is available", () => {
  const html = renderQuotedPost(
    post({
      text: "Quote https://t.co/quote",
      referencedPostType: "quoted",
      links: [
        {
          url: "https://t.co/quote",
          expandedUrl: "https://x.com/source/status/123?x=<bad>",
          displayUrl: "x.com/source/status/123",
        },
      ],
    }),
  );

  assert.match(html, /quote-card-placeholder/);
  assert.match(html, /data-quote-url="https:\/\/x\.com\/source\/status\/123\?x=&lt;bad&gt;"/);
  assert.match(html, /Quoted post/);
  assert.match(html, /Open on X/);
  assert.match(html, /x\.com\/source\/status\/123/);
});

test("renderQuotedPost renders quoted post body, author, media, and escaped fields", () => {
  const quote = post({
    id: "quote",
    text: "Quote text <unsafe>",
    author: author({
      name: "<Quoted>",
      username: "quoted<script>",
      profileImageUrl: "https://img.example/q.png",
    }),
    url: "https://x.com/quoted/status/1?x=<bad>",
    media: [{ mediaKey: "3_1" }],
  });
  const calls: string[] = [];
  const linkCalls: string[] = [];
  const html = withDocument(() =>
    renderQuotedPost(
      post({
        referencedPostType: "quoted",
        referencedPost: quote,
      }),
      {
        renderPostMedia(mediaPost) {
          calls.push(mediaPost.id);
          return `<div class="media-stub">${mediaPost.media.length}</div>`;
        },
        renderPostLinks(linkPost) {
          linkCalls.push(linkPost.id);
          return `<div class="link-stub">${linkPost.links.length}</div>`;
        },
      },
    ),
  );

  assert.deepEqual(calls, ["quote"]);
  assert.deepEqual(linkCalls, ["quote"]);
  assert.match(html, /quote-card quote-card-has-media/);
  assert.match(html, /data-quote-url="https:\/\/x\.com\/quoted\/status\/1\?x=&lt;bad&gt;"/);
  assert.match(html, /src="https:\/\/img\.example\/q\.png"/);
  assert.match(html, /&lt;Quoted&gt;/);
  assert.match(html, /@quoted&lt;script&gt;/);
  assert.match(html, /datetime="2026-06-10T12:34:00.000Z"/);
  assert.match(html, /<p class="quote-text">Quote text &lt;unsafe&gt;<\/p>/);
  assert.match(html, /<div class="media-stub">1<\/div>/);
  assert.match(html, /<div class="link-stub">0<\/div>/);
});

test("renderQuotedPost omits hidden link text while rendering quoted link previews", () => {
  const html = renderQuotedPost(
    post({
      referencedPostType: "quoted",
      referencedPost: post({
        text: "https://t.co/article",
        links: [
          {
            url: "https://t.co/article",
            expandedUrl: "https://example.com/article",
            preview: {
              title: "Article",
            },
          },
        ],
      }),
    }),
    {
      renderPostLinks(linkPost) {
        return `<div class="quote-link-preview">${linkPost.links?.[0]?.preview?.title}</div>`;
      },
    },
  );

  assert.doesNotMatch(html, /quote-text/);
  assert.match(html, /quote-link-preview/);
  assert.match(html, /Article/);
});
