import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";
import { configuredOpenAIModels } from "../config/openai.ts";
import { selectedPostCountFromEnv } from "../config/selection.ts";
import type { RefreshProgress, RefreshRun, TimelineSource } from "../domain/tweet.ts";
import { commitRefreshRun, recoverPendingRefreshCommit } from "../services/pipeline/commitRefreshRun.ts";
import { FileRefreshCommitJournal } from "../services/pipeline/refreshCommitJournal.ts";
import { runRefresh } from "../services/pipeline/runRefresh.ts";
import { createReplayRun } from "../services/replay/replayRun.ts";
import { FileLinkPreviewCacheRepository } from "../services/linkPreview/cache.ts";
import { fetchLinkPreviewImage } from "../services/linkPreview/imageProxy.ts";
import { DEFAULT_MEDIA_REQUEST_TIMEOUT_MS, fetchWithTimeout, requestTimeoutMs } from "../services/http/fetchWithTimeout.ts";
import { FileSeenPostRepository } from "../services/seen/seenLedger.ts";
import { FileOpenAICacheRepository } from "../services/openai/cache.ts";
import { FileRunRepository } from "../services/storage/fileRunRepository.ts";
import { buildXOAuthConfig, createOAuthStart, exchangeAuthorizationCode, tokenNeedsRefresh, type PendingOAuthStore } from "../services/x/oauth.ts";
import { FileXRawSnapshotRepository } from "../services/x/rawSnapshotStore.ts";
import { FileTimelineCursorRepository } from "../services/x/timelineCursor.ts";
import { FileXTokenStore, type XStoredTokens } from "../services/x/tokenStore.ts";
import { manualXCredentials, oauthXCredentials, resolveXCredentials } from "../services/x/sourceCredentials.ts";
import { loadDotEnv } from "./env.ts";
import { decorateRunUsage, RefreshJobStore, responseJob } from "./refreshJobs.ts";
import {
  allowedRequestHost,
  isApplicationJson,
  localRequestOrigin,
  MAX_JSON_REQUEST_BODY_BYTES,
  mutationRequestError,
  proxiedResourceRequestError,
  readLimitedRequestBody,
  RequestBodyTooLargeError,
} from "./requestSecurity.ts";
import { acquireServerStateLock } from "./stateLock.ts";
import { ActivityTracker } from "./activityTracker.ts";

loadDotEnv();

const repository = new FileRunRepository(process.env.RUN_STORE_PATH);
const xTokenStore = new FileXTokenStore(process.env.X_TOKEN_STORE_PATH);
const seenRepository = new FileSeenPostRepository(process.env.SEEN_POST_STORE_PATH);
const timelineCursor = new FileTimelineCursorRepository(process.env.TIMELINE_CURSOR_PATH);
const refreshCommitJournal = new FileRefreshCommitJournal(process.env.REFRESH_COMMIT_JOURNAL_PATH);
const openAICache = new FileOpenAICacheRepository(process.env.OPENAI_CACHE_PATH);
const linkPreviewCache = new FileLinkPreviewCacheRepository(process.env.LINK_PREVIEW_CACHE_PATH);
const xRawSnapshotRepository = new FileXRawSnapshotRepository(process.env.X_RAW_SNAPSHOT_PATH);
const pendingXOAuth: PendingOAuthStore = new Map();
const refreshJobs = new RefreshJobStore();
const requestActivity = new ActivityTracker();
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
  return localRequestOrigin(request.headers.host!, host, port);
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
  await recoverPendingRefreshCommit({
    repository,
    seenRepository,
    timelineCursor,
    journal: refreshCommitJournal,
  });

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
    journal: refreshCommitJournal,
  });
}

