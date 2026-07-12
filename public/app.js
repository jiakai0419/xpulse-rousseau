import {
  formatElapsed,
} from "./reader/format.js";
import { renderPost } from "./reader/post.js";
import { pulseJobRecovery, shouldApplyLatestRun } from "./reader/recovery.js";
import {
  nextSelectedSource,
  sourceToggleDisplay,
  xAuthAvatarDisplay,
  xAuthStatusDisplay,
} from "./reader/sourceStatus.js";
import {
  aiModelStatus,
  nextProgressPercent,
  progressDetail,
  progressStatusLabel,
  progressText,
  receiptFromRecords,
  renderUsageDetails,
  usageTotals,
} from "./reader/status.js";

const refreshButton = document.querySelector("#refresh-button");
const appShellNode = document.querySelector(".app-shell");
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
let persistentNotice = null;
let runRenderGeneration = 0;
let displayedProgressPercent = 0;
let xAuthState = {
  configured: false,
  authenticated: false,
  xReady: false,
};

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
  displayedProgressPercent = nextProgressPercent(displayedProgressPercent, progress);
  taskProgressBarNode.style.width = `${displayedProgressPercent}%`;
  taskProgressDetailNode.textContent = progressDetail(progress, totals);
  statusNode.textContent = progressStatusLabel(progress);
  renderUsage(receiptFromRecords("Usage", progressUsage));
}

function renderNotice(message, detail = "", options = {}) {
  if (options.persist) {
    persistentNotice = { message, detail };
  }

  taskProgressNode.hidden = false;
  taskProgressLabelNode.textContent = message;
  taskProgressElapsedNode.textContent = "";
  taskProgressBarNode.style.width = "100%";
  taskProgressDetailNode.textContent = detail;
  statusNode.textContent = detail ? `${message}: ${detail}` : message;
}

function clearVisibleStatus() {
  statusNode.textContent = "";
  taskProgressNode.hidden = true;
}

function restorePersistentNotice() {
  if (persistentNotice) {
    renderNotice(persistentNotice.message, persistentNotice.detail);
    return;
  }

  clearVisibleStatus();
}

function clearPersistentNotice() {
  persistentNotice = null;
  clearVisibleStatus();
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

function renderRun(run) {
  runRenderGeneration += 1;
  closeMediaViewer({ restoreFocus: false });
  renderUsage(run.usageReceipt);
  resultsNode.innerHTML = run.selectedPosts.map((selectedPost, index) => renderPost(selectedPost, index)).join("");
  syncInlineVideos();
  restorePersistentNotice();
}

function prepareInlineVideo(video) {
  video.muted = true;
  video.playsInline = true;
  video.preload = "none";
}

function loadInlineVideo(video) {
  prepareInlineVideo(video);

  if (video.src || !video.dataset.inlineVideoSrc) {
    return;
  }

  video.src = video.dataset.inlineVideoSrc;
  video.load();
}

function playInlineVideo(video) {
  loadInlineVideo(video);

  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    return;
  }

  video.play().catch(() => {
    // Muted inline playback is normally allowed; keep the poster visible if the browser declines.
  });
}

function syncInlineVideos() {
  const videos = Array.from(resultsNode.querySelectorAll("video[data-inline-video-src]"));

  inlineVideoObserver?.disconnect();
  inlineVideoObserver = null;

  if (!videos.length) {
    return;
  }

  for (const video of videos) {
    prepareInlineVideo(video);
  }

  if (!("IntersectionObserver" in window)) {
    videos.forEach((video) => {
      loadInlineVideo(video);
      video.preload = "metadata";
    });
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
    { rootMargin: "240px 0px", threshold: 0.01 },
  );

  videos.forEach((video) => inlineVideoObserver.observe(video));
}

