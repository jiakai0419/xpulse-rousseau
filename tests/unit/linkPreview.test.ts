import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  FileLinkPreviewCacheRepository,
  type LinkPreviewCacheRecord,
  type LinkPreviewCacheRepository,
} from "../../src/services/linkPreview/cache.ts";
import { enrichSelectedPostLinkPreviews, parseHtmlLinkPreview } from "../../src/services/linkPreview/enrich.ts";
import { fetchLinkPreviewImage } from "../../src/services/linkPreview/imageProxy.ts";
import {
  isSupportedLinkPreviewResponseStatus,
  validatedLinkPreviewAddresses,
  type LinkPreviewHostnameResolver,
} from "../../src/services/linkPreview/safeRequest.ts";
import { testPost } from "../helpers/posts.ts";

const resolvePublicHostname: LinkPreviewHostnameResolver = async () => [{ address: "93.184.216.34", family: 4 }];

test("link preview transport rejects statuses that WHATWG Response cannot represent", () => {
  assert.equal(isSupportedLinkPreviewResponseStatus(200), true);
  assert.equal(isSupportedLinkPreviewResponseStatus(599), true);
  assert.equal(isSupportedLinkPreviewResponseStatus(199), false);
  assert.equal(isSupportedLinkPreviewResponseStatus(600), false);
  assert.equal(isSupportedLinkPreviewResponseStatus(Number.NaN), false);
});

test("oversized link preview responses cancel their body stream", async () => {
  const cache = memoryLinkPreviewCache();
  let canceled = false;
  const post = testPost({
    id: "oversized-preview",
    links: [{ url: "https://large.example/story", expandedUrl: "https://large.example/story" }],
  });

  await enrichSelectedPostLinkPreviews([post], {
    cache,
    maxBytes: 100,
    resolveHostname: resolvePublicHostname,
    requester: async () => new Response(new ReadableStream({
      cancel() {
        canceled = true;
      },
    }), {
      status: 200,
      headers: {
        "content-type": "text/html",
        "content-length": "301",
      },
    }),
  });

  assert.equal(canceled, true);
  assert.equal(post.links?.[0].preview, undefined);
});

function memoryLinkPreviewCache(): LinkPreviewCacheRepository & { records: Map<string, LinkPreviewCacheRecord> } {
  const records = new Map<string, LinkPreviewCacheRecord>();

  return {
    records,
    async get(key) {
      return records.get(key);
    },
    async set(record) {
      records.set(record.key, record);
    },
  };
}

test("parseHtmlLinkPreview reads Open Graph and Twitter metadata", () => {
  const preview = parseHtmlLinkPreview(
    `
      <html>
        <head>
          <meta property="og:title" content="Making Claude a chemist">
          <meta name="description" content="Anthropic science note &amp; demo">
          <meta property="og:image" content="/card.png">
          <meta property="og:image:width" content="1200">
          <meta property="og:image:height" content="628">
        </head>
      </html>
    `,
    "https://anthropic.com/news/claude-chemist",
  );

  assert.equal(preview?.title, "Making Claude a chemist");
  assert.equal(preview?.description, "Anthropic science note & demo");
  assert.equal(preview?.images?.[0].url, "https://anthropic.com/card.png");
  assert.equal(preview?.images?.[0].width, 1200);
  assert.equal(preview?.images?.[0].height, 628);
});

test("parseHtmlLinkPreview drops non-HTTP image metadata", () => {
  const preview = parseHtmlLinkPreview(
    `<meta property="og:title" content="Safe title"><meta property="og:image" content="data:image/svg+xml,bad">`,
    "https://public.example/story",
  );

  assert.equal(preview?.title, "Safe title");
  assert.equal(preview?.images, undefined);
});

test("link preview image proxy returns only bounded raster image content", async () => {
  const image = await fetchLinkPreviewImage("https://images.example/card.png", {
    resolveHostname: resolvePublicHostname,
    requester: async (_url, options) => {
      assert.deepEqual(options.addresses, [{ address: "93.184.216.34", family: 4 }]);
      return new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "image/png", "content-length": "4" },
      });
    },
  });

  assert.equal(image.contentType, "image/png");
  assert.equal(image.finalUrl, "https://images.example/card.png");
  assert.deepEqual([...image.body], [1, 2, 3, 4]);
});

test("link preview image proxy revalidates redirects before any browser-visible load", async () => {
  const requested: string[] = [];

  await assert.rejects(
    fetchLinkPreviewImage("https://images.example/card.png", {
      resolveHostname: resolvePublicHostname,
      requester: async (url) => {
        requested.push(url);
        return new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1:8080/private.png" },
        });
      },
    }),
    /local or private network address/,
  );

  assert.deepEqual(requested, ["https://images.example/card.png"]);
});

