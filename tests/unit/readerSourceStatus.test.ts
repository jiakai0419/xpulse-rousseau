import assert from "node:assert/strict";
import { test } from "node:test";
import {
  activeXSourceUser,
  avatarMarkup,
  nextSelectedSource,
  sourceToggleDisplay,
  xAuthAvatarDisplay,
  xAuthStatusDisplay,
} from "../../public/reader/sourceStatus.js";

const user = {
  name: "Ada Lovelace",
  username: "ada",
  profileImageUrl: "https://img.example.com/a.png",
};

test("avatarMarkup renders profile images or fallback initials safely", () => {
  assert.equal(
    avatarMarkup({
      name: "Ada",
      username: "ada",
      profileImageUrl: "https://img.example.com/a.png?x=<bad>",
    }),
    '<img class="avatar" src="https://img.example.com/a.png?x=&lt;bad&gt;" alt="" loading="lazy" />',
  );

  assert.equal(avatarMarkup({ name: "<Neo>" }), '<div class="avatar">&lt;</div>');
  assert.equal(avatarMarkup({ username: "xpulse" }, "quote-avatar"), '<div class="quote-avatar">X</div>');
});

test("xAuthAvatarDisplay keeps sidebar avatar text and image paths distinct", () => {
  assert.deepEqual(xAuthAvatarDisplay(), {
    hidden: true,
    html: "",
    text: "",
  });
  assert.deepEqual(xAuthAvatarDisplay(user), {
    hidden: false,
    html: '<img src="https://img.example.com/a.png" alt="" loading="lazy" />',
    text: "",
  });
  assert.deepEqual(xAuthAvatarDisplay({ name: "Grace Hopper", username: "grace" }), {
    hidden: false,
    html: "",
    text: "G",
  });
});

test("sourceToggleDisplay describes online and offline source states", () => {
  assert.deepEqual(sourceToggleDisplay("x"), {
    isOnline: true,
    label: "Online",
    ariaPressed: "true",
    ariaLabel: "Pulse source: Online",
    title: "Online: live X source",
  });
  assert.deepEqual(sourceToggleDisplay("replay"), {
    isOnline: false,
    label: "Offline",
    ariaPressed: "false",
    ariaLabel: "Pulse source: Offline",
    title: "Offline: local replay source",
  });
});

test("nextSelectedSource never enters Online when X is unavailable", () => {
  assert.equal(nextSelectedSource("x", true), "x");
  assert.equal(nextSelectedSource("x", false), "replay");
  assert.equal(nextSelectedSource("replay", true), "replay");
});

test("xAuthStatusDisplay maps auth states to sidebar copy and source state", () => {
  assert.deepEqual(xAuthStatusDisplay({ configured: false }), {
    avatarUser: undefined,
    statusText: "X not configured",
    connectHidden: true,
    connectDisabled: true,
    selectedSource: "replay",
  });

  assert.deepEqual(
    xAuthStatusDisplay({
      configured: true,
      authenticated: true,
      xReady: true,
      user,
    }),
    {
      avatarUser: user,
      statusText: "@ada",
      connectHidden: true,
      connectDisabled: true,
      selectedSource: "x",
    },
  );

  assert.equal(
    xAuthStatusDisplay({
      configured: true,
      authenticated: true,
      xReady: false,
      user,
    }).selectedSource,
    "replay",
  );

  assert.deepEqual(
    xAuthStatusDisplay({
      configured: false,
      manualCredentials: true,
      xReady: true,
    }),
    {
      avatarUser: undefined,
      statusText: "Manual X token",
      connectHidden: true,
      connectDisabled: true,
      selectedSource: "x",
    },
  );

  assert.deepEqual(
    xAuthStatusDisplay({
      configured: true,
      authenticated: true,
      manualCredentials: true,
      xReady: true,
      user,
      activeSource: "oauth",
      activeSourceIdentity: { source: "oauth", user },
    }),
    {
      avatarUser: user,
      statusText: "@ada",
      connectHidden: true,
      connectDisabled: true,
      selectedSource: "x",
    },
  );

  assert.deepEqual(xAuthStatusDisplay({ configured: true }), {
    avatarUser: undefined,
    statusText: "X not connected",
    connectHidden: false,
    connectDisabled: false,
    selectedSource: "replay",
  });
});

test("activeXSourceUser accepts explicit active-source identity shapes only", () => {
  assert.equal(activeXSourceUser({ activeSource: "manual" }), undefined);
  assert.equal(activeXSourceUser({ activeSourceIdentity: { source: "manual", userId: "123" } }), undefined);
  assert.deepEqual(activeXSourceUser({ activeSourceIdentity: { source: "oauth", user } }), user);
  assert.deepEqual(activeXSourceUser({ activeSourceIdentity: user }), user);
});
