import { spawnSync } from "node:child_process";
import { getHost, spawnServer, waitForHealth } from "./env-utils.mjs";

const host = getHost();
const port = positiveInt(process.env.FRESH_PULSE_PORT, 3500);
const pulseRuns = positiveInt(process.env.FRESH_PULSE_RUNS, 1);
const displayAudit = process.env.FRESH_PULSE_DISPLAY_AUDIT !== "0";
const displayAuditAuth = process.env.FRESH_PULSE_DISPLAY_AUDIT_AUTH === "1";
const timeoutMs = positiveInt(process.env.FRESH_PULSE_TIMEOUT_MS, 20 * 60 * 1000);
const displayAuditTimeoutMs = positiveInt(process.env.FRESH_PULSE_DISPLAY_AUDIT_TIMEOUT_MS, 8 * 60 * 1000);

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
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
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`GET ${url} failed with HTTP ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

async function waitForJob(baseUrl, jobId) {
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
      return job.run;
    }

    if (job.status === "failed") {
      throw new Error(`Fresh Pulse failed: ${job.error ?? progress?.detail ?? "unknown error"}`);
    }

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }

  throw new Error(`Timed out waiting for Fresh Pulse job ${jobId}.`);
}

function runDisplayAudit(runId, index) {
  const env = {
    ...process.env,
    DISPLAY_AUDIT_RUN_IDS: runId,
    DISPLAY_AUDIT_MAX: process.env.FRESH_PULSE_DISPLAY_AUDIT_MAX || "7",
    DISPLAY_AUDIT_PER_BUCKET: process.env.FRESH_PULSE_DISPLAY_AUDIT_PER_BUCKET || "1",
    DISPLAY_AUDIT_PORT: String(port + 100 + index),
  };

  if (displayAuditAuth) {
    env.DISPLAY_AUDIT_AUTH_PROFILE = "1";
  }

  const result = spawnSync(process.execPath, ["scripts/display-fidelity-audit.mjs"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    timeout: displayAuditTimeoutMs,
  });

  if (result.stdout.trim()) {
    console.log(result.stdout.trim());
  }

  if (result.stderr.trim()) {
    console.error(result.stderr.trim());
  }

  if (result.error) {
    const detail = result.error.code === "ETIMEDOUT" ? `timed out after ${Math.round(displayAuditTimeoutMs / 1000)} seconds` : result.error.message;
    throw new Error(`Display audit failed for fresh Pulse run ${runId}: ${detail}.`);
  }

  if (result.status !== 0) {
    throw new Error(`Display audit failed for fresh Pulse run ${runId}.`);
  }
}

async function main() {
  const baseUrl = `http://${host}:${port}`;
  const child = spawnServer({
    host,
    port,
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

  try {
    await Promise.race([
      waitForHealth({ host, port, timeoutMs: 10_000 }),
      childExit.then((exit) => {
        throw new Error(`Fresh Pulse server exited early (code ${exit.code ?? "null"}, signal ${exit.signal ?? "null"}).`);
      }),
    ]);

    const runIds = [];

    for (let index = 0; index < pulseRuns; index += 1) {
      console.log(`Starting fresh Online Pulse ${index + 1}/${pulseRuns}...`);
      const { job } = await postJson(`${baseUrl}/api/runs/jobs`, { source: "x" });
      const run = await waitForJob(baseUrl, job.id);
      runIds.push(run.id);
      console.log(`OK fresh Online Pulse ${index + 1}/${pulseRuns}: ${run.id}, selected ${run.stats.selected}`);

      if (displayAudit) {
        runDisplayAudit(run.id, index);
      }
    }

    console.log(`OK fresh Pulse audit: ${runIds.join(", ")}`);
  } catch (error) {
    if (serverOutput.trim()) {
      console.error(serverOutput.trim());
    }

    throw error;
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
