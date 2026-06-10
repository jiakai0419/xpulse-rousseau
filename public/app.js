import {
  escapeHtml,
  formatDate,
  formatElapsed,
} from "./reader/format.js";
import {
  isReferencedStatusLink,
  linkDisplayLabel,
  linkHref,
  normalizedPostLinks,
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
import { metricIcon, renderMetrics, renderSignal } from "./reader/actions.js";
import { readerDisplayPost, repostContextDisplay } from "./reader/postModel.js";
import { renderPostLinks } from "./reader/postLinks.js";
import { renderPostText } from "./reader/postText.js";
import { renderTranslation } from "./reader/translation.js";
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

function repostContext(post) {
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