async function readRequestBody(request: IncomingMessage): Promise<string> {
  return readLimitedRequestBody(request, MAX_JSON_REQUEST_BODY_BYTES);
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

  const upstream = await fetchWithTimeout(
    sourceUrl,
    { headers },
    {
      label: "X media request",
      timeoutMs: requestTimeoutMs(process.env.MEDIA_REQUEST_TIMEOUT_MS, DEFAULT_MEDIA_REQUEST_TIMEOUT_MS),
    },
  );
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

  const stream = Readable.fromWeb(upstream.body as unknown as NodeReadableStream<Uint8Array>);

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

async function proxyLinkPreviewImage(response: ServerResponse, url: URL): Promise<void> {
  const rawUrl = url.searchParams.get("url");

  if (!rawUrl) {
    sendJson(response, 400, { error: "A link preview image URL is required." });
    return;
  }

  try {
    const image = await fetchLinkPreviewImage(rawUrl);
    response.writeHead(200, {
      "Cache-Control": "private, max-age=86400",
      "Content-Length": String(image.body.byteLength),
      "Content-Type": image.contentType,
      "X-Content-Type-Options": "nosniff",
    });
    response.end(image.body);
  } catch (error) {
    sendJson(response, 502, {
      error: error instanceof Error ? error.message : "Link preview image could not be loaded safely.",
    });
  }
}

async function handleApi(request: IncomingMessage, response: ServerResponse, url: URL): Promise<void> {
  if (request.method === "POST") {
    const mutationError = mutationRequestError({
      origin: request.headers.origin,
      secFetchSite: request.headers["sec-fetch-site"],
      configuredHost: host,
      configuredPort: port,
    });

    if (mutationError) {
      sendJson(response, 403, { error: mutationError });
      return;
    }
  }

  if (
    request.method === "GET" &&
    (url.pathname === "/api/media/proxy" || url.pathname === "/api/link-preview/image")
  ) {
    const proxyError = proxiedResourceRequestError(request.headers["sec-fetch-site"]);

    if (proxyError) {
      sendJson(response, 403, { error: proxyError });
      return;
    }
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      service: "xpulse-rousseau",
      instanceId: process.env.SERVER_INSTANCE_ID,
      source: process.env.TIMELINE_SOURCE === "x" ? "x" : "replay",
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/media/proxy") {
    await proxyMedia(request, response, url);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/link-preview/image") {
    await proxyLinkPreviewImage(response, url);
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
    const manualCredentials = Boolean(manualXCredentials(process.env));
    let tokens: XStoredTokens | undefined;
    let oauthCredentialError: string | undefined;

    try {
      tokens = await xTokenStore.get();
    } catch (error) {
      if (!manualCredentials) {
        throw error;
      }

      oauthCredentialError = "Stored OAuth credentials could not be read; using manual credentials.";
    }

    const oauthCredentials = oauthXCredentials(tokens);
    const activeCredentials = resolveXCredentials(process.env, tokens);
    sendJson(response, 200, {
      configured: Boolean(config.clientId || activeCredentials),
      oauthConfigured: Boolean(config.clientId),
      authenticated: activeCredentials?.source === "oauth",
      oauthAuthenticated: Boolean(oauthCredentials),
      oauthNeedsRefresh: Boolean(tokens && tokenNeedsRefresh(tokens)),
      oauthCredentialError,
      manualCredentials,
      user: activeCredentials?.identity.source === "oauth" ? activeCredentials.identity.user : undefined,
      activeSource: activeCredentials?.source,
      activeSourceIdentity: activeCredentials?.identity,
      expiresAt: tokens?.expiresAt,
      scope: tokens?.scope,
      redirectUri: config.redirectUri,
      scopes: config.scopes,
      preferredSource: process.env.TIMELINE_SOURCE === "x" ? "x" : "replay",
      xReady: Boolean(activeCredentials),
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
    if (!isApplicationJson(request.headers["content-type"])) {
      sendJson(response, 415, { error: "Pulse requests require Content-Type: application/json." });
      return;
    }

    const rawBody = await readRequestBody(request);
    let body: { source?: unknown } = {};

    try {
      body = rawBody ? JSON.parse(rawBody) as { source?: unknown } : {};
    } catch {
      sendJson(response, 400, { error: "Pulse request body must be valid JSON." });
      return;
    }

    const job = refreshJobs.start(requestedSource(body.source), {
      run: executeRefreshJob,
      commit: commitRefreshJobRun,
    });
    sendJson(response, 202, { job: responseJob(job) });
    return;
  }

  sendJson(response, 404, { error: "API route not found." });
}

let shuttingDown = false;

const server = createServer(async (request, response) => {
  const finishRequest = requestActivity.enter();

  try {
    if (shuttingDown) {
      sendJson(response, 503, { error: "Server is shutting down." });
      return;
    }

    if (!allowedRequestHost(request.headers.host, host, port)) {
      sendJson(response, 403, { error: "Request Host is not allowed for this local server." });
      return;
    }

    const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);

    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }

    await serveStatic(url.pathname, response);
  } catch (error) {
    if (!response.destroyed && !response.headersSent) {
      sendJson(response, error instanceof RequestBodyTooLargeError ? error.statusCode : 500, {
        error: error instanceof Error ? error.message : "Unknown server error.",
      });
    } else if (!response.destroyed) {
      response.destroy(error instanceof Error ? error : undefined);
    }
  } finally {
    finishRequest();
  }
});

const stateLock = await acquireServerStateLock(
  process.env.SERVER_STATE_LOCK_PATH,
  { instanceId: process.env.SERVER_INSTANCE_ID },
);

try {
  await recoverPendingRefreshCommit({
    repository,
    seenRepository,
    timelineCursor,
    journal: refreshCommitJournal,
  });
} catch (error) {
  await stateLock.release();
  throw error;
}

async function shutDownServer(): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  server.close();
  server.closeAllConnections();

  // Stop accepting requests but let an already-paid Pulse reach its normal commit/failure
  // boundary. The process-level state lock remains owned throughout the drain, so a
  // successor cannot overlap writes. Provider clients have their own finite timeouts.
  await Promise.all([
    refreshJobs.whenIdle(),
    requestActivity.whenIdle(),
  ]);

  try {
    await stateLock.release();
    process.exit(0);
  } catch (error) {
    console.error("Server drained but could not release its state lock cleanly.", error);
    process.exit(1);
  }
}

process.once("SIGINT", () => void shutDownServer());
process.once("SIGTERM", () => void shutDownServer());

server.listen(port, host, () => {
  console.log(`xpulse-rousseau is running at http://${host}:${port}`);
});
