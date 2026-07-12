import assert from "node:assert/strict";
import { chmod, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { acquireServerStateLock, type ServerStateLockRecord } from "../../src/server/stateLock.ts";

function permissionBits(mode: number): number {
  return mode & 0o777;
}

test("server state lock is private and rejects a second live owner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xpulse-state-lock-"));
  const lockPath = join(directory, "server-state.lock");
  const lock = await acquireServerStateLock(lockPath, {
    pid: process.pid,
    instanceId: "first-instance",
    createToken: () => "first-token",
  });

  try {
    assert.equal(permissionBits((await stat(directory)).mode), 0o700);
    assert.equal(permissionBits((await stat(lockPath)).mode), 0o600);
    assert.equal(JSON.parse(await readFile(lockPath, "utf8")).instanceId, "first-instance");

    await assert.rejects(
      () => acquireServerStateLock(lockPath, { pid: process.pid + 1, instanceId: "second-instance" }),
      /already locked by live process/,
    );
  } finally {
    await lock.release();
    assert.deepEqual(await readdir(directory), []);
    await rm(directory, { recursive: true, force: true });
  }
});

test("server state lock atomically reclaims a dead owner", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xpulse-state-lock-"));
  const lockPath = join(directory, "server-state.lock");
  const stale: ServerStateLockRecord = {
    version: "server-state-lock-v1",
    pid: 111,
    instanceId: "dead-instance",
    token: "dead-token",
    acquiredAt: "2026-06-07T00:00:00.000Z",
  };

  try {
    await writeFile(lockPath, JSON.stringify(stale), { mode: 0o600 });
    await chmod(lockPath, 0o600);
    const lock = await acquireServerStateLock(lockPath, {
      pid: 222,
      instanceId: "replacement-instance",
      createToken: () => "replacement-token",
      isProcessAlive: (pid) => pid === 222,
    });

    assert.equal(lock.record.pid, 222);
    assert.equal(JSON.parse(await readFile(lockPath, "utf8")).token, "replacement-token");
    assert.equal((await readdir(directory)).includes("server-state.lock.reclaim"), false);
    await lock.release();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("server state lock release never deletes a replacement owner's lock", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xpulse-state-lock-"));
  const lockPath = join(directory, "server-state.lock");
  const lock = await acquireServerStateLock(lockPath, {
    pid: 333,
    instanceId: "original-instance",
    createToken: () => "original-token",
    isProcessAlive: () => true,
  });
  const replacement: ServerStateLockRecord = {
    version: "server-state-lock-v1",
    pid: 444,
    instanceId: "replacement-instance",
    token: "replacement-token",
    acquiredAt: "2026-06-08T00:00:00.000Z",
  };

  try {
    await writeFile(lockPath, JSON.stringify(replacement), { mode: 0o600 });
    await lock.release();
    assert.equal(JSON.parse(await readFile(lockPath, "utf8")).token, replacement.token);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("server state lock preserves an invalid legacy lock instead of guessing that it is stale", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xpulse-state-lock-"));
  const lockPath = join(directory, "server-state.lock");

  try {
    await writeFile(lockPath, "{incomplete", { mode: 0o600 });
    await assert.rejects(
      () => acquireServerStateLock(lockPath, { pid: 555, isProcessAlive: () => false }),
      /invalid; refusing unsafe reclamation/,
    );
    assert.equal(await readFile(lockPath, "utf8"), "{incomplete");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("server state lock refuses to chmod an existing shared custom directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xpulse-shared-lock-parent-"));
  const lockPath = join(directory, "server-state.lock");

  try {
    await chmod(directory, 0o755);
    await assert.rejects(
      acquireServerStateLock(lockPath, { pid: 777, isProcessAlive: () => false }),
      /refusing to change permissions on an existing shared directory/,
    );
    assert.equal(permissionBits((await stat(directory)).mode), 0o755);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
