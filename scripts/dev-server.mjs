import { existsSync, rmSync } from "node:fs";
import {
  PID_FILE,
  checkPort,
  findPortListeners,
  getHost,
  getPort,
  isProcessAlive,
  readPidFile,
  spawnServer,
  waitForHealth,
  writePidFile,
} from "./env-utils.mjs";

const host = getHost();
const port = getPort();
const existingPid = readPidFile();

if (existingPid && isProcessAlive(existingPid)) {
  console.log(`Project server already appears to be running at http://${host}:${port} (pid ${existingPid}).`);
  process.exit(0);
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

const child = spawnServer({ host, port });
writePidFile(child.pid);

const cleanup = () => {
  if (existsSync(PID_FILE)) {
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
  await waitForHealth({ host, port, timeoutMs: 5000 });
  console.log(`Ready: http://${host}:${port}`);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  child.kill("SIGTERM");
  process.exit(1);
}
