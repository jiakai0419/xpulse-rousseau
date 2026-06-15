import { cleanTextSpacing } from "./format.js";

export function rawUrlsFromText(text) {
  return Array.from(String(text ?? "").matchAll(/https?:\/\/[^\s<>"']+/g), (match) => match[0].replace(/[),.;!?]+$/, ""));
}

export function normalizedPostLinks(post) {
  const explicitLinks = post.links ?? [];
  const dedupedExplicitLinks = [];
  const explicitKeys = new Set();

  for (const link of explicitLinks) {
    const key = `${link.url ?? ""}|${link.expandedUrl ?? ""}|${link.displayUrl ?? ""}|${link.unwoundUrl ?? ""}`;

    if (explicitKeys.has(key)) {
      continue;
    }

    explicitKeys.add(key);
    dedupedExplicitLinks.push(link);
  }

  const seen = new Set(dedupedExplicitLinks.flatMap((link) => [link.url, link.expandedUrl, link.unwoundUrl].filter(Boolean)));
  const fallbackLinks = rawUrlsFromText(post.text)
    .filter((url) => !seen.has(url))
    .map((url) => ({ url }));

  return [...dedupedExplicitLinks, ...fallbackLinks];
}

export function textWithoutPostLinks(text, post) {
  let output = String(text ?? "");
  const urls = new Set([
    ...normalizedPostLinks(post).flatMap((link) => [link.url, link.expandedUrl, link.unwoundUrl].filter(Boolean)),
    ...rawUrlsFromText(output).filter((url) => url.includes("://t.co/")),
  ]);

  for (const url of urls) {
    output = output.replaceAll(url, "");
  }

  return cleanTextSpacing(output);
}

export function linkHref(link) {
  return link.unwoundUrl ?? link.expandedUrl ?? link.url;
}

export function linkDomain(link) {
  try {
    return new URL(linkHref(link)).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function hasUsefulDisplayUrl(link) {
  const displayUrl = link.displayUrl?.trim();

  if (!displayUrl) {
    return false;
  }

  return !displayUrl.toLowerCase().startsWith("t.co/");
}

export function linkPreviewImage(link) {
  const images = link.preview?.images ?? [];

  return images
    .filter((image) => image.url)
    .sort((a, b) => ((b.width ?? 0) * (b.height ?? 0)) - ((a.width ?? 0) * (a.height ?? 0)))[0];
}

export function hasUsefulLinkPreview(link) {
  return Boolean(linkPreviewImage(link) || link.preview?.title || link.preview?.description);
}

export function linkDisplayLabel(link) {
  const displayUrl = link.displayUrl?.trim();

  if (displayUrl) {
    return displayUrl;
  }

  try {
    const url = new URL(linkHref(link));
    return `${url.hostname.replace(/^www\./, "")}${url.pathname}`.replace(/\/$/, "");
  } catch {
    return linkHref(link);
  }
}

export function isMediaLink(link) {
  if (link.mediaKey) {
    return true;
  }

  const value = `${link.displayUrl ?? ""} ${link.expandedUrl ?? ""} ${link.unwoundUrl ?? ""} ${link.url ?? ""}`.toLowerCase();

  return value.includes("pic.x.com") || value.includes("/photo/") || value.includes("/video/") || value.includes("pbs.twimg.com/media");
}

export function isXStatusLink(link) {
  try {
    const url = new URL(linkHref(link));
    const host = url.hostname.replace(/^www\./, "").toLowerCase();

    return (host === "x.com" || host === "twitter.com") && /\/status\/\d+/.test(url.pathname);
  } catch {
    return false;
  }
}

export function isReferencedStatusLink(post, link) {
  if (isMediaLink(link)) {
    return false;
  }

  if (post.referencedPostType !== "quoted") {
    return false;
  }

  if (post.referencedPost?.url && linkHref(link).startsWith(post.referencedPost.url)) {
    return true;
  }

  return isXStatusLink(link);
}

export function linkTokens(link) {
  return Array.from(new Set([link.url, link.expandedUrl, link.unwoundUrl].filter(Boolean)));
}

function linkKey(link) {
  return linkTokens(link).join("|") || linkHref(link);
}

export function shouldRenderPreviewCard(post, link) {
  if (!hasUsefulLinkPreview(link)) {
    return false;
  }

  if (post.media?.length) {
    return false;
  }

  return true;
}

export function primaryPreviewLink(post) {
  return normalizedPostLinks(post).find((link) => shouldRenderPreviewCard(post, link));
}

export function isPrimaryPreviewLink(post, link) {
  const primary = primaryPreviewLink(post);

  return Boolean(primary) && linkKey(primary) === linkKey(link);
}

export function linkTreatment(post, link) {
  if (post.media?.length && isMediaLink(link)) {
    return "media";
  }

  if (isReferencedStatusLink(post, link)) {
    return "quote";
  }

  if (shouldRenderPreviewCard(post, link) && isPrimaryPreviewLink(post, link)) {
    return "preview";
  }

  return "inline";
}

export function linkShouldAppearInText(post, link) {
  const treatment = linkTreatment(post, link);

  if (treatment === "inline") {
    return true;
  }

  if (treatment !== "preview") {
    return false;
  }

  const text = String(post.text ?? "");

  return linkTokens(link).some((token) =>
    findTokenRanges(text, token).some((range) => text.slice(range.end).trim().length > 0),
  );
}

export function textWithoutHiddenPostLinks(text, post) {
  let output = String(text ?? "");
  const hiddenUrls = new Set(
    normalizedPostLinks(post)
      .filter((link) => !linkShouldAppearInText(post, link))
      .flatMap(linkTokens),
  );

  for (const url of hiddenUrls) {
    output = output.replaceAll(url, "");
  }

  return cleanTextSpacing(output);
}

export function linkAppearsInText(text, link) {
  return linkTokens(link).some((token) => String(text ?? "").includes(token));
}

export function findTokenRanges(text, token) {
  const ranges = [];
  let start = text.indexOf(token);

  while (start !== -1) {
    ranges.push({ start, end: start + token.length });
    start = text.indexOf(token, start + token.length);
  }

  return ranges;
}
