import type { RefreshRun } from "../../domain/tweet.ts";
import type { SeenPostRepository, SeenPostRepositoryCheckpoint } from "../seen/seenLedger.ts";
import type { RunRepository, RunRepositoryCheckpoint } from "../storage/fileRunRepository.ts";
import type { TimelineCursor, TimelineCursorRepository } from "../x/timelineCursor.ts";
import type { RefreshCommitJournal, RefreshCommitJournalRecord } from "./refreshCommitJournal.ts";

type CheckpointRepository<T> = {
  checkpoint(): Promise<T>;
  restore(checkpoint: T): Promise<void>;
};

export type RefreshRunCommitter = {
  repository: Pick<RunRepository, "save"> & CheckpointRepository<RunRepositoryCheckpoint>;
  seenRepository: Pick<SeenPostRepository, "markRunShown"> & CheckpointRepository<SeenPostRepositoryCheckpoint>;
  timelineCursor: Pick<TimelineCursorRepository, "updateFromRun"> & CheckpointRepository<TimelineCursor>;
  journal: RefreshCommitJournal;
};

type RefreshCommitRecovery = Pick<RefreshRunCommitter, "repository" | "seenRepository" | "timelineCursor" | "journal">;

async function restoreCheckpoints(
  checkpoints: RefreshCommitJournalRecord["checkpoints"],
  committer: RefreshCommitRecovery,
): Promise<Error[]> {
  const rollbackErrors: Error[] = [];
  const states = [
    {
      label: "Timeline Cursor",
      restore: () => committer.timelineCursor.restore(checkpoints.cursor),
    },
    {
      label: "Seen Ledger",
      restore: () => committer.seenRepository.restore(checkpoints.seen),
    },
    {
      label: "Run Store",
      restore: () => committer.repository.restore(checkpoints.run),
    },
  ];

  for (const state of states) {
    try {
      await state.restore();
    } catch (rollbackError) {
      rollbackErrors.push(new Error(`Failed to restore ${state.label}.`, { cause: rollbackError }));
    }
  }

  return rollbackErrors;
}

export async function recoverPendingRefreshCommit(committer: RefreshCommitRecovery): Promise<boolean> {
  const pending = await committer.journal.read();

  if (!pending) {
    return false;
  }

  const rollbackErrors = await restoreCheckpoints(pending.checkpoints, committer);

  if (rollbackErrors.length) {
    throw new AggregateError(
      rollbackErrors,
      `Could not recover unfinished Online Pulse commit ${pending.runId}; its journal was retained for retry.`,
    );
  }

  try {
    await committer.journal.clear();
  } catch (clearError) {
    throw new Error(
      `Recovered unfinished Online Pulse commit ${pending.runId}, but its journal could not be cleared; startup must retry.`,
      { cause: clearError },
    );
  }

  return true;
}

export async function commitRefreshRun(run: RefreshRun, committer: RefreshRunCommitter): Promise<void> {
  const unfinishedCommit = await committer.journal.read();

  if (unfinishedCommit) {
    throw new Error(
      `Unfinished Online Pulse commit ${unfinishedCommit.runId} must be recovered before another run can be saved.`,
    );
  }

  if (run.source !== "x") {
    await committer.repository.save(run);
    return;
  }

  const [runCheckpoint, seenCheckpoint, cursorCheckpoint] = await Promise.all([
    committer.repository.checkpoint(),
    committer.seenRepository.checkpoint(),
    committer.timelineCursor.checkpoint(),
  ]);
  const journalRecord: RefreshCommitJournalRecord = {
    version: "refresh-commit-v1",
    runId: run.id,
    createdAt: new Date().toISOString(),
    checkpoints: {
      run: runCheckpoint,
      seen: seenCheckpoint,
      cursor: cursorCheckpoint,
    },
  };

  await committer.journal.write(journalRecord);

  try {
    await committer.repository.save(run);
    await committer.seenRepository.markRunShown(run);
    await committer.timelineCursor.updateFromRun(run);
    await committer.journal.clear();
  } catch (commitError) {
    const rollbackErrors = await restoreCheckpoints(journalRecord.checkpoints, committer);

    if (rollbackErrors.length) {
      throw new AggregateError(
        [commitError, ...rollbackErrors],
        "Online Pulse commit failed and its previous state could not be fully restored; the recovery journal was retained.",
      );
    }

    try {
      await committer.journal.clear();
    } catch (clearError) {
      throw new AggregateError(
        [commitError, clearError],
        "Online Pulse commit failed and was restored, but its recovery journal could not be cleared; startup recovery must retry.",
      );
    }

    throw commitError;
  }
}
