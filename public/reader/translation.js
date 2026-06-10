import { displayText } from "./format.js";
import { textWithoutPostLinks } from "./linkRules.js";

export function translationText(selectedPost) {
  return selectedPost.translation?.textZh;
}

export function renderTranslation(selectedPost, displayPost = selectedPost.post) {
  const text = translationText(selectedPost);

  if (!text) {
    return `
      <section class="translation-block" lang="zh-CN">
        <h2>Chinese translation</h2>
        <p class="translation muted-text">Translation pending</p>
      </section>
    `;
  }

  const cleanText = textWithoutPostLinks(text, displayPost);

  return `
    <section class="translation-block" lang="zh-CN">
      <h2>Chinese translation</h2>
      <p class="translation">${displayText(cleanText || text)}</p>
    </section>
  `;
}
