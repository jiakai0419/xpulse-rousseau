import type { SeenPostRepositoryCheckpoint } from "../seen/seenLedger.ts";
import { readPrivateJsonFile, removePrivateJsonFile, updatePrivateJsonFile } from "../storage/privateJsonFile.ts";
import type { RunRepositoryCheckpoint } from "../storage/fileRunRepository.ts";
import type { TimelineCursor } from "../x/timelineCursor.ts";

export type RefreshCommitJournalRecord = {
  version: "refresh-commit-v1";
  runId: string;
  createdAt: string;
  checkpoints: {
    run: RunRepositoryCheckpoint;
    seen: SeenPostRepositoryCheckpoint;
    cursor: TimelineCursor;
  };
};

export type RefreshCommitJournal = {
  read(): Promise<RefreshCommitJournalRecord | undefined>;
  write(record: RefreshCommitJournalRecord): Promise<void>;
  clear(): Promise<void>;
};

function validJournalRecord(value: unknown): value is RefreshCommitJournalRecord {
  if (!value || typeof value !== "object") {
    return false;
  }

  const record = value as Partial<RefreshCommitJournalRecord>;
  const checkpoints = record.checkpoints as RefreshCommitJournalRecord["checkpoints"] | undefined;

  return record.version === "refresh-commit-v1"
    && typeof record.runId === "string"
    && typeof record.createdAt === "string"
    && Boolean(checkpoints)
    && Array.isArray(checkpoints?.run?.runs)
    && Array.isArray(checkpoints?.seen?.records)
    && Boolean(checkpoints?.cursor && typeof checkpoints.cursor === "object");
}

export class FileRefreshCommitJournal implements RefreshCommitJournal {
  private readonly filePath: string;

  constructor(filePath = ".data/refresh-commit-journal.json") {
    this.filePath = filePath;
  }

  async read(): Promise<RefreshCommitJournalRecord | undefined> {
    const record = await readPrivateJsonFile<unknown>(this.filePath, () => undefined);

    if (record === undefined) {
      return undefined;
    }

    if (!validJournalRecord(record)) {
      throw new Error("Online Pulse commit journal is invalid; refusing to mutate or start the server.");
    }

    return record;
  }

  async write(record: RefreshCommitJournalRecord): Promise<void> {
    await updatePrivateJsonFile<unknown>(this.filePath, () => undefined, (current) => {
      if (current !== undefined) {
        if (validJournalRecord(current)) {
          throw new Error(`Unfinished Online Pulse commit ${current.runId} must be recovered before the journal can be replaced.`);
        }

        throw new Error("Online Pulse commit journal is invalid; refusing to replace recovery evidence.");
      }

      return record;
    });
  }

  async clear(): Promise<void> {
    await removePrivateJsonFile(this.filePath);
  }
}
