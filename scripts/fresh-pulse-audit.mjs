import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  createServerInstanceId,
  getHost,
  isProjectServerProcess,
  isProjectServerProcessShape,
  readPidRecord,
  spawnServer,
  waitForHealth,
} from "./env-utils.mjs";

const host = getHost();
const port = positiveInt(process.env.FRESH_PULSE_PORT, 3500);
const pulseRuns = positiveInt(process.env.FRESH_PULSE_RUNS, 1);
const timeoutMs = positiveInt(process.env.FRESH_PULSE_TIMEOUT_MS, 20 * 60 * 1000);
const shutdownTimeoutMs = positiveInt(process.env.FRESH_PULSE_SHUTDOWN_TIMEOUT_MS, Math.max(timeoutMs, 25 * 60 * 1000));
const forceKillOnShutdownTimeout = process.env.FRESH_PULSE_FORCE_KILL_ON_SHUTDOWN_TIMEOUT === "1";
const renderingCheck = process.env.FRESH_PULSE_RENDERING_CHECK !== "0";
const renderingCheckTimeoutMs = positiveInt(process.env.FRESH_PULSE_RENDERING_CHECK_TIMEOUT_MS, 8 * 60 * 1000);

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    signal: AbortSignal.timeout(15_000),
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`POST ${url} failed with HTTP ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

async function getJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });

  if (!response.ok) {
    throw new Error(`GET ${url} failed with HTTP ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

