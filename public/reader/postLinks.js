import { escapeHtml } from "./format.js";
import {
  hasUsefulDisplayUrl,
  linkAppearsInText,
  linkDisplayLabel,
  linkDomain,
  linkHref,
  linkPreviewImage,
  linkTreatment,
  normalizedPostLinks,
  proxiedLinkPreviewImageUrl,
} from "./linkRules.js";

export function renderPostLinks(post) {
  const links = normalizedPostLinks(post);
  const previewLinks = links.filter((link) => linkTreatment(post, link) === "preview");
  const fallbackLinks = links.filter((link) => linkTreatment(post, link) === "inline" && !linkAppearsInText(post.text, link));

  if (!previewLinks.length && !fallbackLinks.length) {
    return "";
  }

  const cards = previewLinks.map((link) => {
    const href = linkHref(link);
    const domain = linkDomain(link);
    const image = linkPreviewImage(link);
    const imageSrc = proxiedLinkPreviewImageUrl(image);
    const title = link.preview?.title || (hasUsefulDisplayUrl(link) ? link.displayUrl : undefined) || domain || href;
    const description = link.preview?.description || domain || "Linked from original post";

    if (image && imageSrc) {
      return `
        <a class="link-card link-card-media-preview" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">
          <span class="link-card-image-wrap">
            <img src="${escapeHtml(imageSrc)}" alt="" loading="lazy" />
            ${title ? `<strong class="link-card-image-title">${escapeHtml(title)}</strong>` : ""}
          </span>
          <span class="link-card-source">From ${escapeHtml(domain || linkDisplayLabel(link))}</span>
        </a>
      `;
    }

    return `
      <a class="link-card" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">
        <span class="link-card-source">${escapeHtml(domain)}</span>
        <strong>${escapeHtml(title)}</strong>
        <p>${escapeHtml(description)}</p>
      </a>
    `;
  });
  const fallback = fallbackLinks.map((link) => {
    const href = linkHref(link);
    const label = linkDisplayLabel(link);

    return `
      <a class="link-chip" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">
        ${escapeHtml(label)}
      </a>
    `;
  });

  return `
    ${cards.length ? `<div class="link-card-list">${cards.join("")}</div>` : ""}
    ${fallback.length ? `<div class="link-chip-list" aria-label="Post links">${fallback.join("")}</div>` : ""}
  `;
}
