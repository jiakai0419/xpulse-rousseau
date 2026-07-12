import assert from "node:assert/strict";
import { test } from "node:test";
import { renderPostLinks } from "../../public/reader/postLinks.js";

function post(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    text: "A post",
    links: [],
    media: [],
    ...overrides,
  };
}

test("renderPostLinks returns empty markup when no cards or chips are needed", () => {
  assert.equal(renderPostLinks(post()), "");
  assert.equal(
    renderPostLinks(
      post({
        text: "Read https://example.com/article",
        links: [{ url: "https://example.com/article" }],
      }),
    ),
    "",
  );
});

test("renderPostLinks renders no-media external previews as link cards", () => {
  const html = renderPostLinks(
    post({
      links: [
        {
          url: "https://t.co/a",
          expandedUrl: "https://anthropic.com/news/claude",
          displayUrl: "anthropic.com/news/claude",
          preview: {
            title: "Making Claude a chemist",
            description: "Anthropic science update",
          },
        },
      ],
    }),
  );

  assert.match(html, /class="link-card"/);
  assert.match(html, /href="https:\/\/anthropic\.com\/news\/claude"/);
  assert.match(html, /anthropic\.com/);
  assert.match(html, /Making Claude a chemist/);
  assert.match(html, /Anthropic science update/);
  assert.doesNotMatch(html, /link-chip-list/);
});

test("renderPostLinks renders preview images as media preview cards", () => {
  const html = renderPostLinks(
    post({
      links: [
        {
          url: "https://t.co/a",
          expandedUrl: "https://example.com/article",
          displayUrl: "example.com/article",
          preview: {
            title: "Preview title",
            images: [
              { url: "https://img.example/small.jpg", width: 200, height: 100 },
              { url: "https://img.example/large.jpg", width: 1200, height: 630 },
            ],
          },
        },
      ],
    }),
  );

  assert.match(html, /link-card-media-preview/);
  assert.match(html, /src="\/api\/link-preview\/image\?url=https%3A%2F%2Fimg\.example%2Flarge\.jpg"/);
  assert.doesNotMatch(html, /src="https:\/\/img\.example/);
  assert.match(html, /Preview title/);
  assert.match(html, /From example\.com/);
});

test("renderPostLinks never puts legacy untrusted preview image URLs directly in src", () => {
  const html = renderPostLinks(
    post({
      links: [{
        url: "https://public.example/story",
        preview: {
          title: "Public story",
          images: [{ url: "http://127.0.0.1:8080/private.png", width: 100, height: 100 }],
        },
      }],
    }),
  );

  assert.match(html, /src="\/api\/link-preview\/image\?url=http%3A%2F%2F127\.0\.0\.1%3A8080%2Fprivate\.png"/);
  assert.doesNotMatch(html, /src="http:\/\/127\.0\.0\.1/);
});

test("renderPostLinks renders only one primary external preview card", () => {
  const html = renderPostLinks(
    post({
      text: "Read https://t.co/one and https://t.co/two",
      links: [
        {
          url: "https://t.co/one",
          expandedUrl: "https://one.example/report",
          displayUrl: "one.example/report",
          preview: {
            title: "Primary report",
          },
        },
        {
          url: "https://t.co/two",
          expandedUrl: "https://two.example/report",
          displayUrl: "two.example/report",
          preview: {
            title: "Secondary report",
          },
        },
      ],
    }),
  );

  assert.match(html, /Primary report/);
  assert.doesNotMatch(html, /Secondary report/);
  assert.equal((html.match(/class="link-card(?:\s|")/g) ?? []).length, 1);
  assert.doesNotMatch(html, /link-chip-list/);
});

test("renderPostLinks renders fallback chips only for inline links absent from text", () => {
  const html = renderPostLinks(
    post({
      text: "The text already has https://example.com/inside",
      links: [
        {
          url: "https://example.com/inside",
        },
        {
          url: "https://example.com/outside",
        },
      ],
    }),
  );

  assert.match(html, /link-chip-list/);
  assert.match(html, /example\.com\/outside/);
  assert.doesNotMatch(html, /example\.com\/inside<\/a>/);
  assert.doesNotMatch(html, /link-card/);
});

test("renderPostLinks keeps media-adjacent ordinary external links as chips rather than preview cards", () => {
  const html = renderPostLinks(
    post({
      media: [{ mediaKey: "3_1" }],
      links: [
        {
          url: "https://t.co/photo",
          displayUrl: "pic.x.com/photo",
          expandedUrl: "https://x.com/user/status/1/photo/1",
          mediaKey: "3_1",
        },
        {
          url: "https://example.com/report",
          displayUrl: "example.com/report",
          preview: {
            title: "Report",
          },
        },
      ],
    }),
  );

  assert.match(html, /link-chip-list/);
  assert.match(html, /example\.com\/report/);
  assert.doesNotMatch(html, /pic\.x\.com/);
  assert.doesNotMatch(html, /link-card/);
});

test("renderPostLinks escapes preview and fallback link fields", () => {
  const html = renderPostLinks(
    post({
      links: [
        {
          url: "https://example.com/<script>",
          preview: {
            title: "<b>Title</b>",
            description: "Desc & more",
          },
        },
        {
          url: "https://example.net/<chip>",
        },
      ],
    }),
  );

  assert.match(html, /&lt;b&gt;Title&lt;\/b&gt;/);
  assert.match(html, /Desc &amp; more/);
  assert.match(html, /https:\/\/example\.net\/&lt;chip&gt;/);
  assert.doesNotMatch(html, /<b>Title<\/b>/);
});
