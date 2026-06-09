import type { UsageOperation, UsageRecord } from "../../domain/tweet.ts";
import type { OpenAIUsage } from "./responses.ts";

export type IdCompleteness = {
  missingIds: string[];
  unexpectedIds: string[];
  duplicateIds: string[];
  complete: boolean;
};

export function chunkItems<T>(items: T[], batchSize: number): T[][] {
  const chunks: T[][] = [];

  for (let index = 0; index < items.length; index += batchSize) {
    chunks.push(items.slice(index, index + batchSize));
  }

  return chunks;
}

export function analyzeCompleteIds(options: {
  expectedIds: string[];
  returnedIds: string[];
}): IdCompleteness {
  const expectedIds = new Set(options.expectedIds);
  const seenIds = new Set<string>();
  const duplicateIds: string[] = [];
  const unexpectedIds: string[] = [];

  for (const id of options.returnedIds) {
    if (seenIds.has(id)) {
      duplicateIds.push(id);
    }

    seenIds.add(id);

    if (!expectedIds.has(id)) {
      unexpectedIds.push(id);
    }
  }

  const missingIds = [...expectedIds].filter((id) => !seenIds.has(id));

  return {
    missingIds,
    unexpectedIds,
    duplicateIds,
    complete: missingIds.length === 0 && unexpectedIds.length === 0 && duplicateIds.length === 0,
  };
}

export function formatIncompleteIdsError(label: string, completeness: IdCompleteness): string {
  return `${label} returned an incomplete batch. Missing: ${completeness.missingIds.join(", ") || "none"}. Unexpected: ${completeness.unexpectedIds.join(", ") || "none"}. Duplicates: ${completeness.duplicateIds.join(", ") || "none"}.`;
}

export function validateCompleteIds(options: {
  label: string;
  expectedIds: string[];
  returnedIds: string[];
}): void {
  const completeness = analyzeCompleteIds(options);

  if (!completeness.complete) {
    throw new Error(formatIncompleteIdsError(options.label, completeness));
  }
}

export function createOpenAIUsageRecord(options: {
  operation: Extract<UsageOperation, "scoring" | "translation">;
  label: string;
  model: string;
  usage: OpenAIUsage | undefined;
  itemIds: string[];
  now: Date;
}): UsageRecord | undefined {
  if (!options.usage) {
    return undefined;
  }

  return {
    provider: "openai",
    operation: options.operation,
    label: options.label,
    model: options.model,
    inputTokens: options.usage.inputTokens,
    outputTokens: options.usage.outputTokens,
    totalTokens: options.usage.totalTokens,
    cachedInputTokens: options.usage.cachedInputTokens,
    reasoningTokens: options.usage.reasoningTokens,
    itemCount: options.itemIds.length,
    itemIds: options.itemIds,
    createdAt: options.now.toISOString(),
  };
}
