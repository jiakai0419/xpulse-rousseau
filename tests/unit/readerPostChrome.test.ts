import assert from "node:assert/strict";
import { test } from "node:test";
import {
  renderAvatar,
  renderPostChrome,
  renderPostHeader,
  renderRepostContext,
} from "../../public/reader/postChrome.js";

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
    metrics: {},
    seenBy: [],
    ...overrides,
  };
}

test("renderAvatar delegates to reader avatar markup", () => {
  assert.equal(renderAvatar(author({ profileImageUrl: "https://img.example/a.png" })), '<img class="avatar" src="https://img.example/a.png" alt="" loading="lazy" />');
  assert.equal(renderAvatar(author({ name: "<bad>", username: "bad" })), '<div class="avatar">&lt;</div>');
});

test("renderRepostContext renders quiet retweet context only for retweets", () => {
  const source = post({ id: "source" });
  const retweet = post({
    id: "retweet",
    author: author({ name: "<Reposter>", username: "reposter" }),
    referencedPostType: "retweeted",
    referencedPost: source,
  });

  assert.equal(renderRepostContext(source), "");

  const html = renderRepostContext(retweet);
  assert.match(html, /class="repost-context"/);
  assert.match(html, /&lt;Reposter&gt; reposted/);
  assert.match(html, /metric-icon/);
});

test("renderPostHeader renders escaped author, original link, date, and rank", () => {
  const html = renderPostHeader(
    post({
      author: author({
        name: "<Ada>",
        username: "ada<script>",
      }),
      url: "https://x.com/ada/status/1?x=<bad>",
    }),
    7,
  );

  assert.match(html, /class="tweet-head-main"/);
  assert.match(html, /&lt;Ada&gt;/);
  assert.match(html, /@ada&lt;script&gt;/);
  assert.match(html, /datetime="2026-06-10T12:34:00.000Z"/);
  assert.match(html, /<time datetime="2026-06-10T12:34:00.000Z">[^<]+<\/time>/);
  assert.match(html, /href="https:\/\/x\.com\/ada\/status\/1\?x=&lt;bad&gt;"/);
  assert.match(html, /Original/);
  assert.match(html, /#7/);
});

test("renderPostChrome combines repost context, avatar column, and header", () => {
  const source = post({
    id: "source",
    author: author({ name: "Source", username: "source" }),
  });
  const retweet = post({
    id: "retweet",
    author: author({ name: "Reposter", username: "reposter" }),
    referencedPostType: "retweeted",
    referencedPost: source,
  });
  const html = renderPostChrome(retweet, source, 3);

  assert.match(html, /Reposter reposted/);
  assert.match(html, /class="avatar-column"/);
  assert.match(html, /Source/);
  assert.match(html, /@source/);
  assert.match(html, /#3/);
});
