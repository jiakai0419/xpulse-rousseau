import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { execFileSync, spawn } from "node:child_process";
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

export function writePidFile(pid, filePath = PID_FILE) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${pid}\n`, "utf8");
}

export function readPidFile(filePath = PID_FILE) {
  if (!existsSync(filePath)) {
    return undefined;
  }

  const pid = Number(readFileSync(filePath, "utf8").trim());
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
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

export function spawnServer({ host, port, stdio = "inherit", extraEnv = {} } = {}) {
  const env = {
    ...process.env,
    HOST: host || getHost(),
    PORT: String(port || getPort()),
    ...extraEnv,
  };

  return spawn(process.execPath, ["--experimental-strip-types", "src/server/index.ts"], {
    env,
    stdio,
  });
}

export async function waitForHealth({ host, port, timeoutMs = 5000 }) {
  const deadline = Date.now() + timeoutMs;
  const url = `http://${host}:${port}/api/health`;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return await response.json();
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  throw new Error(`Server did not become healthy at ${url}`);
}
