import type { PostLink, PostLinkPreview, ReferencedPost, TimelinePost } from "../../domain/tweet.ts";
import { linkPreviewCacheKey, normalizedPreviewTargetUrl, type LinkPreviewCacheRepository } from "./cache.ts";

type FetchLike = typeof fetch;

export type LinkPreviewEnrichmentOptions = {
  cache: LinkPreviewCacheRepository;
  fetcher?: FetchLike;
  now?: Date;
  timeoutMs?: number;
  maxBytes?: number;
};

type ResolvedPreview = {
  finalUrl?: string;
  preview?: PostLinkPreview;
};

const DEFAULT_TIMEOUT_MS = 8000;
const DEFAULT_MAX_BYTES = 1_000_000;
const MAX_REDIRECTS = 4;

function hasPreview(link: PostLink): boolean {
  return Boolean(link.preview?.title || link.preview?.description || link.preview?.images?.some((image) => image.url));
}

function previewTarget(link: PostLink): string | undefined {
  return [link.unwoundUrl, link.expandedUrl, link.url]
    .map((candidate) => candidate?.trim())
    .find((candidate): candidate is string => Boolean(candidate && normalizedPreviewTargetUrl(candidate)));
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".").map((part) => Number(part));

  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }

  const [first, second] = parts;

  return (
    first === 10 ||
    first === 127 ||
    first === 0 ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").replace(/^www\./, "").toLowerCase();

  return (
    host === "localhost" ||
    host === "::1" ||
    host.endsWith(".local") ||
    isPrivateIpv4(host)
  );
}

function isXOwnedUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();

    if (host === "x.com" || host === "twitter.com" || host === "pbs.twimg.com" || host === "video.twimg.com" || host === "pic.x.com") {
      return true;
    }

    return false;
  } catch {
    return true;
  }
}

function shouldFetchPreview(link: PostLink, targetUrl: string): boolean {
  if (link.mediaKey) {
    return false;
  }

  try {
    const url = new URL(targetUrl);

    if (isBlockedHost(url.hostname)) {
      return false;
    }
  } catch {
    return false;
  }

  return !isXOwnedUrl(targetUrl);
}

function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity: string) => {
    const lower = entity.toLowerCase();

    if (lower === "amp") return "&";
    if (lower === "lt") return "<";
    if (lower === "gt") return ">";
    if (lower === "quot") return "\"";
    if (lower === "apos") return "'";
    if (lower === "nbsp") return " ";

    if (lower.startsWith("#x")) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    if (lower.startsWith("#")) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match;
    }

    return match;
  });
}

function cleanMetadataText(value: string | undefined): string | undefined {
  const cleaned = decodeHtmlEntities(value ?? "").replace(/\s+/g, " ").trim();
  return cleaned || undefined;
}

