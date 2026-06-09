import type { RefreshProgress, RefreshRun, TimelineSource } from "../domain/tweet.ts";
import { createRefreshUsageReceipt, refreshReceiptUsage } from "../services/usage/receipts.ts";

export type RefreshJob = {
  id: string;
  source: TimelineSource;
  status: "running" | "completed" | "failed";
  createdAt: string;
  progress: RefreshProgress;
  run?: RefreshRun;
  error?: string;
};

export type RefreshJobRunner = (options: {
  source: TimelineSource;
  onProgress: (progress: RefreshProgress) => void;
}) => Promise<RefreshRun>;

export type RefreshJobCommitter = (run: RefreshRun) => Promise<void>;

export type StartRefreshJobOptions = {
  run: RefreshJobRunner;
  commit: RefreshJobCommitter;
};

export type RefreshJobStoreOptions = {
  now?: () => Date;
  createJobId?: () => string;
};

export function createProgress(progress: Partial<RefreshProgress> = {}): RefreshProgress {
  return {
    stage: progress.stage ?? "starting",
    label: progress.label ?? "Preparing Pulse",
    detail: progress.detail ?? "Waiting for the server to start",
    processedItems: progress.processedItems,
    totalItems: progress.totalItems,
    model: progress.model,
    usage: progress.usage ?? [],
    updatedAt: new Date().toISOString(),
  };
}

export function decorateRunUsage(run: RefreshRun): RefreshRun {
  const sourceUsage = run.usage;
  const refreshLines = refreshReceiptUsage(sourceUsage);
  const { trace: _trace, ...readerRun } = run;

  return {
    ...readerRun,
    usage: refreshLines,
    usageReceipt: createRefreshUsageReceipt({
      runId: run.id,
      createdAt: run.createdAt,
      records: sourceUsage,
    }),
  };
}

export function responseJob(job: RefreshJob): RefreshJob {
  return job.run ? { ...job, run: decorateRunUsage(job.run) } : job;
}

export class RefreshJobStore {
  private readonly jobs = new Map<string, RefreshJob>();
  private readonly now: () => Date;
  private readonly createJobId: () => string;

  constructor(options: RefreshJobStoreOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.createJobId = options.createJobId ?? (() => `job_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
  }

  get(jobId: string): RefreshJob | undefined {
    return this.jobs.get(jobId);
  }

  latest(): RefreshJob | undefined {
    return Array.from(this.jobs.values()).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  }

  running(): RefreshJob | undefined {
    return Array.from(this.jobs.values()).find((job) => job.status === "running");
  }

  start(source: TimelineSource, options: StartRefreshJobOptions): RefreshJob {
    const runningJob = this.running();

    if (runningJob) {
      return runningJob;
    }

    const job: RefreshJob = {
      id: this.createJobId(),
      source,
      status: "running",
      createdAt: this.now().toISOString(),
      progress: createProgress(),
    };
    this.jobs.set(job.id, job);
    void this.execute(job, options);

    return job;
  }

  private async execute(job: RefreshJob, options: StartRefreshJobOptions): Promise<void> {
    try {
      const run = await options.run({
        source: job.source,
        onProgress: (progress) => {
          job.progress = progress;
        },
      });

      await options.commit(run);
      job.status = "completed";
      job.run = run;
      job.progress = createProgress({
        stage: "completed",
        label: job.source === "replay" ? "Replay complete" : "Pulse complete",
        detail: job.source === "replay" ? `Replayed ${run.stats.selected} posts from a saved X run` : `Selected ${run.stats.selected} posts and recorded usage`,
        processedItems: run.stats.selected,
        totalItems: run.stats.selected,
        usage: refreshReceiptUsage(run.usage),
      });
    } catch (error) {
      job.status = "failed";
      job.error = error instanceof Error ? error.message : "Unknown refresh error.";
      job.progress = createProgress({
        stage: "failed",
        label: "Pulse failed",
        detail: job.error,
        usage: job.progress.usage,
      });
    }
  }
}
