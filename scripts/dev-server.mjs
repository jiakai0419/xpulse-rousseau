import { existsSync, rmSync } from "node:fs";
import {
  PID_FILE,
  checkPort,
  createServerInstanceId,
  findPortListeners,
  getHost,
  getPort,
  isProjectServerProcess,
  isProjectServerProcessShape,
  isProcessAlive,
  pidRecordMatchesEndpoint,
  readPidRecord,
  spawnServer,
  waitForHealth,
  writePidFile,
} from "./env-utils.mjs";

const host = getHost();
const port = getPort();
const existingRecord = readPidRecord();

if (existingRecord?.pid && isProcessAlive(existingRecord.pid)) {
  const existingHost = existingRecord.host ?? host;
  const existingPort = Number(existingRecord.port ?? port);

  if (isProjectServerProcess(existingRecord, { port: existingPort })) {
    if (existingRecord.instanceId) {
      try {
        await waitForHealth({
          host: existingHost,
          port: existingPort,
          timeoutMs: 1_500,
          expectedInstanceId: existingRecord.instanceId,
        });
      } catch {
        console.error(`A live project-shaped process exists at http://${existingHost}:${existingPort}, but its health identity does not match the pid record. It was not stopped and the record was kept.`);
        process.exit(1);
      }
    }

    if (pidRecordMatchesEndpoint(existingRecord, host, port)) {
      console.log(`Project server is already running at http://${existingHost}:${existingPort} (pid ${existingRecord.pid}).`);
      process.exit(0);
    }

    console.error(
      `A managed project server is already running at http://${existingHost}:${existingPort} (pid ${existingRecord.pid}). Stop it before starting another port so both instances cannot write the same local state.`,
    );
    process.exit(1);
  }

  if (isProjectServerProcessShape(existingRecord)) {
    console.error(`Project server pid ${existingRecord.pid} is still starting or draining at http://${existingHost}:${existingPort}. Its pid record was kept; wait for it to exit before starting another instance.`);
    process.exit(1);
  }

  rmSync(PID_FILE, { force: true });
  console.error(`Removed an untrusted stale pid record for live pid ${existingRecord.pid}; that process was not stopped.`);
} else if (existsSync(PID_FILE)) {
  rmSync(PID_FILE, { force: true });
}

const portStatus = await checkPort(host, port);
if (!portStatus.available) {
  console.error(`Cannot start dev server: ${host}:${port} is not available (${portStatus.code}).`);
  const listeners = findPortListeners(port);
  if (listeners.length > 0) {
    console.error(`Listeners: ${listeners.map((item) => `${item.command} pid ${item.pid}`).join(", ")}`);
  }
  console.error("If this is an old project server, run: npm run server:stop");
  process.exit(1);
}

const instanceId = createServerInstanceId();
const child = spawnServer({ host, port, instanceId });
writePidFile({
  pid: child.pid,
  host,
  port,
  cwd: process.cwd(),
  instanceId,
  startedAt: new Date().toISOString(),
});

const cleanup = () => {
  const currentRecord = readPidRecord();
  if (currentRecord?.pid === child.pid && currentRecord?.instanceId === instanceId) {
    rmSync(PID_FILE, { force: true });
  }
};

process.on("SIGINT", () => {
  child.kill("SIGINT");
});

process.on("SIGTERM", () => {
  child.kill("SIGTERM");
});

child.on("exit", (code, signal) => {
  cleanup();
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});

try {
  await waitForHealth({ host, port, timeoutMs: 5000, expectedInstanceId: instanceId });
  console.log(`Ready: http://${host}:${port}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  child.kill("SIGTERM");
  process.exit(1);
}