function attributesFromTag(tag: string): Map<string, string> {
  const attributes = new Map<string, string>();
  const attributePattern = /([:\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
  let match: RegExpExecArray | null;

  while ((match = attributePattern.exec(tag))) {
    attributes.set(match[1].toLowerCase(), decodeHtmlEntities(match[2] ?? match[3] ?? match[4] ?? ""));
  }

  return attributes;
}

function firstMetaValue(meta: Map<string, string[]>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = meta.get(key)?.find(Boolean);

    if (value) {
      return cleanMetadataText(value);
    }
  }

  return undefined;
}

function titleFromHtml(html: string): string | undefined {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return cleanMetadataText(match?.[1]);
}

function absoluteUrl(rawUrl: string | undefined, baseUrl: string): string | undefined {
  if (!rawUrl) {
    return undefined;
  }

  try {
    return new URL(rawUrl, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function numberFromText(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

export function parseHtmlLinkPreview(html: string, finalUrl: string): PostLinkPreview | undefined {
  const meta = new Map<string, string[]>();
  const metaPattern = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null;

  while ((match = metaPattern.exec(html))) {
    const attributes = attributesFromTag(match[0]);
    const key = attributes.get("property") ?? attributes.get("name");
    const content = attributes.get("content");

    if (!key || !content) {
      continue;
    }

    const normalizedKey = key.toLowerCase();
    meta.set(normalizedKey, [...(meta.get(normalizedKey) ?? []), content]);
  }

  const title = firstMetaValue(meta, ["og:title", "twitter:title"]) ?? titleFromHtml(html);
  const description = firstMetaValue(meta, ["og:description", "twitter:description", "description"]);
  const imageUrls = [
    ...(meta.get("og:image") ?? []),
    ...(meta.get("og:image:url") ?? []),
    ...(meta.get("twitter:image") ?? []),
    ...(meta.get("twitter:image:src") ?? []),
  ];
  const width = numberFromText(firstMetaValue(meta, ["og:image:width", "twitter:image:width"]));
  const height = numberFromText(firstMetaValue(meta, ["og:image:height", "twitter:image:height"]));
  const seenImages = new Set<string>();
  const images = imageUrls.flatMap((imageUrl) => {
    const url = absoluteUrl(imageUrl, finalUrl);

    if (!url || seenImages.has(url)) {
      return [];
    }

    seenImages.add(url);
    return [{ url, width, height }];
  });

  if (!title && !description && !images.length) {
    return undefined;
  }

  return {
    title,
    description,
    images: images.length ? images : undefined,
  };
}

async function responseTextWithinLimit(response: Response, maxBytes: number): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));

  if (Number.isFinite(contentLength) && contentLength > maxBytes * 3) {
    return "";
  }

  if (!response.body) {
    return response.text();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let output = "";

  try {
    while (bytesRead < maxBytes) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      bytesRead += value.byteLength;
      output += decoder.decode(value, { stream: true });
    }

    output += decoder.decode();
    return output;
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

async function fetchPreviewHtml(rawUrl: string, options: Required<Pick<LinkPreviewEnrichmentOptions, "fetcher" | "timeoutMs" | "maxBytes">>): Promise<ResolvedPreview> {
  let currentUrl = rawUrl;

  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const response = await options.fetcher(currentUrl, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Xpulse/1.0 Safari/537.36",
        },
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");

        if (!location) {
          return {};
        }

        currentUrl = new URL(location, currentUrl).toString();

        if (isXOwnedUrl(currentUrl)) {
          return { finalUrl: currentUrl };
        }

        continue;
      }

      const contentType = response.headers.get("content-type") ?? "";

      if (!response.ok || !/text\/html|application\/xhtml\+xml/i.test(contentType)) {
        return { finalUrl: response.url || currentUrl };
      }

      const finalUrl = response.url || currentUrl;
      const html = await responseTextWithinLimit(response, options.maxBytes);

      return {
        finalUrl,
        preview: parseHtmlLinkPreview(html, finalUrl),
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  return { finalUrl: currentUrl };
}

async function resolveLinkPreview(link: PostLink, options: LinkPreviewEnrichmentOptions): Promise<ResolvedPreview> {
  const target = previewTarget(link);

  if (!target || !shouldFetchPreview(link, target)) {
    return {};
  }

  const targetUrl = normalizedPreviewTargetUrl(target);
  const key = targetUrl ? linkPreviewCacheKey(targetUrl) : undefined;

  if (!targetUrl || !key) {
    return {};
  }

  const cached = await options.cache.get(key);

  if (cached) {
    return {
      finalUrl: cached.finalUrl,
      preview: cached.preview,
    };
  }

  const resolved = await fetchPreviewHtml(targetUrl, {
    fetcher: options.fetcher ?? fetch,
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
  });

  await options.cache.set({
    key,
    targetUrl,
    finalUrl: resolved.finalUrl,
    preview: resolved.preview,
    status: resolved.preview ? "resolved" : "unavailable",
    createdAt: (options.now ?? new Date()).toISOString(),
  });

  return resolved;
}

async function enrichLinks(links: PostLink[] | undefined, options: LinkPreviewEnrichmentOptions): Promise<void> {
  if (!links?.length) {
    return;
  }

  await Promise.all(
    links.map(async (link) => {
      if (hasPreview(link)) {
        return;
      }

      const resolved = await resolveLinkPreview(link, options).catch(() => undefined);

      if (!resolved?.preview) {
        return;
      }

      link.preview = resolved.preview;

      if (resolved.finalUrl && !link.unwoundUrl) {
        link.unwoundUrl = resolved.finalUrl;
      }
    }),
  );
}

async function enrichPost(post: TimelinePost | ReferencedPost, options: LinkPreviewEnrichmentOptions, seen = new Set<string>()): Promise<void> {
  if (seen.has(post.id)) {
    return;
  }

  seen.add(post.id);
  await enrichLinks(post.links, options);

  if (post.referencedPost) {
    await enrichPost(post.referencedPost, options, seen);
  }
}

export async function enrichSelectedPostLinkPreviews(posts: TimelinePost[], options: LinkPreviewEnrichmentOptions): Promise<void> {
  await Promise.all(posts.map((post) => enrichPost(post, options)));
}
