import assert from "node:assert/strict";
import { test } from "node:test";
import { renderTranslation, translationText } from "../../public/reader/translation.js";

function post(overrides: Record<string, unknown> = {}) {
  return {
    id: "post-1",
    text: "Source text https://t.co/source",
    links: [
      {
        url: "https://t.co/source",
        expandedUrl: "https://example.com/source",
        displayUrl: "example.com/source",
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

test("translationText reads the selected post Chinese translation", () => {
  assert.equal(
    translationText({
      post: post(),
      translation: {
        textZh: "中文译文",
      },
    }),
    "中文译文",
  );
  assert.equal(translationText({ post: post() }), undefined);
});

test("renderTranslation keeps the pending state stable", () => {
  const html = renderTranslation({ post: post() });

  assert.match(html, /lang="zh-CN"/);
  assert.match(html, /Chinese translation/);
  assert.match(html, /Translation pending/);
  assert.match(html, /muted-text/);
});

test("renderTranslation removes source post links and escapes translated text", () => {
  const html = withDocument(() =>
    renderTranslation({
      post: post(),
      translation: {
        textZh: "中文 https://t.co/source <script>",
      },
    }),
  );

  assert.doesNotMatch(html, /https:\/\/t\.co\/source/);
  assert.match(html, /中文 &lt;script&gt;/);
});