function collectMediaViewerItems(button) {
  const grid = button.closest(".media-grid");

  if (!grid) {
    return [];
  }

  return Array.from(grid.querySelectorAll(".media-viewer-trigger")).map((itemButton) => ({
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
  appShellNode.inert = true;
  appShellNode.setAttribute("inert", "");
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
  appShellNode.inert = false;
  appShellNode.removeAttribute("inert");
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

  const mediaButton = event.target.closest(".media-viewer-trigger");

  if (mediaButton && resultsNode.contains(mediaButton)) {
    openMediaViewer(mediaButton);
  }
}

function handleMediaViewerClick(event) {
  if (event.target === mediaViewerNode || event.target.classList.contains("media-viewer-stage")) {
    closeMediaViewer();
  }
}

function mediaViewerFocusableElements() {
  return Array.from(mediaViewerNode.querySelectorAll("button:not([disabled]), video[controls], input, select, textarea, [tabindex]:not([tabindex='-1'])"))
    .filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
}

function trapMediaViewerFocus(event) {
  const focusable = mediaViewerFocusableElements();

  if (!focusable.length) {
    event.preventDefault();
    mediaViewerNode.focus();
    return;
  }

  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  const active = document.activeElement;

  if (event.shiftKey && (active === first || !mediaViewerNode.contains(active))) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && (active === last || !mediaViewerNode.contains(active))) {
    event.preventDefault();
    first.focus();
  }
}

function shouldKeepViewerArrowKey(event) {
  return Boolean(event.target.closest?.("video, audio, input, textarea, select, [contenteditable='true'], [role='slider'], [role='spinbutton'], [role='textbox']"));
}

function handleMediaViewerKeydown(event) {
  if (mediaViewerNode.hidden) {
    return;
  }

  if (event.key === "Escape") {
    event.preventDefault();
    closeMediaViewer();
  } else if (event.key === "Tab") {
    trapMediaViewerFocus(event);
  } else if (event.key === "ArrowLeft" && !shouldKeepViewerArrowKey(event)) {
    event.preventDefault();
    moveMediaViewer(-1);
  } else if (event.key === "ArrowRight" && !shouldKeepViewerArrowKey(event)) {
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
  if (selectedSource === "x") {
    // Re-read the selected identity immediately before Online work. This keeps a
    // long-open page or another-tab logout from showing a stale source account.
    const currentAuthState = await loadXAuthStatus();

    if (!currentAuthState?.xReady || selectedSource !== "x") {
      renderNotice("Online unavailable", "Connect X first.");
      return;
    }
  }

  clearPersistentNotice();
  runRenderGeneration += 1;
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
    renderNotice("Needs attention", error instanceof Error ? error.message : "Pulse failed.", { persist: true });
  }
}

async function followPulseJob(initialJob, startedAt = Date.now()) {
  if (!initialJob?.id) {
    throw new Error("Pulse job was not returned by the server.");
  }

  let job = initialJob;
  displayedProgressPercent = 0;
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

    if (!job.run) {
      throw new Error("Pulse completed without a saved run.");
    }

    renderRun(job.run);
    localStorage.removeItem(activeJobStorageKey);
    return "completed";
  } catch (error) {
    localStorage.removeItem(activeJobStorageKey);
    renderNotice("Needs attention", error instanceof Error ? error.message : "Pulse failed.", { persist: true });
    return "failed";
  } finally {
    refreshButton.disabled = false;
    refreshButton.setAttribute("aria-busy", "false");
  }
}

async function recoverPulseJob(job) {
  const recovery = pulseJobRecovery(job);

  if (recovery.kind === "follow") {
    return followPulseJob(recovery.job, Date.parse(recovery.job.createdAt) || Date.now());
  }

  if (recovery.kind === "render") {
    renderRun(recovery.run);
    localStorage.removeItem(activeJobStorageKey);
    return "completed";
  }

  if (recovery.kind === "error") {
    localStorage.removeItem(activeJobStorageKey);
    renderNotice("Needs attention", recovery.message, { persist: true });
    return "failed";
  }

  return "none";
}

async function loadRecoverablePulseJob() {
  const requestedGeneration = runRenderGeneration;
  const storedJobId = localStorage.getItem(activeJobStorageKey);

  if (storedJobId) {
    try {
      const response = await fetch(`/api/runs/jobs/${encodeURIComponent(storedJobId)}`);
      const payload = await response.json();

      if (response.ok) {
        if (!shouldApplyLatestRun(requestedGeneration, runRenderGeneration)) {
          return "stale";
        }

        const outcome = await recoverPulseJob(payload.job);

        if (outcome !== "none") {
          return outcome;
        }
      }
    } catch {
      // Fall through to latest job recovery.
    }

    if (!shouldApplyLatestRun(requestedGeneration, runRenderGeneration)) {
      return "stale";
    }

    localStorage.removeItem(activeJobStorageKey);
  }

  try {
    const response = await fetch("/api/runs/jobs/latest");
    const payload = await response.json();

    if (response.ok) {
      if (!shouldApplyLatestRun(requestedGeneration, runRenderGeneration)) {
        return "stale";
      }

      return recoverPulseJob(payload.job);
    }
  } catch {
    // A missing recoverable job should not block reading the latest saved run.
  }

  if (!shouldApplyLatestRun(requestedGeneration, runRenderGeneration)) {
    return "stale";
  }

  return "none";
}

async function loadLatest() {
  const requestedGeneration = runRenderGeneration;

  try {
    const response = await fetch("/api/runs/latest");
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error ?? "Latest saved Pulse could not be loaded.");
    }

    if (!shouldApplyLatestRun(requestedGeneration, runRenderGeneration)) {
      return false;
    }

    if (payload.run) {
      renderRun(payload.run);
      return true;
    }
  } catch (error) {
    if (shouldApplyLatestRun(requestedGeneration, runRenderGeneration) && !persistentNotice) {
      renderNotice("Needs attention", error instanceof Error ? error.message : "Latest saved Pulse could not be loaded.", { persist: true });
    }
  }

  return false;
}

async function loadXAuthStatus() {
  try {
    const response = await fetch("/api/auth/x/status");
    const state = await response.json();

    if (!response.ok) {
      throw new Error(state.error ?? "X status lookup failed.");
    }

    renderXAuthStatus(state);
    return state;
  } catch {
    renderXAuthAvatar();
    xAuthStatusNode.textContent = "X status unknown";
    xAuthButton.hidden = true;
    setSelectedSource("replay");
    return undefined;
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

  if (auth === "success") {
    renderNotice("X connected");
  } else {
    renderNotice("X connection failed", params.get("message") ?? "unknown", { persist: true });
  }

  window.history.replaceState({}, "", window.location.pathname);
}

async function initializeReader() {
  const recoveryOutcome = await loadRecoverablePulseJob();

  if (recoveryOutcome === "none" || recoveryOutcome === "failed") {
    await loadLatest();
  }
}

sourceToggleButton.addEventListener("click", toggleSelectedSource);
xAuthButton.addEventListener("click", (event) => {
  if (xAuthButton.getAttribute("aria-disabled") === "true") {
    event.preventDefault();
  }
});
refreshButton.addEventListener("click", refresh);
resultsNode.addEventListener("click", handleResultsClick);
mediaViewerCloseButton.addEventListener("click", () => closeMediaViewer());
mediaViewerPrevButton.addEventListener("click", () => moveMediaViewer(-1));
mediaViewerNextButton.addEventListener("click", () => moveMediaViewer(1));
mediaViewerNode.addEventListener("click", handleMediaViewerClick);
document.addEventListener("keydown", handleMediaViewerKeydown);
handleAuthCallbackMessage();
void loadAppStatus();
void loadXAuthStatus();
void initializeReader();
