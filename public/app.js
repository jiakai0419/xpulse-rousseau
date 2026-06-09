import {
  displayText,
  escapeHtml,
  formatDate,
  formatElapsed,
  formatMetric,
} from "./reader/format.js";
import {
  findTokenRanges,
  hasUsefulDisplayUrl,
  isReferencedStatusLink,
  linkAppearsInText,
  linkDisplayLabel,
  linkDomain,
  linkHref,
  linkPreviewImage,
  linkTokens,
  linkTreatment,
  normalizedPostLinks,
  textWithoutHiddenPostLinks,
  textWithoutPostLinks,
} from "./reader/linkRules.js";
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
} from "./reader/mediaRules.js";
import {
  avatarMarkup,
  nextSelectedSource,
  sourceToggleDisplay,
  xAuthAvatarDisplay,
  xAuthStatusDisplay,
} from "./reader/sourceStatus.js";
import {
  aiModelStatus,
  progressDetail,
  progressPercent,
  progressStatusLabel,
  progressText,
  receiptFromRecords,
  renderUsageDetails,
  usageTotals,
} from "./reader/status.js";

const refreshButton = document.querySelector("#refresh-button");
const statusNode = document.querySelector("#status");
const usagePanelNode = document.querySelector("#usage-panel");
const resultsNode = document.querySelector("#results");
const sourceToggleButton = document.querySelector("#source-toggle");
const sourceToggleLabelNode = document.querySelector("#source-toggle-label");
const xAuthAvatarNode = document.querySelector("#x-auth-avatar");
const xAuthStatusNode = document.querySelector("#x-auth-status");
const xAuthButton = document.querySelector("#x-auth-button");
const aiStatusNode = document.querySelector("#ai-status");
const taskProgressNode = document.querySelector("#task-progress");
const taskProgressLabelNode = document.querySelector("#task-progress-label");
const taskProgressElapsedNode = document.querySelector("#task-progress-elapsed");
const taskProgressBarNode = document.querySelector("#task-progress-bar");
const taskProgressDetailNode = document.querySelector("#task-progress-detail");
const mediaViewerNode = document.querySelector("#media-viewer");
const mediaViewerImageNode = document.querySelector("#media-viewer-image");
const mediaViewerVideoNode = document.querySelector("#media-viewer-video");
const mediaViewerCaptionNode = document.querySelector("#media-viewer-caption");
const mediaViewerCloseButton = document.querySelector("#media-viewer-close");
const mediaViewerPrevButton = document.querySelector("#media-viewer-prev");
const mediaViewerNextButton = document.querySelector("#media-viewer-next");
const mediaViewerCounterNode = document.querySelector("#media-viewer-counter");
const activeJobStorageKey = "xpulse.activePulseJobId";

let selectedSource = "replay";
let mediaViewerItems = [];
let mediaViewerIndex = 0;
let mediaViewerPreviousFocus = null;
let inlineVideoObserver = null;
let xAuthState = {
  configured: false,
  authenticated: false,
  xReady: false,
};

const dimensionLabels = {
  immediateValue: "立即值得看",
  informationDensity: "信息密度",
};

function readerDisplayPost(post) {
  if (post?.referencedPostType === "retweeted" && post.referencedPost) {
    return post.referencedPost;
  }

  return post;
}

function repostContext(post) {
  if (post?.referencedPostType !== "retweeted" || !post.referencedPost) {
    return "";
  }

  return `
    <div class="repost-context" aria-label="${escapeHtml(post.author.name)} reposted">
      ${metricIcon("reposts")}
      <span>${escapeHtml(post.author.name)} reposted</span>
    </div>
  `;
}

function renderUsage(receipt) {
  if (!receipt?.lines?.length) {
    usagePanelNode.hidden = true;
    usagePanelNode.innerHTML = "";
    return;
  }

  usagePanelNode.hidden = false;
  usagePanelNode.innerHTML = renderUsageDetails(receipt);
}

