import {
  bucketsFromFlags,
  displayFlags,
  hasPreview,
  isExternalLink,
  isXArticleLink,
  isXStatusLink,
  linkHref,
  readerDisplayPost,
} from "./render-buckets.mjs";

export function compactText(value, maxLength = 120) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function compactEvidenceLine(value, maxLength = 220) {
  const cleaned = String(value ?? "").replace(/\s+/g, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : undefined;
}

function linkDomain(link) {
  try {
    return new URL(linkHref(link)).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function postLinks(post) {
  return post?.links ?? [];
}

export function hasXArticleText(post) {
  return /https?:\/\/(?:www\.)?(?:x|twitter)\.com\/i\/article\//i.test(post?.text ?? "");
}

export function xArticleLinks(post) {
  return postLinks(post).filter(isXArticleLink);
}

function linksWithMissingPreview(post) {
  return postLinks(post).filter((link) => isExternalLink(link) && !hasPreview(link));
}

function linksWithTextOnlyPreview(post) {
  return postLinks(post).filter((link) => {
    if (!isExternalLink(link) || !hasPreview(link)) {
      return false;
    }

    return !(link.preview?.images ?? []).some((image) => image.url);
  });
}

function postHasPlayableVideo(post) {
  return Boolean(
    post?.media?.some(
      (media) =>
        (media.type === "video" || media.type === "animated_gif") &&
        (media.variants ?? []).some((variant) => variant.url && (!variant.contentType || variant.contentType.includes("mp4"))),
    ),
  );
}

export function detectMissingData(timelinePost, displayPost) {
  const missing = new Set();
  const quote = displayPost.referencedPostType === "quoted" ? displayPost.referencedPost : undefined;

  if (displayPost.referencedPostType === "quoted" && !displayPost.referencedPost) {
    missing.add("quoted_post_body");
  }

  for (const media of [...(displayPost.media ?? []), ...(quote?.media ?? [])]) {
    if (!media.width || !media.height) {
      missing.add("media_dimensions");
    }

    if (media.type === "photo" && !media.url) {
      missing.add("photo_url");
    }

    if ((media.type === "video" || media.type === "animated_gif") && !(media.variants ?? []).some((variant) => variant.url)) {
      missing.add("video_variants");
    }
  }

  if (xArticleLinks(displayPost).length && !postLinks(displayPost).some((link) => isXArticleLink(link) && hasPreview(link))) {
    missing.add("x_article_preview_metadata");
  }

  if ((xArticleLinks(quote).length || hasXArticleText(quote)) && !postLinks(quote).some((link) => isXArticleLink(link) && hasPreview(link))) {
    missing.add("quoted_x_article_preview_metadata");
  }

  if (timelinePost.referencedPostType === "retweeted" && !timelinePost.referencedPost) {
    missing.add("retweeted_source_body");
  }

  return [...missing].sort();
}

export function detectRisks(timelinePost, displayPost) {
  const risks = new Set();
  const quote = displayPost.referencedPostType === "quoted" ? displayPost.referencedPost : undefined;

  if (timelinePost.referencedPostType === "retweeted" && displayPost.referencedPostType === "quoted") {
    risks.add("repost_of_quote");
  }

  if (displayPost.referencedPostType === "quoted" && !displayPost.referencedPost) {
    risks.add("quote_placeholder");
  }

  if (xArticleLinks(displayPost).length || hasXArticleText(displayPost)) {
    risks.add("main_x_article_link");
  }

  if (xArticleLinks(quote).length || hasXArticleText(quote)) {
    risks.add("quote_x_article_link");
  }

  if ((xArticleLinks(quote).length || hasXArticleText(quote)) && !(quote?.media ?? []).length) {
    risks.add("quote_x_article_card_likely");
  }

  if (linksWithMissingPreview(displayPost).length || linksWithMissingPreview(quote).length) {
    risks.add("external_link_without_preview_metadata");
  }

  if (linksWithTextOnlyPreview(displayPost).length || linksWithTextOnlyPreview(quote).length) {
    risks.add("external_preview_without_image");
  }

  if ((displayPost.media ?? []).length && postLinks(displayPost).some(isExternalLink)) {
    risks.add("media_plus_external_link");
  }

  if (displayPost.referencedPostType === "quoted" && (displayPost.media ?? []).length) {
    risks.add("media_plus_quote");
  }

  if (postLinks(displayPost).some(isXStatusLink) && !displayPost.referencedPost) {
    risks.add("x_status_link_without_quote_body");
  }

  if ((displayPost.media ?? []).some((media) => media.type === "video" || media.type === "animated_gif") && !postHasPlayableVideo(displayPost)) {
    risks.add("video_without_playable_variant");
  }

  if ((quote?.media ?? []).some((media) => media.type === "video" || media.type === "animated_gif") && !postHasPlayableVideo(quote)) {
    risks.add("quote_video_without_playable_variant");
  }

  return [...risks].sort();
}

export function inventorySampleFromRawSample(rawSample, pool, index) {
  const timelinePost = rawSample.timelinePost;
  const displayPost = rawSample.displayPost ?? readerDisplayPost(timelinePost);
  const flags = rawSample.flags ?? displayFlags(timelinePost);

  return {
    index,
    pool,
    runId: rawSample.runId,
    runCreatedAt: rawSample.runCreatedAt,
    fetchIndex: rawSample.fetchIndex,
    selectedIndex: rawSample.selectedIndex,
    timelinePost,
    displayPost,
    flags,
    buckets: rawSample.buckets ?? bucketsFromFlags(flags),
    risks: detectRisks(timelinePost, displayPost),
    missingData: detectMissingData(timelinePost, displayPost),
  };
}

export function refreshInventorySampleDerivedFields(sample) {
  sample.displayPost = readerDisplayPost(sample.timelinePost);
  sample.flags = displayFlags(sample.timelinePost);
  sample.buckets = bucketsFromFlags(sample.flags);
  sample.risks = detectRisks(sample.timelinePost, sample.displayPost);
  sample.missingData = detectMissingData(sample.timelinePost, sample.displayPost);
}

function looksLikeUiOrMetricLine(line) {
  return (
    /^@\w/.test(line) ||
    /^(\d[\d,.]*|\d+(?:\.\d+)?[KMB])$/.test(line) ||
    /^(\d[\d,.]*|\d+(?:\.\d+)?[KMB])\s+Views$/i.test(line) ||
    /^(Quote|Relevant|View quotes|Subscribe|Following|Reply|Post|Article)$/i.test(line) ||
    /^\d{1,2}:\d{2}\s+[AP]M\s+·/i.test(line)
  );
}

function evidenceLines(entry) {
  return String(entry?.facts?.textStart ?? entry?.facts?.text ?? "")
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

export function xArticlePreviewFromEvidence(entry) {
  const lines = evidenceLines(entry);
  const articleIndex = lines.findIndex((line) => /^Article$/i.test(line));

  if (articleIndex >= 0) {
    const title = compactEvidenceLine(lines[articleIndex + 1]);
    const description = lines.slice(articleIndex + 2).map((line) => compactEvidenceLine(line)).find(Boolean);

    return title ? { title, description } : undefined;
  }

  const handleIndex = lines.findIndex((line) => /^@\w/.test(line));
  const contentStart = handleIndex >= 0 ? handleIndex + 1 : 0;
  const titleIndex = lines.findIndex((line, index) => index >= contentStart && !looksLikeUiOrMetricLine(line));
  const title = compactEvidenceLine(titleIndex >= 0 ? lines[titleIndex] : undefined);
  const description =
    titleIndex >= 0
      ? lines
          .slice(titleIndex + 1)
          .map((line) => (looksLikeUiOrMetricLine(line) ? undefined : compactEvidenceLine(line)))
          .find(Boolean)
      : undefined;

  return title ? { title, description } : undefined;
}

export function enrichPostXArticlePreviewsFromEvidence(post, entry, seen = new Set()) {
  if (!post || seen.has(post.id)) {
    return 0;
  }

  seen.add(post.id);
  let enriched = 0;
  const preview = xArticlePreviewFromEvidence(entry);

  if (preview) {
    for (const link of post.links ?? []) {
      if (isXArticleLink(link) && !hasPreview(link)) {
        link.preview = preview;
        enriched += 1;
      }
    }
  }

  return enriched + enrichPostXArticlePreviewsFromEvidence(post.referencedPost, entry, seen);
}

export function inventorySampleForJson(sample) {
  const allLinks = postLinks(sample.displayPost);
  const quote = sample.displayPost.referencedPostType === "quoted" ? sample.displayPost.referencedPost : undefined;

  return {
    index: sample.index,
    pool: sample.pool,
    runId: sample.runId,
    runCreatedAt: sample.runCreatedAt,
    fetchIndex: sample.fetchIndex,
    selectedIndex: sample.selectedIndex,
    postId: sample.displayPost.id,
    timelinePostId: sample.timelinePost.id,
    url: sample.displayPost.url,
    author: sample.displayPost.author,
    textStart: compactText(sample.displayPost.text, 240),
    buckets: sample.buckets,
    risks: sample.risks,
    missingData: sample.missingData,
    xArticlePreviewEvidenceApplied: sample.xArticlePreviewEvidenceApplied ?? 0,
    flags: sample.flags,
    metrics: sample.displayPost.metrics,
    media: (sample.displayPost.media ?? []).map((media) => ({
      type: media.type,
      width: media.width,
      height: media.height,
      hasUrl: Boolean(media.url),
      hasPreviewImageUrl: Boolean(media.previewImageUrl),
      variantCount: media.variants?.length ?? 0,
    })),
    links: allLinks.map((link) => ({
      domain: linkDomain(link),
      href: linkHref(link),
      displayUrl: link.displayUrl,
      isExternal: isExternalLink(link),
      isXStatus: isXStatusLink(link),
      isXArticle: isXArticleLink(link),
      hasPreview: hasPreview(link),
      previewHasImage: Boolean((link.preview?.images ?? []).some((image) => image.url)),
      title: link.preview?.title,
      description: link.preview?.description,
    })),
    quote: quote
      ? {
          id: quote.id,
          url: quote.url,
          author: quote.author,
          textStart: compactText(quote.text, 200),
          mediaCount: quote.media?.length ?? 0,
          linkCount: quote.links?.length ?? 0,
          xArticleLinks: xArticleLinks(quote).map(linkHref),
          hasXArticleText: hasXArticleText(quote),
        }
      : undefined,
    localScreenshot: sample.localScreenshot,
    localScreenshotProbe: sample.localScreenshotProbe,
    localFacts: sample.localFacts,
  };
}
