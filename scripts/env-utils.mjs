import { chmodSync, existsSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import net from "node:net";

export const DEFAULT_HOST = "127.0.0.1";
export const DEFAULT_PORT = 3000;
export const PID_FILE = ".data/server.pid";

export function commandPath(command) {
  try {
    return execFileSync("which", [command], { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

export function commandVersion(command, args = ["--version"]) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch {
    return undefined;
  }
}

export function readDotEnv(filePath = ".env") {
  if (!existsSync(filePath)) {
    return {};
  }

  const result = {};
  const raw = readFileSync(filePath, "utf8");

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^["']|["']$/g, "");
    result[key] = value;
  }

  return result;
}

export function mergedEnv() {
  return {
    ...readDotEnv(),
    ...process.env,
  };
}

export function getHost(env = mergedEnv()) {
  return env.HOST || DEFAULT_HOST;
}

export function getPort(env = mergedEnv()) {
  const parsed = Number(env.PORT || DEFAULT_PORT);
  return Number.isFinite(parsed) ? parsed : DEFAULT_PORT;
}

export function createServerInstanceId() {
  return randomUUID();
}

export function writePidFile(recordOrPid, filePath = PID_FILE) {
  const directory = dirname(filePath);
  const record = typeof recordOrPid === "number" ? { pid: recordOrPid } : recordOrPid;

  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  writeFileSync(filePath, `${JSON.stringify(record)}\n`, { encoding: "utf8", mode: 0o600 });
  chmodSync(filePath, 0o600);
}

export function readPidRecord(filePath = PID_FILE) {
  if (!existsSync(filePath)) {
    return undefined;
  }

  const raw = readFileSync(filePath, "utf8").trim();

  try {
    const parsed = JSON.parse(raw);
    if (Number.isInteger(parsed?.pid) && parsed.pid > 0) {
      return parsed;
    }

    if (Number.isInteger(parsed) && parsed > 0) {
      return { pid: parsed, legacy: true };
    }
  } catch {
    const pid = Number(raw);
    if (Number.isInteger(pid) && pid > 0) {
      return { pid, legacy: true };
    }
  }

  return undefined;
}

export function readPidFile(filePath = PID_FILE) {
  return readPidRecord(filePath)?.pid;
}

export function pidRecordMatchesEndpoint(record, host, port) {
  return Boolean(record && (record.host ?? host) === host && Number(record.port ?? port) === Number(port));
}

export function isolatedServerStateEnv(directory, options = {}) {
  return {
    RUN_STORE_PATH: options.runStorePath ?? join(directory, "runs.json"),
    X_TOKEN_STORE_PATH: join(directory, "x-oauth.json"),
    SEEN_POST_STORE_PATH: join(directory, "seen-posts.json"),
    TIMELINE_CURSOR_PATH: join(directory, "timeline-cursor.json"),
    REFRESH_COMMIT_JOURNAL_PATH: join(directory, "refresh-commit-journal.json"),
    OPENAI_CACHE_PATH: join(directory, "openai-cache.json"),
    LINK_PREVIEW_CACHE_PATH: join(directory, "link-preview-cache.json"),
    X_RAW_SNAPSHOT_PATH: join(directory, "x-snapshots.json"),
    SERVER_STATE_LOCK_PATH: join(directory, "server-state.lock"),
  };
}

export function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "EPERM") {
      return true;
    }

    return false;
  }
}

export function findPortListeners(port) {
  try {
    const output = execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    const lines = output.split(/\r?\n/).slice(1);

    return lines
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        return {
          command: parts[0],
          pid: Number(parts[1]),
          raw: line,
        };
      })
      .filter((item) => Number.isInteger(item.pid) && item.pid > 0);
  } catch {
    return [];
  }
}

export function processCommand(pid) {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "command="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return undefined;
  }
}

export function processWorkingDirectory(pid) {
  try {
    const output = execFileSync("lsof", ["-a", "-p", String(pid), "-d", "cwd", "-Fn"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const pathLine = output.split(/\r?\n/).find((line) => line.startsWith("n"));
    if (pathLine) {
      return pathLine.slice(1);
    }
  } catch {
    try {
      return readlinkSync(`/proc/${pid}/cwd`);
    } catch {
      return undefined;
    }
  }

  return undefined;
}

export function isProjectServerProcessShape(record, options = {}) {
  if (!record?.pid || !isProcessAlive(record.pid)) {
    return false;
  }

  const expectedCwd = resolve(options.cwd ?? record.cwd ?? process.cwd());
  const command = processCommand(record.pid);
  const workingDirectory = processWorkingDirectory(record.pid);

  return Boolean(
    command?.includes("src/server/index.ts") &&
    workingDirectory &&
    resolve(workingDirectory) === expectedCwd,
  );
}

export function isProjectServerProcess(record, options = {}) {
  if (!isProjectServerProcessShape(record, options)) {
    return false;
  }

  const expectedPort = Number(options.port ?? record.port ?? getPort());
  return findPortListeners(expectedPort).some((listener) => listener.pid === record.pid);
}

export function checkPort(host, port) {
  return new Promise((resolve) => {
    const server = net.createServer();

    server.once("error", (error) => {
      resolve({
        available: false,
        code: error.code || "UNKNOWN",
      });
    });

    server.once("listening", () => {
      server.close(() => {
        resolve({
          available: true,
        });
      });
    });

    server.listen(port, host);
  });
}

export function findAvailablePort(host = DEFAULT_HOST) {
  return new Promise((resolvePort, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.once("listening", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : undefined;
      server.close((error) => {
        if (error) {
          reject(error);
        } else if (port) {
          resolvePort(port);
        } else {
          reject(new Error("Could not allocate a temporary local port."));
        }
      });
    });
    server.listen(0, host);
  });
}

export function spawnServer({ host, port, stdio = "inherit", extraEnv = {}, instanceId } = {}) {
  const env = {
    ...process.env,
    HOST: host || getHost(),
    PORT: String(port || getPort()),
    ...(instanceId ? { SERVER_INSTANCE_ID: instanceId } : {}),
    ...extraEnv,
  };

  return spawn(process.execPath, ["--experimental-strip-types", "src/server/index.ts"], {
    env,
    stdio,
  });
}

export async function waitForHealth({ host, port, timeoutMs = 5000, expectedInstanceId } = {}) {
  const deadline = Date.now() + timeoutMs;
  const url = `http://${host}:${port}/api/health`;

  while (Date.now() < deadline) {
    try {
      const remainingMs = Math.max(1, deadline - Date.now());
      const response = await fetch(url, { signal: AbortSignal.timeout(Math.min(1000, remainingMs)) });
      if (response.ok) {
        const health = await response.json();
        if (
          health?.service === "xpulse-rousseau" &&
          (!expectedInstanceId || health.instanceId === expectedInstanceId)
        ) {
          return health;
        }
      }
    } catch {
      // The server may still be starting; retry until the shared deadline.
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }

  throw new Error(`Server did not become healthy at ${url}`);
}
