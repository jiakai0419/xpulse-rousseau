import { existsSync, rmSync } from "node:fs";
import { PID_FILE, findPortListeners, getPort, isProcessAlive, readPidFile } from "./env-utils.mjs";

let pid = readPidFile();
let source = "pid file";

if (!pid) {
  const listeners = findPortListeners(getPort()).filter((item) => item.command === "node");
  if (listeners.length === 1) {
    pid = listeners[0].pid;
    source = `lsof ${listeners[0].command} listener`;
  } else if (listeners.length > 1) {
    console.error(`Multiple node listeners found: ${listeners.map((item) => item.pid).join(", ")}. Stop one manually.`);
    process.exit(1);
  } else {
    console.log("No project server pid file or node listener found.");
    process.exit(0);
  }
}

if (!isProcessAlive(pid)) {
  rmSync(PID_FILE, { force: true });
  console.log(`Removed stale pid file for pid ${pid}.`);
  process.exit(0);
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

for (let attempt = 0; attempt < 20; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 100));
  if (!isProcessAlive(pid)) {
    break;
  }
}

if (existsSync(PID_FILE)) {
  rmSync(PID_FILE, { force: true });
}

console.log(`Stopped project server pid ${pid} (${source}).`);
