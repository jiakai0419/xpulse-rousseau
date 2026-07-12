import { randomUUID } from "node:crypto";
import { chmod, lstat, mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const PRIVATE_DIRECTORY_MODE = 0o700;
const PRIVATE_FILE_MODE = 0o600;

const writeQueues = new Map<string, Promise<void>>();

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

export async function ensurePrivateStateDirectory(filePath: string): Promise<void> {
  const directory = dirname(filePath);
  let existed = true;

  try {
    const existing = await lstat(directory);

    if (!existing.isDirectory() || existing.isSymbolicLink()) {
      throw new Error(`Configured state directory ${directory} must be a real directory, not a file or symbolic link.`);
    }
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }

    existed = false;
    await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE });
  }

  const current = await lstat(directory);

  if (!current.isDirectory() || current.isSymbolicLink()) {
    throw new Error(`Configured state directory ${directory} must be a real directory, not a file or symbolic link.`);
  }

  if (!existed || basename(directory) === ".data") {
    await chmod(directory, PRIVATE_DIRECTORY_MODE);
    return;
  }

  if ((current.mode & 0o077) !== 0) {
    throw new Error(
      `Configured state directory ${directory} must already be owner-only (0700); refusing to change permissions on an existing shared directory.`,
    );
  }
}

async function repairPrivateFileMode(filePath: string): Promise<void> {
  try {
    await chmod(filePath, PRIVATE_FILE_MODE);
  } catch (error) {
    if (!isMissingFile(error)) {
      throw error;
    }
  }
}

async function syncDirectory(directory: string): Promise<void> {
  const directoryHandle = await open(directory, "r");

  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
}

async function readPrivateJsonFileUnlocked<T>(filePath: string, fallback: () => T): Promise<T> {
  await ensurePrivateStateDirectory(filePath);
  await repairPrivateFileMode(filePath);

  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch (error) {
    if (isMissingFile(error)) {
      return fallback();
    }

    throw error;
  }
}

async function writePrivateJsonFileUnlocked(filePath: string, value: unknown): Promise<void> {
  const serialized = JSON.stringify(value, null, 2);

  if (serialized === undefined) {
    throw new TypeError("Private JSON storage cannot persist an undefined value");
  }

  await ensurePrivateStateDirectory(filePath);

  const directory = dirname(filePath);
  const temporaryPath = join(directory, `.${basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  let temporaryFile: Awaited<ReturnType<typeof open>> | undefined;

  try {
    temporaryFile = await open(temporaryPath, "wx", PRIVATE_FILE_MODE);
    await temporaryFile.writeFile(serialized, "utf8");
    await temporaryFile.sync();
    await temporaryFile.close();
    temporaryFile = undefined;

    await rename(temporaryPath, filePath);
    await chmod(filePath, PRIVATE_FILE_MODE);

    await syncDirectory(directory);
  } catch (error) {
    await temporaryFile?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function serializeFileMutation<T>(filePath: string, operation: () => Promise<T>): Promise<T> {
  const key = resolve(filePath);
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const result = previous.then(operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );

  writeQueues.set(key, tail);

  try {
    return await result;
  } finally {
    if (writeQueues.get(key) === tail) {
      writeQueues.delete(key);
    }
  }
}

export async function readPrivateJsonFile<T>(filePath: string, fallback: () => T): Promise<T> {
  return readPrivateJsonFileUnlocked(filePath, fallback);
}

export async function writePrivateJsonFile(filePath: string, value: unknown): Promise<void> {
  await serializeFileMutation(filePath, () => writePrivateJsonFileUnlocked(filePath, value));
}

export async function updatePrivateJsonFile<T>(
  filePath: string,
  fallback: () => T,
  update: (current: T) => T | Promise<T>,
): Promise<T> {
  return serializeFileMutation(filePath, async () => {
    const current = await readPrivateJsonFileUnlocked(filePath, fallback);
    const next = await update(current);
    await writePrivateJsonFileUnlocked(filePath, next);
    return next;
  });
}

export async function removePrivateJsonFile(filePath: string): Promise<void> {
  await serializeFileMutation(filePath, async () => {
    await ensurePrivateStateDirectory(filePath);
    await rm(filePath, { force: true });
    await syncDirectory(dirname(filePath));
  });
}
