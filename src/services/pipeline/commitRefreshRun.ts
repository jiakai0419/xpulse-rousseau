import type { RefreshRun } from "../../domain/tweet.ts";
import type { SeenPostRepository } from "../seen/seenLedger.ts";
import type { RunRepository } from "../storage/fileRunRepository.ts";
import type { TimelineCursorRepository } from "../x/timelineCursor.ts";

export type RefreshRunCommitter = {
  repository: Pick<RunRepository, "save">;
  seenRepository: Pick<SeenPostRepository, "markRunShown">;
  timelineCursor: Pick<TimelineCursorRepository, "updateFromRun">;
};

export async function commitRefreshRun(run: RefreshRun, committer: RefreshRunCommitter): Promise<void> {
  await committer.repository.save(run);

  if (run.source !== "x") {
    return;
  }

  await committer.seenRepository.markRunShown(run);
  await committer.timelineCursor.updateFromRun(run);
}
