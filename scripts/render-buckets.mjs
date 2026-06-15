export const defaultRequiredRenderBuckets = [
  "retweet",
  "quote",
  "quote-media",
  "quote-video",
  "x-article-link",
  "quote-x-article-link",
  "single-photo",
  "single-video",
  "playable-video",
  "multi-media",
  "external-preview",
  "external-no-preview",
  "media-plus-link",
  "x-status-link",
  "text-only",
];

export function readerDisplayPost(post) {
  if (post?.referencedPostType === "retweeted" && post.referencedPost) {
    return post.referencedPost;
  }

  return post;
}

export function linkHref(link) {
  return link.unwoundUrl ?? link.expandedUrl ?? link.url ?? "";
}

export function linkHost(link) {
  try {
    return new URL(linkHref(link)).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

export function isXHost(hostname) {
  return hostname === "x.com" || hostname === "twitter.com" || hostname.endsWith(".x.com") || hostname.endsWith(".twitter.com");
}

export function isXStatusLink(link) {
  try {
    const url = new URL(linkHref(link));
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    return isXHost(host) && /\/status\/\d+/.test(url.pathname);
  } catch {
    return false;
  }
}

export function isXArticleLink(link) {
  try {
    const url = new URL(linkHref(link));
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    return isXHost(host) && /^\/i\/article\//.test(url.pathname);
  } catch {
    return false;
  }
}

export function isMediaLink(link) {
  if (link.mediaKey) {
    return true;
  }

  const value = `${link.displayUrl ?? ""} ${link.expandedUrl ?? ""} ${link.unwoundUrl ?? ""} ${link.url ?? ""}`.toLowerCase();
  return value.includes("pic.x.com") || value.includes("/photo/") || value.includes("/video/") || value.includes("pbs.twimg.com/media");
}

export function isExternalLink(link) {
  const host = linkHost(link);
  if (!host) {
    return false;
  }

  return !isXHost(host) && host !== "t.co" && !host.endsWith("twimg.com");
}

export function hasPreview(link) {
  return Boolean(link.preview?.title || link.preview?.description || (link.preview?.images ?? []).some((image) => image.url));
}

export function hasPlayableVideo(media) {
  return (media.variants ?? []).some((variant) => variant.url && (!variant.contentType || variant.contentType.includes("mp4")));
}

export function displayFlags(timelinePost) {
  const display = readerDisplayPost(timelinePost);
  const links = display.links ?? [];
  const media = display.media ?? [];
  const quoted = display.referencedPostType === "quoted" ? display.referencedPost : undefined;
  const quotedLinks = quoted?.links ?? [];
  const quotedMedia = quoted?.media ?? [];

  return {
    retweet: timelinePost.referencedPostType === "retweeted" && Boolean(timelinePost.referencedPost),
    quote: display.referencedPostType === "quoted",
    quoteMissingBody: display.referencedPostType === "quoted" && !display.referencedPost,
    quoteHasMedia: quotedMedia.length > 0,
    quoteHasVideo: quotedMedia.some((item) => item.type === "video" || item.type === "animated_gif"),
    mediaCount: media.length,
    singlePhoto: media.length === 1 && media[0]?.type === "photo",
    singleVideo: media.length === 1 && (media[0]?.type === "video" || media[0]?.type === "animated_gif"),
    playableVideo: media.some((item) => (item.type === "video" || item.type === "animated_gif") && hasPlayableVideo(item)),
    multiMedia: media.length > 1,
    externalLinks: links.filter(isExternalLink).length,
    externalPreviewLinks: links.filter((link) => isExternalLink(link) && hasPreview(link)).length,
    externalNoPreviewLinks: links.filter((link) => isExternalLink(link) && !hasPreview(link)).length,
    xStatusLinks: links.filter(isXStatusLink).length,
    xArticleLinks: links.filter(isXArticleLink).length,
    quoteXArticleLinks: quotedLinks.filter(isXArticleLink).length,
    mediaLinks: links.filter(isMediaLink).length,
    textOnly: media.length === 0 && links.length === 0 && display.referencedPostType !== "quoted",
  };
}

export const renderBucketDefinitions = [
  ["retweet", (flags) => flags.retweet],
  ["quote", (flags) => flags.quote],
  ["quote-media", (flags) => flags.quoteHasMedia],
  ["quote-video", (flags) => flags.quoteHasVideo],
  ["quote-missing-body", (flags) => flags.quoteMissingBody],
  ["single-photo", (flags) => flags.singlePhoto],
  ["single-video", (flags) => flags.singleVideo],
  ["playable-video", (flags) => flags.playableVideo],
  ["multi-media", (flags) => flags.multiMedia],
  ["external-preview", (flags) => flags.externalPreviewLinks > 0],
  ["external-no-preview", (flags) => flags.externalNoPreviewLinks > 0],
  ["media-plus-link", (flags) => flags.mediaCount > 0 && flags.externalLinks > 0],
  ["x-status-link", (flags) => flags.xStatusLinks > 0],
  ["x-article-link", (flags) => flags.xArticleLinks > 0],
  ["quote-x-article-link", (flags) => flags.quoteXArticleLinks > 0],
  ["media-link", (flags) => flags.mediaLinks > 0],
  ["text-only", (flags) => flags.textOnly],
];

export function bucketsFromFlags(flags) {
  return renderBucketDefinitions.filter(([, predicate]) => predicate(flags)).map(([bucket]) => bucket);
}

export function postBuckets(timelinePost) {
  return new Set(bucketsFromFlags(displayFlags(timelinePost)));
}

export function runCoverage(run) {
  const buckets = new Set();

  for (const selected of run.selectedPosts ?? []) {
    for (const bucket of postBuckets(selected.post)) {
      buckets.add(bucket);
    }
  }

  return buckets;
}

export function buildSamplePool(runs) {
  const pool = [];
  const seen = new Set();

  for (const run of runs) {
    for (const snapshot of run.trace?.inputPosts ?? []) {
      const display = readerDisplayPost(snapshot.post);
      const key = display.id;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      pool.push({
        runId: run.id,
        runCreatedAt: run.createdAt,
        fetchIndex: snapshot.fetchIndex,
        timelinePost: snapshot.post,
        displayPost: display,
        flags: displayFlags(snapshot.post),
        buckets: bucketsFromFlags(displayFlags(snapshot.post)),
      });
    }
  }

  return pool.sort((left, right) => {
    const timeDelta = Date.parse(right.runCreatedAt) - Date.parse(left.runCreatedAt);
    if (timeDelta !== 0) {
      return timeDelta;
    }

    return left.fetchIndex - right.fetchIndex;
  });
}

export function buildSelectedSamplePool(runs) {
  const pool = [];
  const seen = new Set();

  for (const run of runs) {
    for (const [index, selected] of (run.selectedPosts ?? []).entries()) {
      const display = readerDisplayPost(selected.post);
      const key = display.id;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      pool.push({
        runId: run.id,
        runCreatedAt: run.createdAt,
        selectedIndex: index,
        timelinePost: selected.post,
        displayPost: display,
        flags: displayFlags(selected.post),
        buckets: bucketsFromFlags(displayFlags(selected.post)),
      });
    }
  }

  return pool.sort((left, right) => {
    const timeDelta = Date.parse(right.runCreatedAt) - Date.parse(left.runCreatedAt);
    if (timeDelta !== 0) {
      return timeDelta;
    }

    return left.selectedIndex - right.selectedIndex;
  });
}
