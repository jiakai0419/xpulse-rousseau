import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { getHost, spawnServer, waitForHealth } from "./env-utils.mjs";

const host = getHost();
const port = Number(process.env.SMOKE_PORT || 3100);
const runStorePath = ".data/smoke-runs.json";

function seedReplayStore(filePath) {
  const sourceStore = JSON.parse(readFileSync(".data/runs.json", "utf8"));
  const sourceRun = sourceStore.runs.find((run) => run.source === "x");

  if (!sourceRun) {
    throw new Error("Smoke replay needs at least one saved live X run in .data/runs.json.");
  }

  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify({ runs: [sourceRun] }, null, 2), "utf8");
  return sourceRun;
}

const sourceRun = seedReplayStore(runStorePath);
const child = spawnServer({
  host,
  port,
  stdio: ["ignore", "pipe", "pipe"],
  extraEnv: {
    RUN_STORE_PATH: runStorePath,
    TIMELINE_SOURCE: "replay",
    OPENAI_API_KEY: "",
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
    waitForHealth({ host, port, timeoutMs: 5000 }),
    childExit.then((exit) => {
      throw new Error(`Server exited before smoke health check passed (code ${exit.code ?? "null"}, signal ${exit.signal ?? "null"}).`);
    }),
  ]);

  const refresh = await fetch(`http://${host}:${port}/api/runs/jobs`, {
    method: "POST",
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

  while (job.status === "running") {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const jobResponse = await fetch(`http://${host}:${port}/api/runs/jobs/${encodeURIComponent(job.id)}`);
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
  const page = await fetch(`http://${host}:${port}/`);

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
  rmSync(runStorePath, { force: true });
}
