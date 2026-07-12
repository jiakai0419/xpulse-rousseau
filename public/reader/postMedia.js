import { escapeHtml } from "./format.js";
import {
  formatMediaDuration,
  fullSizeMediaUrl,
  mediaAspectRatio,
  mediaAspectRatioValue,
  mediaGalleryAspectRatio,
  mediaImageUrl,
  mediaVideoUrl,
  proxiedVideoUrl,
  singleMediaWidth,
} from "./mediaRules.js";

export function renderPostMedia(post) {
  const media = (post.media ?? []).filter((item) => {
    if (!mediaImageUrl(item)) {
      return false;
    }

    if (item.type === "video" || item.type === "animated_gif") {
      return Boolean(mediaVideoUrl(item));
    }

    return true;
  });

  if (!media.length) {
    return "";
  }

  const count = Math.min(media.length, 4);
  const items = media.slice(0, 4).map((item, index) => {
    const url = mediaImageUrl(item);
    const fullUrl = fullSizeMediaUrl(item);
    const isVideo = item.type === "video" || item.type === "animated_gif";
    const rawVideoUrl = isVideo ? mediaVideoUrl(item) : "";
    const videoUrl = proxiedVideoUrl(rawVideoUrl);
    const label = item.altText || `${item.type} media`;
    const caption = item.altText ?? "";
    const openLabel = `Open media ${index + 1} of ${count}`;
    const durationLabel = isVideo ? formatMediaDuration(item.durationMs) : "";
    const loopAttribute = item.type === "animated_gif" ? " loop" : "";
    const viewerData = `data-media-index="${escapeHtml(index)}" data-media-type="${escapeHtml(item.type)}" data-media-src="${escapeHtml(url)}" data-media-full-src="${escapeHtml(fullUrl)}" data-media-video-src="${escapeHtml(videoUrl)}" data-media-alt="${escapeHtml(label)}" data-media-caption="${escapeHtml(caption)}"`;
    const mediaElement = isVideo && videoUrl
      ? `
        <div class="media-video-shell">
          <video data-inline-video-src="${escapeHtml(videoUrl)}" poster="${escapeHtml(url)}" muted playsinline${loopAttribute} controls preload="none" aria-label="${escapeHtml(label)}"></video>
          <button class="media-button media-video-expand media-viewer-trigger" type="button" aria-label="${escapeHtml(openLabel)}" ${viewerData}>
            <span aria-hidden="true">↗</span>
          </button>
        </div>
      `
      : `
        <button class="media-button media-viewer-trigger" type="button" aria-label="${escapeHtml(openLabel)}" ${viewerData}>
          <img src="${escapeHtml(url)}" alt="${escapeHtml(label)}" loading="lazy" />
        </button>
      `;

    return `
      <figure class="media-item${isVideo ? " media-item-video" : ""}" style="--media-ratio: ${mediaAspectRatio(item)}; --media-ratio-value: ${mediaAspectRatioValue(item)}">
        ${mediaElement}
        ${durationLabel ? `<span class="media-duration">${escapeHtml(durationLabel)}</span>` : ""}
      </figure>
    `;
  });

  const singleMedia = count === 1 ? media[0] : undefined;
  const singleIsVideo = singleMedia?.type === "video" || singleMedia?.type === "animated_gif";
  const galleryRatio = mediaGalleryAspectRatio(media, count);
  const gridClasses = ["media-grid", `media-count-${count}`, singleIsVideo ? "media-single-video" : ""].filter(Boolean).join(" ");
  const gridStyles = [
    count === 1 ? `--single-media-width: ${singleMediaWidth(media[0])}` : "",
    galleryRatio ? `--media-gallery-ratio: ${galleryRatio.css}; --media-gallery-ratio-value: ${galleryRatio.value.toFixed(4)}` : "",
  ].filter(Boolean);
  const gridStyle = gridStyles.length ? ` style="${escapeHtml(gridStyles.join("; "))}"` : "";

  return `<div class="${escapeHtml(gridClasses)}"${gridStyle}>${items.join("")}</div>`;
}
