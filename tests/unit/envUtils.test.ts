import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  checkPort,
  findAvailablePort,
  isolatedServerStateEnv,
  pidRecordMatchesEndpoint,
  readPidRecord,
  writePidFile,
} from "../../scripts/env-utils.mjs";

test("pid records are private and retain server identity metadata", () => {
  const directory = mkdtempSync(join(tmpdir(), "xpulse-pid-"));
  const filePath = join(directory, "private", "server.pid");
  const record = {
    pid: 12345,
    host: "127.0.0.1",
    port: 3000,
    cwd: "/tmp/project",
    instanceId: "instance-1",
  };

  try {
    writePidFile(record, filePath);

    assert.deepEqual(readPidRecord(filePath), record);
    assert.equal(statSync(filePath).mode & 0o777, 0o600);
    assert.equal(statSync(join(directory, "private")).mode & 0o777, 0o700);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("legacy numeric pid records remain readable for safe migration", () => {
  const directory = mkdtempSync(join(tmpdir(), "xpulse-pid-"));
  const filePath = join(directory, "server.pid");

  try {
    writeFileSync(filePath, "4321\n", "utf8");
    assert.deepEqual(readPidRecord(filePath), { pid: 4321, legacy: true });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a managed pid record is not mistaken for the same server on another port", () => {
  const record = { pid: 42, host: "127.0.0.1", port: 3000 };

  assert.equal(pidRecordMatchesEndpoint(record, "127.0.0.1", 3000), true);
  assert.equal(pidRecordMatchesEndpoint(record, "127.0.0.1", 3001), false);
  assert.equal(pidRecordMatchesEndpoint(record, "0.0.0.0", 3000), false);
});

test("isolated server state keeps every mutable repository in one temporary root", () => {
  const env = isolatedServerStateEnv("/tmp/xpulse-isolated", { runStorePath: "/tmp/xpulse-isolated/custom-runs.json" });

  assert.equal(env.RUN_STORE_PATH, "/tmp/xpulse-isolated/custom-runs.json");
  for (const [key, path] of Object.entries(env)) {
    assert.equal(path.startsWith("/tmp/xpulse-isolated/"), true, `${key} escaped the isolated root`);
  }
});

test("findAvailablePort returns a currently bindable local port", async (context) => {
  let port: number;
  try {
    port = await findAvailablePort("127.0.0.1") as number;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "EPERM") {
      context.skip("The sandbox does not permit local port binding.");
      return;
    }
    throw error;
  }

  const status = await checkPort("127.0.0.1", port);

  assert.equal(status.available, true);
});
