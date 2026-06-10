import { displayText, escapeHtml } from "./format.js";
import {
  findTokenRanges,
  linkDisplayLabel,
  linkHref,
  linkTokens,
  linkTreatment,
  normalizedPostLinks,
  textWithoutHiddenPostLinks,
} from "./linkRules.js";

export function renderInlineLink(link) {
  const href = linkHref(link);
  const label = linkDisplayLabel(link);

  return `<a class="tweet-text-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

export function renderPostText(post) {
  const text = textWithoutHiddenPostLinks(post.text, post);

  if (!text) {
    return "";
  }

  const replacements = normalizedPostLinks(post)
    .filter((link) => linkTreatment(post, link) === "inline")
    .flatMap((link) =>
      linkTokens(link).flatMap((token) =>
        findTokenRanges(text, token).map((range) => ({
          ...range,
          html: renderInlineLink(link),
        })),
      ),
    )
    .sort((a, b) => a.start - b.start || b.end - a.end);

  if (!replacements.length) {
    return displayText(text);
  }

  let cursor = 0;
  let html = "";

  for (const replacement of replacements) {
    if (replacement.start < cursor) {
      continue;
    }

    html += displayText(text.slice(cursor, replacement.start));
    html += replacement.html;
    cursor = replacement.end;
  }

  html += displayText(text.slice(cursor));
  return html;
}
