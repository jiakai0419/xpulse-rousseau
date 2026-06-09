import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { configuredOpenAIModels } from "../config/openai.ts";
import { selectedPostCountFromEnv } from "../config/selection.ts";
import type { RefreshProgress, RefreshRun, TimelineSource } from "../domain/tweet.ts";
import { commitRefreshRun } from "../services/pipeline/commitRefreshRun.ts";
import { runRefresh } from "../services/pipeline/runRefresh.ts";
import { createReplayRun } from "../services/replay/replayRun.ts";
import { FileLinkPreviewCacheRepository } from "../services/linkPreview/cache.ts";
import { FileSeenPostRepository } from "../services/seen/seenLedger.ts";
import { FileOpenAICacheRepository } from "../services/openai/cache.ts";
import { FileRunRepository } from "../services/storage/fileRunRepository.ts";
import { buildXOAuthConfig, createOAuthStart, exchangeAuthorizationCode, type PendingOAuthStore } from "../services/x/oauth.ts";
import { FileXRawSnapshotRepository } from "../services/x/rawSnapshotStore.ts";
import { FileTimelineCursorRepository } from "../services/x/timelineCursor.ts";
import { FileXTokenStore } from "../services/x/tokenStore.ts";
import { loadDotEnv } from "./env.ts";
import { decorateRunUsage, RefreshJobStore, responseJob } from "./refreshJobs.ts";

loadDotEnv();

const repository = new FileRunRepository(process.env.RUN_STORE_PATH);
const xTokenStore = new FileXTokenStore();
const seenRepository = new FileSeenPostRepository();
const timelineCursor = new FileTimelineCursorRepository();
const openAICache = new FileOpenAICacheRepository();
const linkPreviewCache = new FileLinkPreviewCacheRepository();
const xRawSnapshotRepository = new FileXRawSnapshotRepository();
const pendingXOAuth: PendingOAuthStore = new Map();
const refreshJobs = new RefreshJobStore();
const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? "127.0.0.1";
const rootDir = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const publicDir = join(rootDir, "public");

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function sendJson(response: ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload, null, 2));
}

function sendText(response: ServerResponse, statusCode: number, text: string): void {
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
  });
  response.end(text);
}

function sendRedirect(response: ServerResponse, location: string): void {
  response.writeHead(302, {
    Location: location,
  });
  response.end();
}

function requestOrigin(request: IncomingMessage): string {
  const forwardedProto = request.headers["x-forwarded-proto"];
  const proto = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto;
  return `${proto ?? "http"}://${request.headers.host ?? `${host}:${port}`}`;
}

function prunePendingOAuth(store: PendingOAuthStore, now = Date.now()): void {
  for (const [state, pending] of store.entries()) {
    if (now - pending.createdAt > 10 * 60 * 1000) {
      store.delete(state);
    }
  }
}

function openAIKey(): string | undefined {
  return process.env.OPENAI_API_KEY?.startsWith("sk-") ? process.env.OPENAI_API_KEY : undefined;
}

function requestedSource(source: unknown): TimelineSource {
  return source === "x" ? "x" : "replay";
}

async function runReplayRefresh(now = new Date()): Promise<RefreshRun> {
  const sourceRun = await repository.latestBySource("x");

  if (!sourceRun) {
    throw new Error("No live X run is available to replay. Run X once before using replay.");
  }

  return createReplayRun(sourceRun, now);
}

async function executeRefreshJob(options: {
  source: TimelineSource;
  onProgress(progress: RefreshProgress): void;
}): Promise<RefreshRun> {
  if (options.source === "replay") {
    return runReplayRefresh();
  }

  return runRefresh({
    source: "x",
    xTokenStore,
    timelineCursor,
    seenRepository,
    openAICache,
    linkPreviewCache,
    xRawSnapshotRepository,
    onProgress: options.onProgress,
  });
}

async function commitRefreshJobRun(run: RefreshRun): Promise<void> {
  await commitRefreshRun(run, {
    repository,
    seenRepository,
    timelineCursor,
  });
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  return Buffer.concat(chunks).toString("utf8");
}

async function serveStatic(pathname: string, response: ServerResponse): Promise<void> {
  const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
  const normalized = normalize(relativePath);
  const filePath = join(publicDir, normalized);

  if (!filePath.startsWith(publicDir)) {
    sendText(response, 403, "Forbidden");
    return;
  }

  try {
    const fileStat = await stat(filePath);

    if (!fileStat.isFile()) {
      sendText(response, 404, "Not found");
      return;
    }

    const content = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream",
    });
    response.end(content);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      sendText(response, 404, "Not found");
      return;
    }

    throw error;
  }
}

function mediaProxyUrl(rawUrl: string | null): URL | undefined {
  if (!rawUrl) {
    return undefined;
  }

  try {
    const url = new URL(rawUrl);

    if (url.protocol !== "https:" || url.hostname !== "video.twimg.com") {
      return undefined;
    }

    return url;
  } catch {
    return undefined;
  }
}