test("link preview image proxy rejects oversized or non-raster responses", async () => {
  await assert.rejects(
    fetchLinkPreviewImage("https://images.example/card.png", {
      maxBytes: 3,
      resolveHostname: resolvePublicHostname,
      requester: async () => new Response(new Uint8Array([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    }),
    /exceeds the 3-byte limit/,
  );

  await assert.rejects(
    fetchLinkPreviewImage("https://images.example/card.svg", {
      resolveHostname: resolvePublicHostname,
      requester: async () => new Response("<svg/>", {
        status: 200,
        headers: { "content-type": "image/svg+xml" },
      }),
    }),
    /not a supported raster image/,
  );
});

test("enrichSelectedPostLinkPreviews fetches and caches external preview metadata", async () => {
  const cache = memoryLinkPreviewCache();
  let fetchCount = 0;
  const post = testPost({
    id: "external-link",
    text: "Read this https://t.co/story",
    links: [
      {
        url: "https://t.co/story",
        expandedUrl: "https://example.com/story",
        displayUrl: "example.com/story",
      },
    ],
  });

  const fetcher: typeof fetch = async () => {
    fetchCount += 1;
    return new Response(
      `
        <html>
          <head>
            <meta property="og:title" content="Story title">
            <meta property="og:description" content="Story summary">
            <meta property="og:image" content="https://cdn.example.com/story.jpg">
          </head>
        </html>
      `,
      { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  };

  await enrichSelectedPostLinkPreviews([post], {
    cache,
    fetcher,
    resolveHostname: resolvePublicHostname,
    now: new Date("2026-06-07T00:00:00.000Z"),
  });

  assert.equal(fetchCount, 1);
  assert.equal(post.links?.[0].preview?.title, "Story title");
  assert.equal(post.links?.[0].preview?.description, "Story summary");
  assert.equal(post.links?.[0].preview?.images?.[0].url, "https://cdn.example.com/story.jpg");
  assert.equal(cache.records.size, 1);

  const secondPost = testPost({
    id: "external-link-again",
    text: "Same link https://t.co/story2",
    links: [
      {
        url: "https://t.co/story2",
        expandedUrl: "https://example.com/story",
        displayUrl: "example.com/story",
      },
    ],
  });

  await enrichSelectedPostLinkPreviews([secondPost], {
    cache,
    fetcher,
    resolveHostname: resolvePublicHostname,
    now: new Date("2026-06-07T00:00:00.000Z"),
  });

  assert.equal(fetchCount, 1);
  assert.equal(secondPost.links?.[0].preview?.title, "Story title");
});

test("enrichSelectedPostLinkPreviews skips X media/status links and existing previews", async () => {
  const cache = memoryLinkPreviewCache();
  let fetchCount = 0;
  const post = testPost({
    id: "skip-links",
    text: "Media and quote https://t.co/photo https://x.com/user/status/123",
    links: [
      {
        url: "https://t.co/photo",
        displayUrl: "pic.x.com/photo",
        mediaKey: "media-1",
      },
      {
        url: "https://x.com/user/status/123",
        expandedUrl: "https://x.com/user/status/123",
        displayUrl: "x.com/user/status/123",
      },
      {
        url: "https://t.co/article",
        expandedUrl: "https://x.com/i/article/2063647807437705216",
        displayUrl: "x.com/i/article/2063…",
      },
      {
        url: "https://t.co/ready",
        expandedUrl: "https://example.com/ready",
        displayUrl: "example.com/ready",
        preview: { title: "Already resolved" },
      },
    ],
  });
  const fetcher: typeof fetch = async () => {
    fetchCount += 1;
    throw new Error("fetch should not be called");
  };

  await enrichSelectedPostLinkPreviews([post], { cache, fetcher });

  assert.equal(fetchCount, 0);
  assert.equal(post.links?.[3].preview?.title, "Already resolved");
  assert.equal(cache.records.size, 0);
});

test("enrichSelectedPostLinkPreviews blocks redirect targets on local and private networks", async () => {
  const blockedTargets = [
    "http://127.0.0.1:4321/private",
    "http://169.254.169.254/latest/meta-data",
    "http://[::1]/private",
    "http://[fd00::1]/private",
    "http://[::ffff:7f00:1]/private",
  ];

  for (const [index, blockedTarget] of blockedTargets.entries()) {
    const cache = memoryLinkPreviewCache();
    const requested: string[] = [];
    const post = testPost({
      id: `redirect-${index}`,
      links: [{ url: "https://public.example/start", expandedUrl: "https://public.example/start" }],
    });

    await enrichSelectedPostLinkPreviews([post], {
      cache,
      resolveHostname: resolvePublicHostname,
      requester: async (url) => {
        requested.push(url);
        return new Response(null, { status: 302, headers: { location: blockedTarget } });
      },
    });

    assert.deepEqual(requested, ["https://public.example/start"]);
    assert.equal(cache.records.size, 0);
    assert.equal(post.links?.[0].preview, undefined);
  }
});

test("enrichSelectedPostLinkPreviews re-resolves every redirect hop and rejects private DNS answers", async () => {
  const cache = memoryLinkPreviewCache();
  const resolvedHosts: string[] = [];
  const requested: string[] = [];
  const post = testPost({
    id: "redirect-private-dns",
    links: [{ url: "https://first.example/start", expandedUrl: "https://first.example/start" }],
  });

  await enrichSelectedPostLinkPreviews([post], {
    cache,
    resolveHostname: async (hostname) => {
      resolvedHosts.push(hostname);
      return hostname === "first.example"
        ? [{ address: "93.184.216.34", family: 4 }]
        : [{ address: "192.168.1.10", family: 4 }];
    },
    requester: async (url) => {
      requested.push(url);
      return new Response(null, {
        status: 302,
        headers: { location: "https://second.example/private" },
      });
    },
  });

  assert.deepEqual(resolvedHosts, ["first.example", "second.example"]);
  assert.deepEqual(requested, ["https://first.example/start"]);
  assert.equal(cache.records.size, 0);
});

test("validatedLinkPreviewAddresses rejects any mixed private DNS answer and IPv6 local forms", async () => {
  await assert.rejects(
    validatedLinkPreviewAddresses("https://mixed.example/story", async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.8", family: 4 },
    ]),
    /local or private network address/,
  );

  for (const url of [
    "http://[::1]/",
    "http://[fe80::1]/",
    "http://[fc00::1234]/",
    "http://[::ffff:7f00:1]/",
  ]) {
    await assert.rejects(validatedLinkPreviewAddresses(url), /local or private network address/);
  }
});

test("validatedLinkPreviewAddresses keeps ordinary public IPv4 and IPv6 targets available", async () => {
  const publicAddresses = [
    { address: "93.184.216.34", family: 4 },
    { address: "2606:4700:4700::1111", family: 6 },
  ] as const;

  assert.deepEqual(
    await validatedLinkPreviewAddresses("https://public.example/story", async () => publicAddresses),
    publicAddresses,
  );
  assert.deepEqual(
    await validatedLinkPreviewAddresses("https://[2606:4700:4700::1111]/story"),
    [publicAddresses[1]],
  );
});

test("enrichSelectedPostLinkPreviews passes the validated DNS result to the connection requester", async () => {
  const cache = memoryLinkPreviewCache();
  const validatedAddress = { address: "93.184.216.34", family: 4 } as const;
  let resolveCount = 0;
  let connectedAddresses: readonly { address: string; family: 4 | 6 }[] = [];
  const post = testPost({
    id: "pinned-address",
    links: [{ url: "https://pin.example/story", expandedUrl: "https://pin.example/story" }],
  });

  await enrichSelectedPostLinkPreviews([post], {
    cache,
    resolveHostname: async () => {
      resolveCount += 1;
      return resolveCount === 1
        ? [validatedAddress]
        : [{ address: "127.0.0.1", family: 4 }];
    },
    requester: async (_url, options) => {
      connectedAddresses = options.addresses;
      return new Response("<title>Pinned safely</title>", {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    },
  });

  assert.equal(resolveCount, 1);
  assert.deepEqual(connectedAddresses, [validatedAddress]);
  assert.equal(post.links?.[0].preview?.title, "Pinned safely");
});

test("FileLinkPreviewCacheRepository preserves concurrent writes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xpulse-link-preview-cache-"));
  const filePath = join(dir, "link-preview-cache.json");
  const cache = new FileLinkPreviewCacheRepository(filePath);

  try {
    await Promise.all(Array.from({ length: 40 }, (_, index) => cache.set({
      key: `key-${index}`,
      targetUrl: `https://example.com/${index}`,
      status: "resolved",
      preview: { title: `Preview ${index}` },
      createdAt: "2026-07-12T00:00:00.000Z",
    })));

    const store = JSON.parse(await readFile(filePath, "utf8")) as { records: LinkPreviewCacheRecord[] };

    assert.equal(store.records.length, 40);
    assert.equal(new Set(store.records.map((record) => record.key)).size, 40);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
