import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer as createHttpServer, request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createServerInstanceId,
  findAvailablePort,
  getHost,
  isolatedServerStateEnv,
  spawnServer,
  waitForHealth,
} from "./env-utils.mjs";

const host = getHost();
const port = await findAvailablePort(host);
const instanceId = createServerInstanceId();
const temporaryDirectory = mkdtempSync(join(tmpdir(), "xpulse-server-entry-"));
const child = spawnServer({
  host,
  port,
  instanceId,
  stdio: ["ignore", "pipe", "pipe"],
  extraEnv: {
    ...isolatedServerStateEnv(temporaryDirectory),
    TIMELINE_SOURCE: "replay",
    OPENAI_API_KEY: "",
    X_USER_ID: "",
    X_USER_ACCESS_TOKEN: "",
    X_CLIENT_ID: "",
    X_CLIENT_SECRET: "",
  },
});
let output = "";
child.stdout.on("data", (chunk) => {
  output += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  output += chunk.toString();
});
const childExit = new Promise((resolve) => {
  child.once("exit", (code, signal) => resolve({ code, signal }));
});
let sentinelHits = 0;
let sentinelListening = false;
const privateNetworkSentinel = createHttpServer((_request, response) => {
  sentinelHits += 1;
  response.writeHead(200, { "Content-Type": "image/png" });
  response.end(Buffer.from([1, 2, 3]));
});

function requestServer({ method = "GET", path = "/", headers = {}, body = "" } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      host,
      port,
      method,
      path,
      headers: {
        Host: `${host}:${port}`,
        ...headers,
      },
      signal: AbortSignal.timeout(5_000),
    }, (response) => {
      let text = "";
      response.setEncoding("utf8");
      response.on("data", (chunk) => {
        text += chunk;
      });
      response.on("end", () => resolve({ status: response.statusCode, text }));
    });

    request.once("error", reject);
    request.end(body);
  });
}

function expectStatus(label, response, expectedStatus) {
  if (response.status !== expectedStatus) {
    throw new Error(`${label} expected HTTP ${expectedStatus}, found ${response.status}: ${response.text}`);
  }
}

let failed = false;

function reportFailure(error) {
  if (!failed && output.trim()) {
    console.error(output.trim());
  }
  failed = true;
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

try {
  const health = await Promise.race([
    waitForHealth({ host, port, timeoutMs: 7_500, expectedInstanceId: instanceId }),
    childExit.then((exit) => {
      throw new Error(`Server entry exited early (code ${exit.code ?? "null"}, signal ${exit.signal ?? "null"}).`);
    }),
  ]);

  if (health.source !== "replay") {
    throw new Error(`Expected isolated server entry to report replay source, found ${health.source}.`);
  }

  await new Promise((resolve, reject) => {
    privateNetworkSentinel.once("error", reject);
    privateNetworkSentinel.listen(0, host, () => {
      privateNetworkSentinel.removeListener("error", reject);
      sentinelListening = true;
      resolve();
    });
  });
  const sentinelAddress = privateNetworkSentinel.address();
  if (!sentinelAddress || typeof sentinelAddress === "string") {
    throw new Error("Could not determine the private-network SSRF sentinel port.");
  }

  expectStatus(
    "Untrusted Host boundary",
    await requestServer({ path: "/api/health", headers: { Host: "attacker.invalid" } }),
    403,
  );
  expectStatus(
    "Cross-site mutation boundary",
    await requestServer({
      method: "POST",
      path: "/api/runs/jobs",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://attacker.invalid",
        "Sec-Fetch-Site": "cross-site",
      },
      body: "{}",
    }),
    403,
  );
  expectStatus(
    "Pulse content-type boundary",
    await requestServer({ method: "POST", path: "/api/runs/jobs", headers: { "Content-Type": "text/plain" }, body: "{}" }),
    415,
  );
  expectStatus(
    "Pulse request-size boundary",
    await requestServer({
      method: "POST",
      path: "/api/runs/jobs",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ padding: "x".repeat(17 * 1024) }),
    }),
    413,
  );
  expectStatus(
    "Link-preview image SSRF boundary",
    await requestServer({
      path: `/api/link-preview/image?url=${encodeURIComponent(`http://127.0.0.1:${sentinelAddress.port}/private.png`)}`,
    }),
    502,
  );
  if (sentinelHits !== 0) {
    throw new Error(`Link-preview image proxy reached the private-network sentinel ${sentinelHits} time(s).`);
  }
  expectStatus(
    "Cross-site link-preview proxy boundary",
    await requestServer({
      path: "/api/link-preview/image?url=https%3A%2F%2Fpublic.example%2Fcard.png",
      headers: { "Sec-Fetch-Site": "cross-site" },
    }),
    403,
  );
  expectStatus(
    "Cross-site media proxy boundary",
    await requestServer({
      path: "/api/media/proxy?url=https%3A%2F%2Fvideo.twimg.com%2Fmovie.mp4",
      headers: { "Sec-Fetch-Site": "cross-site" },
    }),
    403,
  );

  console.log(`OK server entry smoke: verified isolated instance and HTTP safety boundaries at http://${host}:${port}.`);
} catch (error) {
  reportFailure(error);
} finally {
  if (sentinelListening) {
    await new Promise((resolve) => privateNetworkSentinel.close(() => resolve()));
  }

  child.kill("SIGTERM");
  const gracefulExit = await Promise.race([
    childExit.then((exit) => ({ exit })),
    new Promise((resolve) => setTimeout(() => resolve({ timeout: true }), 5_000)),
  ]);

  if ("timeout" in gracefulExit) {
    child.kill("SIGKILL");
    await childExit;
    reportFailure(new Error("Server entry did not complete graceful SIGTERM shutdown within 5 seconds."));
  } else if (gracefulExit.exit.code !== 0 || gracefulExit.exit.signal) {
    reportFailure(new Error(`Server entry shutdown was not clean (code ${gracefulExit.exit.code ?? "null"}, signal ${gracefulExit.exit.signal ?? "null"}).`));
  }

  const lockPath = join(temporaryDirectory, "server-state.lock");
  if (existsSync(lockPath)) {
    reportFailure(new Error("Server entry left server-state.lock behind after graceful shutdown."));
  }

  rmSync(temporaryDirectory, { recursive: true, force: true });
}
