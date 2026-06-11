import { escapeHtml, formatDate } from "./format.js";
import { metricIcon } from "./actions.js";
import { repostContextDisplay } from "./postModel.js";
import { avatarMarkup } from "./sourceStatus.js";

export function renderAvatar(author) {
  return avatarMarkup(author);
}

export function renderRepostContext(post) {
  const context = repostContextDisplay(post);

  if (!context) {
    return "";
  }

  return `
    <div class="repost-context" aria-label="${escapeHtml(context.label)}">
      ${metricIcon("reposts")}
      <span>${escapeHtml(context.label)}</span>
    </div>
  `;
}

export function renderPostHeader(displayPost, rank) {
  return `
    <div class="tweet-head-main">
      <div class="tweet-head">
        <div class="author-line">
          <strong>${escapeHtml(displayPost.author.name)}</strong>
          <span>@${escapeHtml(displayPost.author.username)}</span>
          <span>·</span>
          <time datetime="${escapeHtml(displayPost.createdAt)}">${escapeHtml(formatDate(displayPost.createdAt))}</time>
        </div>
        <div class="tweet-head-actions">
          <a class="original-link" href="${escapeHtml(displayPost.url)}" target="_blank" rel="noreferrer" aria-label="View original post on X">Original</a>
          <span class="rank-badge">#${escapeHtml(rank)}</span>
        </div>
      </div>
    </div>
  `;
}

export function renderPostChrome(timelinePost, displayPost, rank) {
  return `
    ${renderRepostContext(timelinePost)}
    <div class="avatar-column">
      ${renderAvatar(displayPost.author)}
    </div>
    ${renderPostHeader(displayPost, rank)}
  `;
}
