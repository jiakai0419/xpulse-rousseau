import type { UsageReceipt, UsageReceiptScope, UsageRecord, UsageTotals } from "../../domain/tweet.ts";

export function refreshReceiptUsage(records: UsageRecord[] | undefined): UsageRecord[] {
  return records ?? [];
}

export function usageTotals(lines: UsageRecord[]): UsageTotals {
  return lines.reduce(
    (totals, line) => ({
      inputTokens: totals.inputTokens + (line.inputTokens ?? 0),
      outputTokens: totals.outputTokens + (line.outputTokens ?? 0),
      totalTokens: totals.totalTokens + (line.totalTokens ?? 0),
      cachedInputTokens: totals.cachedInputTokens + (line.cachedInputTokens ?? 0),
      reasoningTokens: totals.reasoningTokens + (line.reasoningTokens ?? 0),
      openAIRequests: totals.openAIRequests + (line.provider === "openai" ? line.requestCount ?? 1 : 0),
      xRequests: totals.xRequests + (line.provider === "x" ? line.requestCount ?? 1 : 0),
      itemCount: totals.itemCount + (line.itemCount ?? 0),
    }),
    {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      cachedInputTokens: 0,
      reasoningTokens: 0,
      openAIRequests: 0,
      xRequests: 0,
      itemCount: 0,
    },
  );
}

export function createUsageReceipt(options: {
  scope: UsageReceiptScope;
  title: string;
  createdAt: string;
  target?: UsageReceipt["target"];
  lines: UsageRecord[] | undefined;
}): UsageReceipt | undefined {
  const lines = options.lines ?? [];

  if (!lines.length) {
    return undefined;
  }

  return {
    scope: options.scope,
    title: options.title,
    createdAt: options.createdAt,
    target: options.target,
    totals: usageTotals(lines),
    lines,
  };
}

export function createRefreshUsageReceipt(options: {
  runId: string;
  createdAt: string;
  records: UsageRecord[] | undefined;
}): UsageReceipt | undefined {
  return createUsageReceipt({
    scope: "refresh",
    title: "Usage",
    createdAt: options.createdAt,
    target: { runId: options.runId },
    lines: refreshReceiptUsage(options.records),
  });
}
