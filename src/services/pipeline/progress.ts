import type { RefreshProgress, UsageRecord } from "../../domain/tweet.ts";

export type RefreshProgressReporterOptions = {
  onProgress?: (progress: RefreshProgress) => void;
  onUsage?: (usage: UsageRecord) => void;
  now?: () => Date;
};

export type RefreshProgressReporter = {
  usageRecords(): UsageRecord[];
  publishProgress(progress: Partial<RefreshProgress>): void;
  recordUsage(usage: UsageRecord): void;
};

function usageProgressStage(usage: UsageRecord): RefreshProgress["stage"] {
  if (usage.operation === "scoring") {
    return "scoring";
  }

  if (usage.operation === "translation") {
    return "translating";
  }

  if (usage.provider === "x") {
    return "loading";
  }

  return "saving";
}

function usageProgressDetail(usage: UsageRecord): string {
  if (usage.provider === "openai") {
    return `${usage.model}: input ${usage.inputTokens}, output ${usage.outputTokens}, total ${usage.totalTokens}`;
  }

  const failed = usage.failedRequestCount ? ` · ${usage.failedRequestCount} failed` : "";
  return `${usage.method ?? "GET"} ${usage.endpoint ?? "X API"} · ${usage.itemCount} items · ${usage.requestCount ?? 1} requests${failed}`;
}

export function createRefreshProgressReporter(options: RefreshProgressReporterOptions = {}): RefreshProgressReporter {
  const usageRecords: UsageRecord[] = [];
  const currentTime = options.now ?? (() => new Date());

  const publishProgress = (progress: Partial<RefreshProgress>): void => {
    options.onProgress?.({
      stage: progress.stage ?? "starting",
      label: progress.label ?? "Preparing Pulse",
      detail: progress.detail ?? "Preparing to start",
      processedItems: progress.processedItems,
      totalItems: progress.totalItems,
      model: progress.model,
      usage: [...usageRecords],
      updatedAt: currentTime().toISOString(),
    });
  };

  const recordUsage = (usage: UsageRecord): void => {
    usageRecords.push(usage);
    options.onUsage?.(usage);
    publishProgress({
      stage: usageProgressStage(usage),
      label: usage.label,
      detail: usageProgressDetail(usage),
      model: usage.model,
    });
  };

  return {
    usageRecords: () => usageRecords,
    publishProgress,
    recordUsage,
  };
}