async function waitForJob(baseUrl, jobId, onSettled = () => {}) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { job } = await getJson(`${baseUrl}/api/runs/jobs/${encodeURIComponent(jobId)}`);

    if (!job) {
      throw new Error(`Fresh Pulse job disappeared: ${jobId}`);
    }

    const progress = job.progress;
    const processed = progress?.processedItems && progress?.totalItems ? ` (${progress.processedItems}/${progress.totalItems})` : "";
    console.log(`${job.id}: ${job.status} · ${progress?.label ?? "Pulse"}${processed}`);

    if (job.status === "completed") {
      onSettled();
      return job.run;
    }

    if (job.status === "failed") {
      onSettled();
      throw new Error(`Fresh Pulse failed: ${job.error ?? progress?.detail ?? "unknown error"}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  throw new Error(`Timed out waiting for Fresh Pulse job ${jobId}.`);
}

function exitsWithin(childExit, timeout) {
  let timer;
  const deadline = new Promise((resolveDeadline) => {
    timer = setTimeout(() => resolveDeadline(false), timeout);
  });

  return Promise.race([childExit.then(() => true), deadline]).finally(() => clearTimeout(timer));
}

export async function shutdownAuditServer({
  child,
  childExit,
  activeJobId,
  paidShutdownTimeoutMs,
  idleShutdownTimeoutMs = 10_000,
  forceKillPaidJobOnTimeout = false,
  log = (message) => console.error(message),
}) {
  child.kill("SIGTERM");
  const gracefulTimeoutMs = activeJobId ? paidShutdownTimeoutMs : idleShutdownTimeoutMs;

  if (await exitsWithin(childExit, gracefulTimeoutMs)) {
    return { forced: false };
  }

  if (activeJobId && !forceKillPaidJobOnTimeout) {
    log(
      `Fresh Pulse job ${activeJobId} may still be finishing paid X/OpenAI work after ${Math.round(gracefulTimeoutMs / 1000)} seconds. The audit will keep waiting and will not SIGKILL it. Set FRESH_PULSE_FORCE_KILL_ON_SHUTDOWN_TIMEOUT=1 only if discarding that in-flight work is intentional.`,
    );
    await childExit;
    return { forced: false };
  }

  if (activeJobId) {
    log(
      `Force-killing Fresh Pulse job ${activeJobId} after ${Math.round(gracefulTimeoutMs / 1000)} seconds; any in-flight provider work may be lost even if it was already billed.`,
    );
  } else {
    log(`Fresh Pulse server did not exit while idle after ${Math.round(gracefulTimeoutMs / 1000)} seconds; force-killing it.`);
  }

  child.kill("SIGKILL");
  await childExit;
  return { forced: true };
}

function runRenderingCheck(runId, index) {
  const env = {
    ...process.env,
    BROWSER_SMOKE_PORT: String(port + 100 + index),
    BROWSER_SMOKE_RUN_STORE: ".data/runs.json",
    BROWSER_SMOKE_RUN_ID: runId,
    BROWSER_SMOKE_SCREENSHOT: `.data/fresh-pulse-rendering/${runId}.png`,
  };

  const result = spawnSync(process.execPath, ["scripts/browser-smoke.mjs"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    timeout: renderingCheckTimeoutMs,
  });

  if (result.stdout.trim()) {
    console.log(result.stdout.trim());
  }

  if (result.stderr.trim()) {
    console.error(result.stderr.trim());
  }

  if (result.error) {
    const detail =
      result.error.code === "ETIMEDOUT" ? `timed out after ${Math.round(renderingCheckTimeoutMs / 1000)} seconds` : result.error.message;
    throw new Error(`Fresh Pulse rendering check failed for run ${runId}: ${detail}.`);
  }

  if (result.status !== 0) {
    throw new Error(`Fresh Pulse rendering check failed for run ${runId}.`);
  }
}

async function main() {
  const managedRecord = readPidRecord();
  if (
    managedRecord &&
    (isProjectServerProcess(managedRecord, { port: Number(managedRecord.port ?? 3000) }) ||
      isProjectServerProcessShape(managedRecord))
  ) {
    throw new Error(
      `A managed project server is already running, starting, or draining at ${managedRecord.host ?? "127.0.0.1"}:${managedRecord.port ?? 3000}. Stop it and let any paid Pulse finish before a fresh Pulse audit so two Online writers cannot share local state.`,
    );
  }

  const baseUrl = `http://${host}:${port}`;
  const instanceId = createServerInstanceId();
  const child = spawnServer({
    host,
    port,
    instanceId,
    stdio: ["ignore", "pipe", "pipe"],
    extraEnv: {
      TIMELINE_SOURCE: "x",
    },
  });
  let serverOutput = "";

  child.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });

  const childExit = new Promise((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  let activeJobId;

  try {
    await Promise.race([
      waitForHealth({ host, port, timeoutMs: 10_000, expectedInstanceId: instanceId }),
      childExit.then((exit) => {
        throw new Error(`Fresh Pulse server exited early (code ${exit.code ?? "null"}, signal ${exit.signal ?? "null"}).`);
      }),
    ]);

    const runIds = [];

    for (let index = 0; index < pulseRuns; index += 1) {
      console.log(`Starting fresh Online Pulse ${index + 1}/${pulseRuns}...`);
      // Once the POST is attempted, the server may have accepted paid work even if
      // the 202 response or JSON body never reaches this client.
      activeJobId = "job id pending from Pulse response";
      const { job } = await postJson(`${baseUrl}/api/runs/jobs`, { source: "x" });
      if (typeof job?.id !== "string" || !job.id) {
        throw new Error("Fresh Pulse response did not include a valid job id; paid work may still be running.");
      }
      activeJobId = job.id;
      const run = await waitForJob(baseUrl, job.id, () => {
        activeJobId = undefined;
      });
      runIds.push(run.id);
      console.log(`OK fresh Online Pulse ${index + 1}/${pulseRuns}: ${run.id}, selected ${run.stats.selected}`);

      if (renderingCheck) {
        runRenderingCheck(run.id, index);
      }
    }

    console.log(`OK fresh Pulse audit: ${runIds.join(", ")}`);
  } catch (error) {
    if (serverOutput.trim()) {
      console.error(serverOutput.trim());
    }

    throw error;
  } finally {
    await shutdownAuditServer({
      child,
      childExit,
      activeJobId,
      paidShutdownTimeoutMs: shutdownTimeoutMs,
      forceKillPaidJobOnTimeout: forceKillOnShutdownTimeout,
    });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
