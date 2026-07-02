import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import {
  checkPort,
  commandPath,
  commandVersion,
  findPortListeners,
  getHost,
  getPort,
  isProcessAlive,
  mergedEnv,
  readPidFile,
} from "./env-utils.mjs";

const env = mergedEnv();
const checks = [];

function add(status, label, detail) {
  checks.push({ status, label, detail });
}

function installed(command) {
  const path = commandPath(command);
  const versionArgs = command === "gh" ? ["--version"] : ["-v"];
  const version = path ? commandVersion(command, versionArgs) : undefined;
  return { path, version };
}

function gitCheckIgnore(path) {
  try {
    execFileSync("git", ["check-ignore", path], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const node = installed("node");
if (node.path && node.version) {
  add("ok", "Node.js", `${node.version} at ${node.path}`);
} else {
  add("fail", "Node.js", "Node.js is required.");
}

const npm = installed("npm");
if (npm.path && npm.version) {
  add("ok", "npm", `${npm.version} at ${npm.path}`);
} else {
  add("warn", "npm", "Missing. Install Homebrew node before adding dependencies.");
}

const npx = installed("npx");
if (npx.path && npx.version) {
  add("ok", "npx", `${npx.version} at ${npx.path}`);
} else {
  add("warn", "npx", "Missing. Browser tooling and scaffolding will be awkward.");
}

const gh = installed("gh");
if (gh.path && gh.version) {
  let authStatus = "not logged in";
  try {
    execFileSync("gh", ["auth", "status"], { stdio: "ignore" });
    authStatus = "authenticated";
  } catch {
    authStatus = "not logged in";
  }

  add("ok", "GitHub CLI", `${gh.version.split("\n")[0]} at ${gh.path}; ${authStatus}.`);
} else {
  add("warn", "GitHub CLI", "Missing. Install `gh` to manage PRs, issues, releases, and GitHub checks from the terminal.");
}

if (existsSync(".env")) {
  add("ok", ".env", "Present.");
} else {
  add("warn", ".env", "Missing. Live X/OpenAI integrations need credentials; replay needs saved local run data.");
}

if (env.OPENAI_API_KEY) {
  add("ok", "OpenAI key", "Configured.");
} else {
  add("warn", "OpenAI key", "Missing. Live X refresh will fail; replay can still read saved local runs.");
}

const configuredModels = {
  scoring: env.OPENAI_SCORING_MODEL || env.OPENAI_MODEL || "gpt-5",
  translation: env.OPENAI_TRANSLATION_MODEL || env.OPENAI_MODEL || "gpt-5",
};
add("ok", "OpenAI configured models", `scoring ${configuredModels.scoring}; translation ${configuredModels.translation}.`);

if (existsSync(".data/x-oauth.json")) {
  add("ok", "X OAuth tokens", "Stored local OAuth tokens found.");
} else if (env.X_USER_ID && env.X_USER_ACCESS_TOKEN) {
  add("ok", "X API credentials", "Manual credentials configured.");
} else {
  add("warn", "X API credentials", "Missing OAuth tokens and manual credentials. Use replay until X is connected.");
}

const host = getHost(env);
const port = getPort(env);
const portStatus = await checkPort(host, port);
const pid = readPidFile();
const listeners = findPortListeners(port);

if (portStatus.available) {
  add("ok", "Default dev port", `${host}:${port} is available.`);
} else if (pid && isProcessAlive(pid)) {
  add("ok", "Default dev port", `${host}:${port} is in use by project server pid ${pid}.`);
} else if (listeners.length > 0) {
  const summary = listeners.map((item) => `${item.command} pid ${item.pid}`).join(", ");
  add("warn", "Default dev port", `${host}:${port} is in use by ${summary}, but no project pid file was found. Run npm run server:stop to clean it up.`);
} else if (portStatus.code === "EPERM") {
  add("warn", "Default dev port", `${host}:${port} cannot be probed from this sandbox without approval. This is expected inside Codex; approve npm run server:start/test:smoke-api or run from a normal shell.`);
} else {
  add("warn", "Default dev port", `${host}:${port} is not available (${portStatus.code}). Run npm run server:stop or choose another PORT.`);
}

const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
if (existsSync(chromePath)) {
  add("ok", "Google Chrome", chromePath);
} else {
  add("warn", "Google Chrome", "Missing. Browser UI verification will need Safari or Playwright browsers.");
}

const playwrightCache = `${process.env.HOME}/Library/Caches/ms-playwright`;
if (existsSync(playwrightCache)) {
  add("ok", "Playwright browsers", playwrightCache);
} else {
  add("warn", "Playwright browsers", "Missing. Install with npm/npx before browser automation tests.");
}

if (gitCheckIgnore(".data/runs.json")) {
  add("ok", "Local run data", ".data/ is ignored by git.");
} else {
  add("fail", "Local run data", ".data/ should be ignored by git.");
}

let failures = 0;
for (const check of checks) {
  const marker = check.status === "ok" ? "OK" : check.status === "warn" ? "WARN" : "FAIL";
  console.log(`${marker.padEnd(4)} ${check.label}: ${check.detail}`);
  if (check.status === "fail") {
    failures += 1;
  }
}

process.exitCode = failures > 0 ? 1 : 0;
