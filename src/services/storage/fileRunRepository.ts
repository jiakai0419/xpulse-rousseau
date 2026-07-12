import type { RefreshRun, TimelineSource } from "../../domain/tweet.ts";
import { readPrivateJsonFile, updatePrivateJsonFile, writePrivateJsonFile } from "./privateJsonFile.ts";

const MAX_STORED_RUNS = 20;

export type RunRepository = {
  save(run: RefreshRun): Promise<void>;
  latest(): Promise<RefreshRun | undefined>;
  latestBySource(source: TimelineSource): Promise<RefreshRun | undefined>;
  find(runId: string): Promise<RefreshRun | undefined>;
  update(run: RefreshRun): Promise<void>;
};

export type RunRepositoryCheckpoint = {
  runs: RefreshRun[];
};

export class FileRunRepository implements RunRepository {
  private readonly filePath: string;

  constructor(filePath = ".data/runs.json") {
    this.filePath = filePath;
  }

  async save(run: RefreshRun): Promise<void> {
    await updatePrivateJsonFile(this.filePath, () => ({ runs: [] }), (store: RunRepositoryCheckpoint) => ({
      runs: this.pruneRuns([run, ...store.runs]),
    }));
  }

  async latest(): Promise<RefreshRun | undefined> {
    const store = await this.readStore();
    return store.runs[0];
  }

  async latestBySource(source: TimelineSource): Promise<RefreshRun | undefined> {
    const store = await this.readStore();
    return store.runs.find((run) => run.source === source);
  }

  async find(runId: string): Promise<RefreshRun | undefined> {
    const store = await this.readStore();
    return store.runs.find((run) => run.id === runId);
  }

  async update(run: RefreshRun): Promise<void> {
    await updatePrivateJsonFile(this.filePath, () => ({ runs: [] }), (store: RunRepositoryCheckpoint) => {
      const runs = [...store.runs];
      const index = runs.findIndex((item) => item.id === run.id);

      if (index === -1) {
        return { runs: this.pruneRuns([run, ...runs]) };
      }

      runs[index] = run;
      return { runs: this.pruneRuns(runs) };
    });
  }

  async checkpoint(): Promise<RunRepositoryCheckpoint> {
    return this.readStore();
  }

  async restore(checkpoint: RunRepositoryCheckpoint): Promise<void> {
    await writePrivateJsonFile(this.filePath, checkpoint);
  }

  private pruneRuns(runs: RefreshRun[]): RefreshRun[] {
    const deduped: RefreshRun[] = [];
    const seen = new Set<string>();

    for (const run of runs) {
      if (seen.has(run.id)) {
        continue;
      }

      seen.add(run.id);
      deduped.push(run);
    }

    const latestLiveRun = deduped.find((run) => run.source === "x");
    const pruned = deduped.slice(0, MAX_STORED_RUNS);

    if (latestLiveRun && !pruned.some((run) => run.id === latestLiveRun.id)) {
      pruned[MAX_STORED_RUNS - 1] = latestLiveRun;
    }

    return pruned;
  }

  private async readStore(): Promise<RunRepositoryCheckpoint> {
    return readPrivateJsonFile(this.filePath, () => ({ runs: [] }));
  }
}