async function proxyMedia(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  const sourceUrl = mediaProxyUrl(url.searchParams.get("url"));

  if (!sourceUrl) {
    sendJson(response, 400, { error: "Only https://video.twimg.com media URLs can be proxied." });
    return;
  }

  const headers = new Headers({
    Accept: request.headers.accept ?? "*/*",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 X-Pulse/1.0",
  });

  if (request.headers.range) {
    headers.set("Range", request.headers.range);
  }

  const upstream = await fetch(sourceUrl, { headers });
  const responseHeaders: Record<string, string> = {
    "Cache-Control": "private, max-age=86400",
    "Content-Type": upstream.headers.get("content-type") ?? "video/mp4",
  };

  for (const header of ["accept-ranges", "content-length", "content-range"]) {
    const value = upstream.headers.get(header);

    if (value) {
      responseHeaders[header] = value;
    }
  }

  response.writeHead(upstream.status, responseHeaders);

  if (!upstream.body) {
    response.end();
    return;
  }

  const stream = Readable.fromWeb(upstream.body);

  response.on("close", () => {
    stream.destroy();
  });
  stream.on("error", (error) => {
    if (!response.destroyed) {
      response.destroy(error);
    }
  });
  stream.pipe(response);
}

async function handleApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      source: process.env.TIMELINE_SOURCE === "x" ? "x" : "replay",
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/media/proxy") {
    await proxyMedia(request, response, url);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/app/status") {
    const replaySourceRun = await repository.latestBySource("x");
    sendJson(response, 200, {
      openai: {
        configured: Boolean(openAIKey()),
        configuredModels: configuredOpenAIModels(process.env),
      },
      replay: {
        available: Boolean(replaySourceRun),
        sourceRunId: replaySourceRun?.id,
        sourceRunCreatedAt: replaySourceRun?.createdAt,
      },
      selectedPostCount: selectedPostCountFromEnv(process.env),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/runs/latest") {
    const run = await repository.latest();
    sendJson(response, 200, {
      run: run ? decorateRunUsage(run) : undefined,
    });
    return;
  }

  const traceMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/trace$/);
  if (request.method === "GET" && traceMatch) {
    const run = await repository.find(decodeURIComponent(traceMatch[1]));

    if (!run) {
      sendJson(response, 404, { error: "Run not found." });
      return;
    }

    sendJson(response, 200, { trace: run.trace });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/runs/jobs/latest") {
    const job = refreshJobs.latest();
    sendJson(response, 200, {
      job: job ? responseJob(job) : undefined,
    });
    return;
  }

  const jobMatch = url.pathname.match(/^\/api\/runs\/jobs\/([^/]+)$/);
  if (request.method === "GET" && jobMatch) {
    const job = refreshJobs.get(decodeURIComponent(jobMatch[1]));

    if (!job) {
      sendJson(response, 404, { error: "Refresh job not found." });
      return;
    }

    sendJson(response, 200, {
      job: responseJob(job),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/x/status") {
    const config = buildXOAuthConfig(process.env, requestOrigin(request));
    const tokens = await xTokenStore.get();
    const manualCredentials = Boolean(process.env.X_USER_ID && process.env.X_USER_ACCESS_TOKEN);
    sendJson(response, 200, {
      configured: Boolean(config.clientId),
      authenticated: Boolean(tokens?.accessToken && tokens.user),
      manualCredentials,
      user: tokens?.user,
      expiresAt: tokens?.expiresAt,
      scope: tokens?.scope,
      redirectUri: config.redirectUri,
      scopes: config.scopes,
      preferredSource: process.env.TIMELINE_SOURCE === "x" ? "x" : "replay",
      xReady: Boolean(manualCredentials || (tokens?.accessToken && tokens.user?.id)),
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/x/start") {
    const config = buildXOAuthConfig(process.env, requestOrigin(request));

    if (!config.clientId) {
      sendJson(response, 400, {
        error: "X_CLIENT_ID is required before starting X OAuth.",
        redirectUri: config.redirectUri,
      });
      return;
    }

    prunePendingOAuth(pendingXOAuth);
    const start = createOAuthStart(config);
    pendingXOAuth.set(start.state, start);
    sendRedirect(response, start.authorizationUrl);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/auth/x/callback") {
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");

    if (error) {
      sendRedirect(response, `/?x_auth=error&message=${encodeURIComponent(error)}`);
      return;
    }

    if (!code || !state) {
      sendRedirect(response, "/?x_auth=error&message=missing_code_or_state");
      return;
    }

    const pending = pendingXOAuth.get(state);
    pendingXOAuth.delete(state);

    if (!pending) {
      sendRedirect(response, "/?x_auth=error&message=unknown_or_expired_state");
      return;
    }

    const config = buildXOAuthConfig(process.env, requestOrigin(request));
    const tokens = await exchangeAuthorizationCode(config, code, pending.codeVerifier, pending.redirectUri);
    await xTokenStore.save(tokens);
    sendRedirect(response, "/?x_auth=success");
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/auth/x/logout") {
    await xTokenStore.clear();
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/runs/jobs") {
    const rawBody = await readRequestBody(request);
    const body = rawBody ? JSON.parse(rawBody) as { source?: unknown } : {};
    const job = refreshJobs.start(requestedSource(body.source), {
      run: executeRefreshJob,
      commit: commitRefreshJobRun,
    });
    sendJson(response, 202, { job: responseJob(job) });
    return;
  }

  sendJson(response, 404, { error: "API route not found." });
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    await serveStatic(url.pathname, response);
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "Unknown server error.",
    });
  }
});

server.listen(port, host, () => {
  console.log(`xpulse-rousseau is running at http://${host}:${port}`);
});
