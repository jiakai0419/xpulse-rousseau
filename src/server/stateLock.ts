import { randomUUID } from "node:crypto";
import { link, open, readFile, rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ensurePrivateStateDirectory } from "../services/storage/privateJsonFile.ts";

const PRIVATE_FILE_MODE = 0o600;

export type ServerStateLockRecord = {
  version: "server-state-lock-v1";
  pid: number;
  instanceId: string;
  token: string;
  acquiredAt: string;
};

export type ServerStateLock = {
  record: ServerStateLockRecord;
  release(): Promise<void>;
};

export type AcquireServerStateLockOptions = {
  pid?: number;
  instanceId?: string;
  now?: () => Date;
  createToken?: () => string;
  isProcessAlive?: (pid: number) => boolean;
};

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}

function isAlreadyExists(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "EEXIST");
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && "code" in error && error.code !== "ESRCH");
  }
}

function validRecord(value: unknown): value is ServerStateLockRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<ServerStateLockRecord>;
  return record.version === "server-state-lock-v1"
    && Number.isInteger(record.pid)
    && Number(record.pid) > 0
    && typeof record.instanceId === "string"
    && typeof record.token === "string"
    && Boolean(record.token)
    && typeof record.acquiredAt === "string";
}

async function syncDirectory(filePath: string): Promise<void> {
  const directoryHandle = await open(dirname(filePath), "r");

  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
}

async function readRecord(filePath: string): Promise<ServerStateLockRecord | undefined> {
  try {
    const raw = await readFile(filePath, "utf8");
    let parsed: unknown;

    try {
      parsed = JSON.parse(raw) as unknown;
    } catch (error) {
      throw new Error(`Server state lock ${filePath} is invalid; refusing unsafe reclamation.`, { cause: error });
    }

    if (!validRecord(parsed)) {
      throw new Error(`Server state lock ${filePath} is invalid; refusing unsafe reclamation.`);
    }

    return parsed;
  } catch (error) {
    if (isMissing(error)) {
      return undefined;
    }

    throw error;
  }
}

async function createExclusiveRecord(filePath: string, record: ServerStateLockRecord): Promise<boolean> {
  const temporaryPath = join(
    dirname(filePath),
    `.${basename(filePath)}.${record.pid}.${randomUUID()}.tmp`,
  );
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  let linked = false;

  try {
    handle = await open(temporaryPath, "wx", PRIVATE_FILE_MODE);
    await handle.writeFile(JSON.stringify(record, null, 2), "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await link(temporaryPath, filePath);
    linked = true;
    await rm(temporaryPath, { force: true });
    await syncDirectory(filePath);
    return true;
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await rm(temporaryPath, { force: true }).catch(() => undefined);

    if (isAlreadyExists(error)) {
      return false;
    }

    if (linked) {
      await rm(filePath, { force: true }).catch(() => undefined);
      await syncDirectory(filePath).catch(() => undefined);
    }

    throw error;
  }
}

async function removeIfOwned(filePath: string, token: string): Promise<boolean> {
  const current = await readRecord(filePath);

  if (!current || current.token !== token) {
    return false;
  }

  await rm(filePath, { force: true });
  await syncDirectory(filePath);
  return true;
}

export async function acquireServerStateLock(
  filePath = ".data/server-state.lock",
  options: AcquireServerStateLockOptions = {},
): Promise<ServerStateLock> {
  await ensurePrivateStateDirectory(filePath);
  const pid = options.pid ?? process.pid;
  const instanceId = options.instanceId ?? `server_${pid}`;
  const currentTime = options.now ?? (() => new Date());
  const createToken = options.createToken ?? randomUUID;
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const reclaimPath = `${filePath}.reclaim`;

  for (let attempt = 0; attempt < 200; attempt += 1) {
    const reclaimOwner = await readRecord(reclaimPath);

    if (reclaimOwner) {
      if (isProcessAlive(reclaimOwner.pid)) {
        await delay(5);
        continue;
      }

      await removeIfOwned(reclaimPath, reclaimOwner.token);
      continue;
    }

    const record: ServerStateLockRecord = {
      version: "server-state-lock-v1",
      pid,
      instanceId,
      token: createToken(),
      acquiredAt: currentTime().toISOString(),
    };

    if (await createExclusiveRecord(filePath, record)) {
      return {
        record,
        release: async () => {
          await removeIfOwned(filePath, record.token);
        },
      };
    }

    const owner = await readRecord(filePath);

    if (!owner) {
      continue;
    }

    if (isProcessAlive(owner.pid)) {
      throw new Error(
        `Server state is already locked by live process ${owner.pid} (${owner.instanceId}).`,
      );
    }

    const reclaimRecord: ServerStateLockRecord = {
      version: "server-state-lock-v1",
      pid,
      instanceId,
      token: createToken(),
      acquiredAt: currentTime().toISOString(),
    };

    if (!await createExclusiveRecord(reclaimPath, reclaimRecord)) {
      continue;
    }

    try {
      const latestOwner = await readRecord(filePath);

      if (latestOwner && isProcessAlive(latestOwner.pid)) {
        throw new Error(
          `Server state is already locked by live process ${latestOwner.pid} (${latestOwner.instanceId}).`,
        );
      }

      if (latestOwner) {
        await removeIfOwned(filePath, latestOwner.token);
      }
    } finally {
      await removeIfOwned(reclaimPath, reclaimRecord.token);
    }
  }

  throw new Error("Timed out acquiring the server state lock while stale-lock recovery was in progress.");
}