function renderServerProgress(progress, startedAt) {
  const progressUsage = progress.usage ?? [];
  const totals = usageTotals(progressUsage);

  taskProgressNode.hidden = false;
  taskProgressLabelNode.textContent = progressText(progress);
  taskProgressElapsedNode.textContent = formatElapsed(Date.now() - startedAt);
  taskProgressBarNode.style.width = `${progressPercent(progress)}%`;
  taskProgressDetailNode.textContent = progressDetail(progress, totals);
  statusNode.textContent = progressStatusLabel(progress);
  renderUsage(receiptFromRecords("Usage", progressUsage));
}

function renderNotice(message, detail = "") {
  taskProgressNode.hidden = false;
  taskProgressLabelNode.textContent = message;
  taskProgressElapsedNode.textContent = "";
  taskProgressBarNode.style.width = "100%";
  taskProgressDetailNode.textContent = detail;
  statusNode.textContent = detail ? `${message}: ${detail}` : message;
}

function renderAvatar(author) {
  return avatarMarkup(author);
}

function setSelectedSource(source) {
  selectedSource = nextSelectedSource(source, xAuthState.xReady);

  const display = sourceToggleDisplay(selectedSource);
  sourceToggleButton.classList.toggle("online", display.isOnline);
  sourceToggleButton.classList.toggle("offline", !display.isOnline);
  sourceToggleButton.setAttribute("aria-pressed", display.ariaPressed);
  sourceToggleButton.setAttribute("aria-label", display.ariaLabel);
  sourceToggleButton.title = display.title;
  sourceToggleLabelNode.textContent = display.label;
}

function toggleSelectedSource() {
  if (selectedSource === "x") {
    setSelectedSource("replay");
    return;
  }

  if (!xAuthState.xReady) {
    renderNotice("Online unavailable", "Connect X first.");
    setSelectedSource("replay");
    return;
  }

  setSelectedSource("x");
}

function renderXAuthAvatar(user) {
  const display = xAuthAvatarDisplay(user);

  xAuthAvatarNode.hidden = display.hidden;
  xAuthAvatarNode.textContent = "";
  xAuthAvatarNode.innerHTML = display.html;

  if (!display.html) {
    xAuthAvatarNode.textContent = display.text;
  }
}

function renderXAuthStatus(state) {
  xAuthState = state;
  const display = xAuthStatusDisplay(state);
  xAuthButton.textContent = "Connect";
  xAuthButton.removeAttribute("title");
  xAuthButton.setAttribute("aria-label", "Connect X");

  renderXAuthAvatar(display.avatarUser);
  xAuthStatusNode.textContent = display.statusText;
  xAuthButton.hidden = display.connectHidden;

  if (display.connectDisabled) {
    xAuthButton.classList.add("disabled");
    xAuthButton.setAttribute("aria-disabled", "true");
  } else {
    xAuthButton.classList.remove("disabled");
    xAuthButton.removeAttribute("aria-disabled");
  }

  setSelectedSource(display.selectedSource);
}

function renderSignal(score) {
  const dimensions = score.dimensions
    .map((dimension) => {
      const label = dimensionLabels[dimension.key] ?? dimension.label;

      return `
        <div class="signal-meter" title="${escapeHtml(dimension.reason)}">
          <div class="signal-meter-head">
            <span class="signal-dimension-label">${escapeHtml(label)}</span>
            <strong class="signal-score">${escapeHtml(dimension.score.toFixed(1))}</strong>
          </div>
          <p>${escapeHtml(dimension.reason)}</p>
        </div>
      `;
    })
    .join("");

  const totalScore = formatSignalScore(score.total);

  return `
    <div class="signal-details">
      <button class="signal-summary" type="button" aria-expanded="false" aria-label="Signal: ${escapeHtml(totalScore)} out of 10" title="Signal: ${escapeHtml(totalScore)} / 10">
        ${metricIcon("signal")}
        <strong class="signal-score signal-summary-score">${escapeHtml(totalScore)}</strong>
        <span class="signal-summary-caret" aria-hidden="true"></span>
      </button>
      <div class="signal-body" hidden>
        ${dimensions}
      </div>
    </div>
  `;
}

