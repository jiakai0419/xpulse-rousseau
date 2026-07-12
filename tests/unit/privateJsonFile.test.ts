import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  readPrivateJsonFile,
  removePrivateJsonFile,
  updatePrivateJsonFile,
  writePrivateJsonFile,
} from "../../src/services/storage/privateJsonFile.ts";

function permissionBits(mode: number): number {
  return mode & 0o777;
}

test("private JSON storage repairs the app-owned .data directory and file permissions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xpulse-private-json-"));
  const stateDirectory = join(dir, ".data");
  const filePath = join(stateDirectory, "state.json");

  try {
    await mkdir(stateDirectory, { mode: 0o755 });
    await chmod(stateDirectory, 0o755);
    await writeFile(filePath, JSON.stringify({ value: 1 }), { mode: 0o644 });
    await chmod(filePath, 0o644);

    const state = await readPrivateJsonFile(filePath, () => ({ value: 0 }));

    assert.deepEqual(state, { value: 1 });
    assert.equal(permissionBits((await stat(stateDirectory)).mode), 0o700);
    assert.equal(permissionBits((await stat(filePath)).mode), 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("private JSON storage refuses to chmod an existing shared custom directory", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xpulse-shared-parent-"));
  const filePath = join(directory, "state.json");

  try {
    await chmod(directory, 0o755);
    await assert.rejects(
      readPrivateJsonFile(filePath, () => ({ missing: true })),
      /refusing to change permissions on an existing shared directory/,
    );
    assert.equal(permissionBits((await stat(directory)).mode), 0o755);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("private JSON removal durably clears the file without leaving temporary state", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xpulse-private-json-"));
  const filePath = join(dir, "state.json");

  try {
    await writePrivateJsonFile(filePath, { pending: true });
    await removePrivateJsonFile(filePath);

    assert.deepEqual(await readdir(dir), []);
    assert.deepEqual(await readPrivateJsonFile(filePath, () => ({ missing: true })), { missing: true });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("private JSON storage atomically replaces files without leftover temporary files", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xpulse-private-json-"));
  const filePath = join(dir, "state.json");

  try {
    await writePrivateJsonFile(filePath, { version: 1 });
    await writePrivateJsonFile(filePath, { version: 2, values: [1, 2, 3] });

    assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), { version: 2, values: [1, 2, 3] });
    assert.deepEqual(await readdir(dir), ["state.json"]);
    assert.equal(permissionBits((await stat(filePath)).mode), 0o600);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("private JSON storage keeps the previous file when serialization fails", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xpulse-private-json-"));
  const filePath = join(dir, "state.json");

  try {
    await writePrivateJsonFile(filePath, { version: 1 });

    await assert.rejects(
      writePrivateJsonFile(filePath, { unsupported: 1n }),
      /BigInt/,
    );

    assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), { version: 1 });
    assert.deepEqual(await readdir(dir), ["state.json"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("private JSON updates serialize concurrent read-modify-write operations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xpulse-private-json-"));
  const filePath = join(dir, "state.json");

  try {
    await Promise.all(Array.from({ length: 50 }, (_, index) => updatePrivateJsonFile(
      filePath,
      () => ({ values: [] as number[] }),
      async (state) => {
        await Promise.resolve();
        return { values: [...state.values, index] };
      },
    )));

    const state = await readPrivateJsonFile(filePath, () => ({ values: [] as number[] }));

    assert.equal(state.values.length, 50);
    assert.equal(new Set(state.values).size, 50);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
