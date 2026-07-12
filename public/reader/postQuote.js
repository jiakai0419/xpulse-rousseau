import { escapeHtml, formatDate } from "./format.js";
import {
  isReferencedStatusLink,
  linkDisplayLabel,
  linkHref,
  normalizedPostLinks,
} from "./linkRules.js";
import { renderAvatar } from "./postChrome.js";
import { renderPostText } from "./postText.js";

export function renderQuotedPost(post, options = {}) {
  const renderPostMedia = options.renderPostMedia ?? (() => "");
  const renderPostLinks = options.renderPostLinks ?? (() => "");

  if (post.referencedPostType !== "quoted") {
    return "";
  }

  const quoteLink = normalizedPostLinks(post).find((link) => isReferencedStatusLink(post, link));
  const quote = post.referencedPost;

  if (!quote && !quoteLink) {
    return "";
  }

  if (!quote) {
    const href = linkHref(quoteLink);
    const label = linkDisplayLabel(quoteLink);

    return `
      <a class="quote-card quote-card-placeholder" href="${escapeHtml(href)}" target="_blank" rel="noreferrer" aria-label="View quoted post on X">
        <div class="quote-placeholder-head">
          <span class="quote-label">Quoted post</span>
          <span>Open on X</span>
        </div>
        <strong>${escapeHtml(label)}</strong>
      </a>
    `;
  }

  const quoteText = renderPostText(quote);
  const quoteHasMedia = Boolean(quote.media?.length);

  return `
    <article class="quote-card${quoteHasMedia ? " quote-card-has-media" : ""}">
      <div class="quote-head">
        ${renderAvatar(quote.author)}
        <div class="quote-author-line">
          <strong>${escapeHtml(quote.author.name)}</strong>
          <span>@${escapeHtml(quote.author.username)}</span>
          <span>·</span>
          <time datetime="${escapeHtml(quote.createdAt)}">${escapeHtml(formatDate(quote.createdAt))}</time>
        </div>
        <a class="quote-open-link" href="${escapeHtml(quote.url)}" target="_blank" rel="noreferrer" aria-label="View quoted post on X">Original</a>
      </div>
      ${quoteText ? `<p class="quote-text">${quoteText}</p>` : ""}
      ${renderPostMedia(quote)}
      ${renderPostLinks(quote)}
    </article>
  `;
}
