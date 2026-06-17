import assert from "node:assert/strict";
import { test } from "node:test";
import type { RefreshProgress, UsageRecord } from "../../src/domain/tweet.ts";
import { createRefreshProgressReporter } from "../../src/services/pipeline/progress.ts";

function openAIUsage(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    provider: "openai",
    operation: "scoring",
    label: "Scoring",
    model: "gpt-test",
    inputTokens: 100,
    outputTokens: 40,
    totalTokens: 140,
    itemCount: 2,
    itemIds: ["one", "two"],
    createdAt: "2026-06-03T09:30:00.000Z",
    ...overrides,
  };
}

function xUsage(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    provider: "x",
    operation: "x.timeline",
    label: "X timeline",
    endpoint: "/2/users/user-id/timelines/reverse_chronological",
    method: "GET",
    itemCount: 100,
    itemIds: ["one"],
    createdAt: "2026-06-03T09:30:01.000Z",
    ...overrides,
  };
}

test("createRefreshProgressReporter publishes progress with current usage snapshots", () => {
  const progressEvents: RefreshProgress[] = [];
  const reporter = createRefreshProgressReporter({
    now: () => new Date("2026-06-03T09:30:00.000Z"),
    onProgress: (progress) => progressEvents.push(progress),
  });

  reporter.publishProgress({
    stage: "loading",
    label: "Loading timeline",
    detail: "Reading the selected source",
  });

  assert.deepEqual(progressEvents, [
    {
      stage: "loading",
      label: "Loading timeline",
      detail: "Reading the selected source",
      processedItems: undefined,
      totalItems: undefined,
      model: undefined,
      usage: [],
      updatedAt: "2026-06-03T09:30:00.000Z",
    },
  ]);
});

test("createRefreshProgressReporter records usage and maps usage lines to progress", () => {
  const progressEvents: RefreshProgress[] = [];
  const forwardedUsage: UsageRecord[] = [];
  const reporter = createRefreshProgressReporter({
    now: () => new Date("2026-06-03T09:30:02.000Z"),
    onProgress: (progress) => progressEvents.push(progress),
    onUsage: (usage) => forwardedUsage.push(usage),
  });
  const scoringUsage = openAIUsage();
  const translationUsage = openAIUsage({
    operation: "translation",
    label: "Translation",
    model: "gpt-test-translation",
    inputTokens: 50,
    outputTokens: 20,
    totalTokens: 70,
    itemCount: 1,
    itemIds: ["one"],
  });
  const timelineUsage = xUsage();

  reporter.recordUsage(scoringUsage);
  reporter.recordUsage(translationUsage);
  reporter.recordUsage(timelineUsage);

  assert.deepEqual(forwardedUsage, [scoringUsage, translationUsage, timelineUsage]);
  assert.deepEqual(reporter.usageRecords(), [scoringUsage, translationUsage, timelineUsage]);
  assert.deepEqual(
    progressEvents.map((progress) => ({
      stage: progress.stage,
      label: progress.label,
      detail: progress.detail,
      model: progress.model,
      usageCount: progress.usage.length,
      updatedAt: progress.updatedAt,
    })),
    [
      {
        stage: "scoring",
        label: "Scoring",
        detail: "gpt-test: input 100, output 40, total 140",
        model: "gpt-test",
        usageCount: 1,
        updatedAt: "2026-06-03T09:30:02.000Z",
      },
      {
        stage: "translating",
        label: "Translation",
        detail: "gpt-test-translation: input 50, output 20, total 70",
        model: "gpt-test-translation",
        usageCount: 2,
        updatedAt: "2026-06-03T09:30:02.000Z",
      },
      {
        stage: "loading",
        label: "X timeline",
        detail: "GET /2/users/user-id/timelines/reverse_chronological · 100 items",
        model: undefined,
        usageCount: 3,
        updatedAt: "2026-06-03T09:30:02.000Z",
      },
    ],
  );
});
