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

export function activeXSourceUser(state) {
  const identity = state.activeSourceIdentity ?? state.activeSource;

  if (!identity) {
    return undefined;
  }

  if (identity.user?.username) {
    return identity.user;
  }

  if (identity.username) {
    return identity;
  }

  return undefined;
}

export function xAuthStatusDisplay(state) {
  const activeUser = activeXSourceUser(state);

  if (activeUser) {
    return {
      avatarUser: activeUser,
      statusText: `@${activeUser.username}`,
      connectHidden: true,
      connectDisabled: true,
      selectedSource: state.xReady ? "x" : "replay",
    };
  }

  // Manual credentials are a usable Online source even when OAuth itself is not configured.
  // When both auth paths exist, the server's explicit active-source identity above decides
  // which account is named; without one, avoid showing a potentially unrelated OAuth user.
  if (state.manualCredentials) {
    return {
      avatarUser: undefined,
      statusText: "Manual X token",
      connectHidden: true,
      connectDisabled: true,
      selectedSource: state.xReady ? "x" : "replay",
    };
  }

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

  return {
    avatarUser: undefined,
    statusText: "X not connected",
    connectHidden: false,
    connectDisabled: false,
    selectedSource: "replay",
  };
}
