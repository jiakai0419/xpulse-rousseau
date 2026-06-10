import assert from "node:assert/strict";
import { test } from "node:test";
import { readerDisplayPost, repostContextDisplay } from "../../public/reader/postModel.js";

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

test("readerDisplayPost returns the reposted source for reader-facing display", () => {
  const source = post({
    id: "source-post",
    text: "Source text",
    author: author("source-author"),
  });
  const retweet = post({
    id: "retweet-wrapper",
    text: "RT wrapper",
    author: author("reposter"),
    referencedPostType: "retweeted",
    referencedPost: source,
  });

  assert.equal(readerDisplayPost(retweet).id, "source-post");
  assert.equal(readerDisplayPost(source).id, "source-post");
});

test("repostContextDisplay describes only timeline retweets", () => {
  const source = post({ id: "source-post" });
  const retweet = post({
    id: "retweet-wrapper",
    author: {
      id: "retweeter",
      name: "Retweeter Name",
      username: "retweeter",
    },
    referencedPostType: "retweeted",
    referencedPost: source,
  });

  assert.deepEqual(repostContextDisplay(retweet), {
    authorName: "Retweeter Name",
    label: "Retweeter Name reposted",
  });
  assert.equal(repostContextDisplay(source), undefined);
});

test("repostContextDisplay falls back to username when display name is missing", () => {
  const retweet = post({
    author: {
      id: "retweeter",
      name: "",
      username: "retweeter",
    },
    referencedPostType: "retweeted",
    referencedPost: post({ id: "source-post" }),
  });

  assert.deepEqual(repostContextDisplay(retweet), {
    authorName: "retweeter",
    label: "retweeter reposted",
  });
});
