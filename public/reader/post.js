import { renderMetrics, renderSignal } from "./actions.js";
import { readerDisplayPost } from "./postModel.js";
import { renderPostChrome } from "./postChrome.js";
import { renderPostLinks } from "./postLinks.js";
import { renderPostMedia } from "./postMedia.js";
import { renderQuotedPost } from "./postQuote.js";
import { renderPostText } from "./postText.js";
import { renderTranslation } from "./translation.js";

export function renderPost(selectedPost, index) {
  const { post, score } = selectedPost;
  const displayPost = readerDisplayPost(post);
  const tweetText = renderPostText(displayPost);

  return `
    <article class="tweet-card">
      ${renderPostChrome(post, displayPost, index + 1)}
      <div class="tweet-main">
        ${tweetText ? `<p class="tweet-text">${tweetText}</p>` : ""}
        ${renderPostMedia(displayPost)}
        ${renderQuotedPost(displayPost, { renderPostMedia })}
        ${renderPostLinks(displayPost)}
        ${renderTranslation(selectedPost, displayPost)}
        <div class="post-footer">
          ${renderMetrics(displayPost.metrics)}
          ${renderSignal(score)}
        </div>
      </div>
    </article>
  `;
}