function translationText(selectedPost) {
  return selectedPost.translation?.textZh;
}

function renderTranslation(selectedPost, displayPost = selectedPost.post) {
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

function renderPostMedia(post) {
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
    const mediaElement =
      isVideo && videoUrl
        ? `<video src="${escapeHtml(videoUrl)}" poster="${escapeHtml(url)}" muted autoplay playsinline loop preload="auto" aria-label="${escapeHtml(label)}"></video>`
        : `<img src="${escapeHtml(url)}" alt="${escapeHtml(label)}" loading="lazy" />`;

    return `
      <figure class="media-item" style="--media-ratio: ${mediaAspectRatio(item)}; --media-ratio-value: ${mediaAspectRatioValue(item)}">
        <div class="media-button" role="button" tabindex="0" aria-label="${escapeHtml(openLabel)}" data-media-index="${escapeHtml(index)}" data-media-type="${escapeHtml(item.type)}" data-media-src="${escapeHtml(url)}" data-media-full-src="${escapeHtml(fullUrl)}" data-media-video-src="${escapeHtml(videoUrl)}" data-media-alt="${escapeHtml(label)}" data-media-caption="${escapeHtml(caption)}">
          ${mediaElement}
        </div>
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

function renderInlineLink(link) {
  const href = linkHref(link);
  const label = linkDisplayLabel(link);

  return `<a class="tweet-text-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>`;
}

function renderPostText(post) {
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

function renderPostLinks(post) {
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
    const title = link.preview?.title || (hasUsefulDisplayUrl(link) ? link.displayUrl : undefined) || domain || href;
    const description = link.preview?.description || domain || "Linked from original post";

    if (image) {
      return `
        <a class="link-card link-card-media-preview" href="${escapeHtml(href)}" target="_blank" rel="noreferrer">
          <span class="link-card-image-wrap">
            <img src="${escapeHtml(image.url)}" alt="" loading="lazy" />
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

function renderQuotedPost(post) {
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
      <article class="quote-card quote-card-placeholder" role="link" tabindex="0" data-quote-url="${escapeHtml(href)}" aria-label="View quoted post on X">
        <div class="quote-placeholder-head">
          <span class="quote-label">Quoted post</span>
          <span>Open on X</span>
        </div>
        <strong>${escapeHtml(label)}</strong>
      </article>
    `;
  }

  const quoteText = renderPostText(quote);
  const quoteHasMedia = Boolean(quote.media?.length);

  return `
    <article class="quote-card${quoteHasMedia ? " quote-card-has-media" : ""}" role="link" tabindex="0" data-quote-url="${escapeHtml(quote.url)}" aria-label="View quoted post on X">
      <div class="quote-head">
        ${renderAvatar(quote.author)}
        <div class="quote-author-line">
          <strong>${escapeHtml(quote.author.name)}</strong>
          <span>@${escapeHtml(quote.author.username)}</span>
          <span>·</span>
          <time datetime="${escapeHtml(quote.createdAt)}">${escapeHtml(formatDate(quote.createdAt))}</time>
        </div>
      </div>
      ${quoteText ? `<p class="quote-text">${quoteText}</p>` : ""}
      ${renderPostMedia(quote)}
    </article>
  `;
}

function metricIcon(name) {
  const icons = {
    replies: '<path d="M6.4 17.5c-1.8-1.4-2.9-3.4-2.9-5.6 0-4.1 3.8-7.4 8.5-7.4s8.5 3.3 8.5 7.4-3.8 7.4-8.5 7.4c-.9 0-1.8-.1-2.6-.4L5.6 21l.8-3.5Z" />',
    reposts: '<path d="M7 7h8.8c2.1 0 3.7 1.7 3.7 3.7v.4" /><path d="m16.6 4.2 3.4 3.4-3.4 3.4" /><path d="M17 17H8.2c-2.1 0-3.7-1.7-3.7-3.7v-.4" /><path d="m7.4 20.8-3.4-3.4 3.4-3.4" />',
    likes: '<path d="M12 20.5s-7.5-4.4-8.9-9.1C2.2 8.2 4 5.5 7 5.5c1.8 0 3.2 1 4 2.4.8-1.4 2.2-2.4 4-2.4 3 0 4.8 2.7 3.9 5.9-1.4 4.7-8.9 9.1-8.9 9.1Z" />',
    views: '<path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" />',
    signal: '<path d="M4 12h3.2l2.1-5 4.4 10 2.1-5H20" />',
  };

  return `
    <svg class="metric-icon" viewBox="0 0 24 24" aria-hidden="true">
      ${icons[name] ?? ""}
    </svg>
  `;
}

function formatSignalScore(value) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return "0.0";
  }

  const normalized = numeric > 10 ? numeric / 10 : numeric;
  const clamped = Math.max(0, Math.min(10, normalized));

  return clamped.toFixed(1);
}

