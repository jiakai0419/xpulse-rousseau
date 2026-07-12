import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createServerInstanceId,
  findAvailablePort,
  getHost,
  isolatedServerStateEnv,
  spawnServer,
  waitForHealth,
} from "./env-utils.mjs";

const host = getHost();
const port = process.env.SMOKE_PORT ? Number(process.env.SMOKE_PORT) : await findAvailablePort(host);
const temporaryDirectory = mkdtempSync(join(tmpdir(), "xpulse-smoke-"));
const runStorePath = join(temporaryDirectory, "runs.json");
const instanceId = createServerInstanceId();
const requestTimeoutMs = 5_000;
const jobTimeoutMs = 30_000;

function seedReplayStore(filePath) {
  const sourceStore = JSON.parse(readFileSync(".data/runs.json", "utf8"));
  const sourceRun = sourceStore.runs.find((run) => run.source === "x");

  if (!sourceRun) {
    throw new Error("Smoke replay needs at least one saved live X run in .data/runs.json.");
  }

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify({ runs: [sourceRun] }, null, 2), { encoding: "utf8", mode: 0o600 });
  chmodSync(filePath, 0o600);
  return sourceRun;
}

const sourceRun = seedReplayStore(runStorePath);
const child = spawnServer({
  host,
  port,
  instanceId,
  stdio: ["ignore", "pipe", "pipe"],
  extraEnv: {
    ...isolatedServerStateEnv(temporaryDirectory, { runStorePath }),
    TIMELINE_SOURCE: "replay",
    OPENAI_API_KEY: "",
    X_USER_ID: "",
    X_USER_ACCESS_TOKEN: "",
    X_CLIENT_ID: "",
    X_CLIENT_SECRET: "",
  },
});
const childExit = new Promise((resolve) => {
  child.once("exit", (code, signal) => {
    resolve({ code, signal });
  });
});

let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});

try {
  await Promise.race([
    waitForHealth({ host, port, timeoutMs: 5000, expectedInstanceId: instanceId }),
    childExit.then((exit) => {
      throw new Error(`Server exited before smoke health check passed (code ${exit.code ?? "null"}, signal ${exit.signal ?? "null"}).`);
    }),
  ]);

  const refresh = await fetch(`http://${host}:${port}/api/runs/jobs`, {
    method: "POST",
    signal: AbortSignal.timeout(requestTimeoutMs),
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ source: "replay" }),
  });

  if (!refresh.ok) {
    throw new Error(`Refresh job endpoint failed: ${refresh.status} ${await refresh.text()}`);
  }

  let payload = await refresh.json();
  let job = payload.job;
  const jobDeadline = Date.now() + jobTimeoutMs;

  while (job.status === "running") {
    if (Date.now() >= jobDeadline) {
      throw new Error(`Timed out after ${jobTimeoutMs}ms waiting for replay job ${job.id}.`);
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
    const jobResponse = await fetch(`http://${host}:${port}/api/runs/jobs/${encodeURIComponent(job.id)}`, {
      signal: AbortSignal.timeout(requestTimeoutMs),
    });
    payload = await jobResponse.json();

    if (!jobResponse.ok) {
      throw new Error(`Refresh job polling failed: ${jobResponse.status} ${JSON.stringify(payload)}`);
    }

    job = payload.job;
  }

  if (job.status !== "completed") {
    throw new Error(`Refresh job failed: ${job.error ?? "unknown error"}`);
  }

  const run = job.run;
  const page = await fetch(`http://${host}:${port}/`, { signal: AbortSignal.timeout(requestTimeoutMs) });

  if (!page.ok) {
    throw new Error(`Page request failed: ${page.status}`);
  }

  if (run?.source !== "replay" || run?.replayOf?.runId !== sourceRun.id) {
    throw new Error("Expected smoke refresh to replay the latest saved live X run.");
  }

  if (run?.selectedPosts?.length !== sourceRun.selectedPosts.length) {
    throw new Error(`Expected smoke replay to keep ${sourceRun.selectedPosts.length} selected posts.`);
  }

  if (!run.selectedPosts.every((item) => item.translation?.textZh)) {
    throw new Error("Expected smoke replay to preserve recorded translations.");
  }

  if (run.usage?.length) {
    throw new Error("Expected smoke replay to avoid new X/OpenAI usage records.");
  }

  console.log(`OK smoke replay: ${run.stats.fetched} fetched, ${run.stats.selected} selected from ${sourceRun.id} at http://${host}:${port}`);
} catch (error) {
  console.error(output.trim());
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  child.kill("SIGTERM");
  await Promise.race([
    childExit,
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
  }
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
