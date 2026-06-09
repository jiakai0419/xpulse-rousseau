import { escapeHtml } from "./format.js";

export function mediaImageUrl(media) {
  return media.url ?? media.previewImageUrl;
}

export function proxiedVideoUrl(url) {
  if (!url) {
    return "";
  }

  try {
    const parsed = new URL(url);

    if (parsed.protocol === "https:" && parsed.hostname === "video.twimg.com") {
      return `/api/media/proxy?url=${encodeURIComponent(url)}`;
    }
  } catch {
    return url;
  }

  return url;
}

export function variantDimensions(url) {
  const match = String(url ?? "").match(/\/(\d+)x(\d+)\//);

  if (!match) {
    return undefined;
  }

  return {
    width: Number(match[1]),
    height: Number(match[2]),
  };
}

export function variantFitsInline(variant, size) {
  const bitRate = variant.bitRate ?? 0;

  if (!size) {
    return bitRate === 0 || bitRate <= 12000000;
  }

  return size.width <= 1920 && size.height <= 1080 && (bitRate === 0 || bitRate <= 12000000);
}

export function mediaVideoUrl(media) {
  const variants = (media.variants ?? []).filter((variant) => variant.url);
  const playable = variants
    .filter((variant) => !variant.contentType || variant.contentType.includes("mp4"))
    .sort((left, right) => {
      const leftSize = variantDimensions(left.url);
      const rightSize = variantDimensions(right.url);
      const leftFitsInline = variantFitsInline(left, leftSize);
      const rightFitsInline = variantFitsInline(right, rightSize);

      if (leftFitsInline !== rightFitsInline) {
        return leftFitsInline ? -1 : 1;
      }

      return (right.bitRate ?? 0) - (left.bitRate ?? 0);
    });

  return playable[0]?.url ?? variants[0]?.url;
}

export function fullSizeMediaUrl(media) {
  const source = mediaImageUrl(media);

  if (!source || media.type !== "photo") {
    return source;
  }

  try {
    const url = new URL(source);

    if (url.hostname === "pbs.twimg.com" && url.pathname.startsWith("/media/")) {
      const extension = url.pathname.match(/\.([a-zA-Z0-9]+)$/)?.[1];

      if (extension) {
        url.searchParams.set("format", extension.toLowerCase());
      }

      url.searchParams.set("name", "orig");
      return url.toString();
    }
  } catch {
    return source;
  }

  return source;
}

export function mediaAspectRatio(media) {
  if (media.width && media.height) {
    return `${escapeHtml(media.width)} / ${escapeHtml(media.height)}`;
  }

  return media.type === "video" || media.type === "animated_gif" ? "16 / 9" : "1 / 1";
}

export function mediaAspectRatioValue(media) {
  if (media.width && media.height) {
    return Math.max(0.1, Math.min(4, media.width / media.height)).toFixed(4);
  }

  return media.type === "video" || media.type === "animated_gif" ? "1.7778" : "1";
}

export function mediaRatioNumber(media) {
  if (media.width && media.height) {
    return Math.max(0.1, Math.min(4, media.width / media.height));
  }

  return media.type === "video" || media.type === "animated_gif" ? 16 / 9 : 1;
}

export function mediaGalleryAspectRatio(media, count) {
  if (count === 2) {
    return { css: "16 / 9", value: 16 / 9 };
  }

  if (count === 3 || count === 4) {
    const ratios = media.slice(0, count).map(mediaRatioNumber);
    const allLandscape = ratios.every((ratio) => ratio >= 1.2);

    return allLandscape ? { css: "16 / 9", value: 16 / 9 } : { css: "1 / 1", value: 1 };
  }

  return undefined;
}

export function singleMediaWidth(media) {
  if (!media.width || !media.height) {
    return "100%";
  }

  const ratio = Math.max(0.1, Math.min(4, media.width / media.height));

  return `${Math.round(ratio * 510)}px`;
}

export function formatMediaDuration(durationMs) {
  const milliseconds = Number(durationMs);

  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    return "";
  }

  const totalSeconds = Math.max(1, Math.floor(milliseconds / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