function renderMetricItem(key, label, value) {
  const formatted = formatMetric(value);

  return `
    <span class="metric-item metric-${escapeHtml(key)}" aria-label="${escapeHtml(label)}: ${escapeHtml(formatted)}" title="${escapeHtml(label)}: ${escapeHtml(formatted)}">
      ${metricIcon(key)}
      <span class="metric-count">${escapeHtml(formatted)}</span>
    </span>
  `;
}

function renderMetrics(metrics) {
  return `
    <div class="metrics-row" aria-label="Post metrics">
      ${renderMetricItem("replies", "Replies", metrics.replies)}
      ${renderMetricItem("reposts", "Reposts", metrics.reposts)}
      ${renderMetricItem("likes", "Likes", metrics.likes)}
      ${renderMetricItem("views", "Views", metrics.impressions)}
    </div>
  `;
}

function renderPost(selectedPost, index) {
  const { post, score } = selectedPost;
  const displayPost = readerDisplayPost(post);
  const tweetText = renderPostText(displayPost);

  return `
    <article class="tweet-card">
      ${repostContext(post)}
      <div class="avatar-column">
        ${renderAvatar(displayPost.author)}
      </div>
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
            <span class="rank-badge">#${escapeHtml(index + 1)}</span>
          </div>
        </div>
      </div>
      <div class="tweet-main">
        ${tweetText ? `<p class="tweet-text">${tweetText}</p>` : ""}
        ${renderPostMedia(displayPost)}
        ${renderQuotedPost(displayPost)}
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

function renderRun(run) {
  closeMediaViewer({ restoreFocus: false });
  statusNode.textContent = "";
  taskProgressNode.hidden = true;
  renderUsage(run.usageReceipt);
  resultsNode.innerHTML = run.selectedPosts.map((selectedPost, index) => renderPost(selectedPost, index)).join("");
  syncInlineVideos();
}

function prepareInlineVideo(video) {
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";

  if (video.readyState === 0) {
    video.load();
  }
}

function playInlineVideo(video) {
  prepareInlineVideo(video);
  video.play().catch(() => {
    // Muted inline playback is normally allowed; keep the poster visible if the browser declines.
  });
}

function syncInlineVideos() {
  const videos = Array.from(resultsNode.querySelectorAll(".media-item video"));

  inlineVideoObserver?.disconnect();
  inlineVideoObserver = null;

  if (!videos.length) {
    return;
  }

  for (const video of videos) {
    prepareInlineVideo(video);
  }

  if (!("IntersectionObserver" in window)) {
    videos.forEach(playInlineVideo);
    return;
  }

  inlineVideoObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        const video = entry.target;

        if (entry.isIntersecting) {
          playInlineVideo(video);
        } else {
          video.pause();
        }
      }
    },
    { threshold: 0.35 },
  );

  videos.forEach((video) => inlineVideoObserver.observe(video));
}

function collectMediaViewerItems(button) {
  const grid = button.closest(".media-grid");

  if (!grid) {
    return [];
  }

  return Array.from(grid.querySelectorAll(".media-button")).map((itemButton) => ({
    type: itemButton.dataset.mediaType || "photo",
    src: itemButton.dataset.mediaFullSrc || itemButton.dataset.mediaSrc || "",
    fallbackSrc: itemButton.dataset.mediaSrc || "",
    videoSrc: itemButton.dataset.mediaVideoSrc || "",
    alt: itemButton.dataset.mediaAlt || "",
    caption: itemButton.dataset.mediaCaption || "",
  }));
}

function renderMediaViewer() {
  const item = mediaViewerItems[mediaViewerIndex];

  if (!item) {
    closeMediaViewer({ restoreFocus: false });
    return;
  }

  const isPlayableVideo = Boolean(item.videoSrc && (item.type === "video" || item.type === "animated_gif"));

  mediaViewerVideoNode.hidden = !isPlayableVideo;
  mediaViewerImageNode.hidden = isPlayableVideo;

  mediaViewerVideoNode.pause();
  mediaViewerVideoNode.removeAttribute("src");
  mediaViewerVideoNode.removeAttribute("poster");
  mediaViewerVideoNode.loop = item.type === "animated_gif";
  mediaViewerVideoNode.muted = item.type === "animated_gif";

  if (isPlayableVideo) {
    mediaViewerVideoNode.src = item.videoSrc;
    mediaViewerVideoNode.poster = item.fallbackSrc;
    mediaViewerVideoNode.load();
    mediaViewerVideoNode.play().catch(() => {
      // Browser autoplay policy can still require a second explicit play gesture.
    });
  }

  mediaViewerImageNode.onerror = () => {
    if (item.fallbackSrc && mediaViewerImageNode.src !== item.fallbackSrc) {
      mediaViewerImageNode.src = item.fallbackSrc;
    }
  };
  mediaViewerImageNode.src = item.src || item.fallbackSrc;
  mediaViewerImageNode.alt = item.alt;
  mediaViewerCaptionNode.textContent = item.caption;
  mediaViewerCaptionNode.hidden = !item.caption;

  const hasMultipleItems = mediaViewerItems.length > 1;
  mediaViewerPrevButton.hidden = !hasMultipleItems;
  mediaViewerNextButton.hidden = !hasMultipleItems;
  mediaViewerCounterNode.hidden = !hasMultipleItems;
  mediaViewerCounterNode.textContent = `${mediaViewerIndex + 1} / ${mediaViewerItems.length}`;
}

function openMediaViewer(button) {
  const items = collectMediaViewerItems(button).filter((item) => item.src || item.fallbackSrc);

  if (!items.length) {
    return;
  }

  const requestedIndex = Number(button.dataset.mediaIndex);
  mediaViewerItems = items;
  mediaViewerIndex = Number.isFinite(requestedIndex) ? Math.max(0, Math.min(items.length - 1, requestedIndex)) : 0;
  mediaViewerPreviousFocus = document.activeElement;
  mediaViewerNode.hidden = false;
  document.body.classList.add("media-viewer-open");
  renderMediaViewer();
  mediaViewerCloseButton.focus({ preventScroll: true });
}

function closeMediaViewer(options = {}) {
  if (!mediaViewerNode || mediaViewerNode.hidden) {
    return;
  }

  const { restoreFocus = true } = options;
  mediaViewerNode.hidden = true;
  document.body.classList.remove("media-viewer-open");
  mediaViewerVideoNode.pause();
  mediaViewerVideoNode.removeAttribute("src");
  mediaViewerVideoNode.removeAttribute("poster");
  mediaViewerVideoNode.load();
  mediaViewerImageNode.removeAttribute("src");
  mediaViewerImageNode.removeAttribute("alt");
  mediaViewerItems = [];
  mediaViewerIndex = 0;

  if (restoreFocus && mediaViewerPreviousFocus instanceof HTMLElement) {
    mediaViewerPreviousFocus.focus({ preventScroll: true });
  }

  mediaViewerPreviousFocus = null;
}

function moveMediaViewer(delta) {
  if (mediaViewerNode.hidden || mediaViewerItems.length < 2) {
    return;
  }

  mediaViewerIndex = (mediaViewerIndex + delta + mediaViewerItems.length) % mediaViewerItems.length;
  renderMediaViewer();
}

function toggleSignalDetails(button) {
  const details = button.closest(".signal-details");
  const body = details?.querySelector(".signal-body");

  if (!details || !body) {
    return;
  }

  const expanded = button.getAttribute("aria-expanded") === "true";
  button.setAttribute("aria-expanded", String(!expanded));
  body.hidden = expanded;
  details.classList.toggle("is-open", !expanded);
}

function handleResultsClick(event) {
  const signalButton = event.target.closest(".signal-summary");

  if (signalButton && resultsNode.contains(signalButton)) {
    toggleSignalDetails(signalButton);
    return;
  }

  const mediaButton = event.target.closest(".media-button");

  if (mediaButton && resultsNode.contains(mediaButton)) {
    openMediaViewer(mediaButton);
    return;
  }

  const quoteCard = event.target.closest(".quote-card[data-quote-url]");

  if (!quoteCard || !resultsNode.contains(quoteCard)) {
    return;
  }

  if (event.target.closest("a, button, .media-button")) {
    return;
  }

  window.open(quoteCard.dataset.quoteUrl, "_blank", "noopener,noreferrer");
}

function handleResultsKeydown(event) {
  if (event.key !== "Enter" && event.key !== " ") {
    return;
  }

  const mediaButton = event.target.closest(".media-button");

  if (mediaButton && resultsNode.contains(mediaButton)) {
    event.preventDefault();
    openMediaViewer(mediaButton);
    return;
  }

  const quoteCard = event.target.closest(".quote-card[data-quote-url]");

  if (!quoteCard || !resultsNode.contains(quoteCard) || event.target.closest("a, button, .media-button")) {
    return;
  }

  event.preventDefault();
  window.open(quoteCard.dataset.quoteUrl, "_blank", "noopener,noreferrer");
}

function handleMediaViewerClick(event) {
  if (event.target === mediaViewerNode || event.target.classList.contains("media-viewer-stage")) {
    closeMediaViewer();
  }
}

function handleMediaViewerKeydown(event) {
  if (mediaViewerNode.hidden) {
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closeMediaViewer();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    moveMediaViewer(-1);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    moveMediaViewer(1);
  }
}

function triggerPulseBurst() {
  refreshButton.classList.remove("pulse-burst");
  void refreshButton.offsetWidth;
  refreshButton.classList.add("pulse-burst");
  window.setTimeout(() => refreshButton.classList.remove("pulse-burst"), 700);
}

async function refresh() {
  if (selectedSource === "x" && !xAuthState.xReady) {
    renderNotice("Online unavailable", "Connect X first.");
    return;
  }

  triggerPulseBurst();
  const startedAt = Date.now();

  try {
    const response = await fetch("/api/runs/jobs", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ source: selectedSource }),
    });

    if (!response.ok) {
      const responseText = await response.text();
      let message = responseText;
      try {
        message = JSON.parse(responseText).error ?? responseText;
      } catch {
        message = responseText;
      }
      throw new Error(message);
    }

    const payload = await response.json();
    await followPulseJob(payload.job, startedAt);
  } catch (error) {
    localStorage.removeItem(activeJobStorageKey);
    renderNotice("Needs attention", error instanceof Error ? error.message : "Pulse failed.");
  }
}

async function followPulseJob(initialJob, startedAt = Date.now()) {
  if (!initialJob?.id) {
    throw new Error("Pulse job was not returned by the server.");
  }

  let job = initialJob;
  localStorage.setItem(activeJobStorageKey, job.id);
  refreshButton.disabled = true;
  refreshButton.setAttribute("aria-busy", "true");

  try {
    renderServerProgress(job.progress, startedAt);

    while (job.status === "running") {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const jobResponse = await fetch(`/api/runs/jobs/${encodeURIComponent(job.id)}`);
      const payload = await jobResponse.json();

      if (!jobResponse.ok) {
        throw new Error(payload.error ?? "Pulse job lookup failed.");
      }

      job = payload.job;
      renderServerProgress(job.progress, startedAt);
    }

    if (job.status === "failed") {
      throw new Error(job.error ?? "Pulse failed.");
    }

    renderRun(job.run);
    localStorage.removeItem(activeJobStorageKey);
  } catch (error) {
    localStorage.removeItem(activeJobStorageKey);
    renderNotice("Needs attention", error instanceof Error ? error.message : "Pulse failed.");
  } finally {
    refreshButton.disabled = false;
    refreshButton.setAttribute("aria-busy", "false");
  }
}

async function loadRecoverablePulseJob() {
  const storedJobId = localStorage.getItem(activeJobStorageKey);

  if (storedJobId) {
    try {
      const response = await fetch(`/api/runs/jobs/${encodeURIComponent(storedJobId)}`);
      const payload = await response.json();

      if (response.ok && payload.job?.status === "running") {
        await followPulseJob(payload.job, Date.parse(payload.job.createdAt) || Date.now());
        return;
      }

      if (response.ok && payload.job?.status === "completed" && payload.job.run) {
        renderRun(payload.job.run);
        localStorage.removeItem(activeJobStorageKey);
        return;
      }
    } catch {
      // Fall through to latest job recovery.
    }

    localStorage.removeItem(activeJobStorageKey);
  }

  try {
    const response = await fetch("/api/runs/jobs/latest");
    const payload = await response.json();

    if (response.ok && payload.job?.status === "running") {
      await followPulseJob(payload.job, Date.parse(payload.job.createdAt) || Date.now());
    }
  } catch {
    // A missing recoverable job should not block reading the latest saved run.
  }
}

async function loadLatest() {
  try {
    const response = await fetch("/api/runs/latest");
    const payload = await response.json();

    if (payload.run) {
      renderRun(payload.run);
    }
  } catch {
    statusNode.textContent = "";
  }
}

async function loadXAuthStatus() {
  try {
    const response = await fetch("/api/auth/x/status");
    const state = await response.json();
    renderXAuthStatus(state);
  } catch {
    renderXAuthAvatar();
    xAuthStatusNode.textContent = "X status unknown";
    xAuthButton.hidden = true;
    setSelectedSource("replay");
  }
}

async function loadAppStatus() {
  try {
    const response = await fetch("/api/app/status");
    const status = await response.json();

    if (status.openai?.configured) {
      const models = status.openai.configuredModels ?? {};
      aiStatusNode.textContent = aiModelStatus(models);
      aiStatusNode.classList.add("ready");
    } else {
      aiStatusNode.textContent = "unavailable";
      aiStatusNode.classList.remove("ready");
    }

  } catch {
    aiStatusNode.textContent = "unavailable";
    aiStatusNode.classList.remove("ready");
  }
}

function handleAuthCallbackMessage() {
  const params = new URLSearchParams(window.location.search);
  const auth = params.get("x_auth");

  if (!auth) {
    return;
  }

  statusNode.textContent = auth === "success" ? "X connected" : `X connection failed: ${params.get("message") ?? "unknown"}`;
  window.history.replaceState({}, "", window.location.pathname);
}

sourceToggleButton.addEventListener("click", toggleSelectedSource);
xAuthButton.addEventListener("click", (event) => {
  if (xAuthButton.getAttribute("aria-disabled") === "true") {
    event.preventDefault();
  }
});
refreshButton.addEventListener("click", refresh);
resultsNode.addEventListener("click", handleResultsClick);
resultsNode.addEventListener("keydown", handleResultsKeydown);
mediaViewerCloseButton.addEventListener("click", () => closeMediaViewer());
mediaViewerPrevButton.addEventListener("click", () => moveMediaViewer(-1));
mediaViewerNextButton.addEventListener("click", () => moveMediaViewer(1));
mediaViewerNode.addEventListener("click", handleMediaViewerClick);
document.addEventListener("keydown", handleMediaViewerKeydown);
handleAuthCallbackMessage();
loadAppStatus();
loadXAuthStatus();
loadLatest();
loadRecoverablePulseJob();
