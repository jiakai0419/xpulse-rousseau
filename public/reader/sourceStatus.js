import { avatarLabel, escapeHtml } from "./format.js";

export function avatarMarkup(author, className = "avatar") {
  if (author?.profileImageUrl) {
    return `<img class="${escapeHtml(className)}" src="${escapeHtml(author.profileImageUrl)}" alt="" loading="lazy" />`;
  }

  return `<div class="${escapeHtml(className)}">${escapeHtml(avatarLabel(author ?? {}))}</div>`;
}

export function xAuthAvatarDisplay(user) {
  if (!user) {
    return {
      hidden: true,
      html: "",
      text: "",
    };
  }

  if (user.profileImageUrl) {
    return {
      hidden: false,
      html: `<img src="${escapeHtml(user.profileImageUrl)}" alt="" loading="lazy" />`,
      text: "",
    };
  }

  return {
    hidden: false,
    html: "",
    text: avatarLabel(user),
  };
}

export function sourceToggleDisplay(source) {
  const isOnline = source === "x";

  return {
    isOnline,
    label: isOnline ? "Online" : "Offline",
    ariaPressed: String(isOnline),
    ariaLabel: `Pulse source: ${isOnline ? "Online" : "Offline"}`,
    title: isOnline ? "Online: live X source" : "Offline: local replay source",
  };
}

export function nextSelectedSource(source, xReady) {
  if (source === "x" && xReady) {
    return "x";
  }

  return "replay";
}

export function xAuthStatusDisplay(state) {
  if (!state.configured) {
    return {
      avatarUser: undefined,
      statusText: "X not configured",
      connectHidden: true,
      connectDisabled: true,
      selectedSource: "replay",
    };
  }

  if (state.authenticated && state.user) {
    return {
      avatarUser: state.user,
      statusText: `@${state.user.username}`,
      connectHidden: true,
      connectDisabled: true,
      selectedSource: state.xReady ? "x" : "replay",
    };
  }

  if (state.manualCredentials) {
    return {
      avatarUser: undefined,
      statusText: "Manual X token",
      connectHidden: true,
      connectDisabled: true,
      selectedSource: state.xReady ? "x" : "replay",
    };
  }

  return {
    avatarUser: undefined,
    statusText: "X not connected",
    connectHidden: false,
    connectDisabled: false,
    selectedSource: "replay",
  };
}
