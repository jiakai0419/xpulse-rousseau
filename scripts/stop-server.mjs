import { existsSync, rmSync } from "node:fs";
import {
  PID_FILE,
  findPortListeners,
  getHost,
  getPort,
  isProcessAlive,
  isProjectServerProcess,
  isProjectServerProcessShape,
  readPidRecord,
  waitForHealth,
} from "./env-utils.mjs";

const record = readPidRecord();

if (!record) {
  if (existsSync(PID_FILE)) {
    rmSync(PID_FILE, { force: true });
  }

  const listeners = findPortListeners(getPort());
  if (listeners.length > 0) {
    console.error(
      `No trusted project pid record exists. Listener${listeners.length === 1 ? "" : "s"} ${listeners.map((item) => `${item.command} pid ${item.pid}`).join(", ")} will not be stopped.`,
    );
    process.exit(1);
  }

  console.log("No managed project server is running.");
  process.exit(0);
}

const pid = record.pid;
const port = Number(record.port ?? getPort());

if (!isProcessAlive(pid)) {
  rmSync(PID_FILE, { force: true });
  console.log(`Removed stale pid file for pid ${pid}.`);
  process.exit(0);
}

if (!isProjectServerProcess(record, { port })) {
  if (isProjectServerProcessShape(record)) {
    console.error(`Project server pid ${pid} is already starting or draining without a listener. It was not signalled again and its pid record was kept.`);
    process.exit(1);
  }

  rmSync(PID_FILE, { force: true });
  console.error(`Refused to stop live pid ${pid}: it is not the recorded xpulse-rousseau server. The stale pid record was removed.`);
  process.exit(1);
}

if (record.instanceId) {
  try {
    await waitForHealth({
      host: record.host ?? getHost(),
      port,
      timeoutMs: 1_500,
      expectedInstanceId: record.instanceId,
    });
  } catch {
    console.error(`Refused to stop live pid ${pid}: its health identity did not match the trusted pid record.`);
    process.exit(1);
  }
}

try {
  process.kill(pid, "SIGTERM");
} catch (error) {
  if (error?.code === "EPERM") {
    console.error(`Cannot stop pid ${pid}: permission denied. In Codex, rerun this command with approval or stop it from a normal shell.`);
    process.exit(1);
  }

  throw error;
}

for (let attempt = 0; attempt < 50; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (!isProcessAlive(pid)) {
    break;
  }
}

if (isProcessAlive(pid)) {
  console.error(`Project server pid ${pid} did not stop after 5 seconds; the pid record was kept.`);
  process.exit(1);
}

const currentRecord = readPidRecord();
if (currentRecord?.pid === pid && (!record.instanceId || currentRecord.instanceId === record.instanceId)) {
  rmSync(PID_FILE, { force: true });
}

console.log(`Stopped project server pid ${pid}.`);
