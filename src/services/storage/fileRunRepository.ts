import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RefreshRun, TimelineSource } from "../../domain/tweet.ts";

const MAX_STORED_RUNS = 20;

export type RunRepository = {
  save(run: RefreshRun): Promise<void>;
  latest(): Promise<RefreshRun | undefined>;
  latestBySource(source: TimelineSource): Promise<RefreshRun | undefined>;
  find(runId: string): Promise<RefreshRun | undefined>;
  update(run: RefreshRun): Promise<void>;
};

type RunStore = {
  runs: RefreshRun[];
};

export class FileRunRepository implements RunRepository {
  private readonly filePath: string;

  constructor(filePath = ".data/runs.json") {
    this.filePath = filePath;
  }

  async save(run: RefreshRun): Promise<void> {
    const store = await this.readStore();
    store.runs = this.pruneRuns([run, ...store.runs]);
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(store, null, 2), "utf8");
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
    const store = await this.readStore();
    const index = store.runs.findIndex((item) => item.id === run.id);

    if (index === -1) {
      store.runs = this.pruneRuns([run, ...store.runs]);
    } else {
      store.runs[index] = run;
      store.runs = this.pruneRuns(store.runs);
    }

    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(store, null, 2), "utf8");
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

  private async readStore(): Promise<RunStore> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw) as RunStore;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return { runs: [] };
      }

      throw error;
    }
  }
}
