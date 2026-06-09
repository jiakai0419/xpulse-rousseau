import assert from "node:assert/strict";
import { test } from "node:test";
import type { UsageRecord } from "../../src/domain/tweet.ts";
import { createRefreshUsageReceipt, refreshReceiptUsage, usageTotals } from "../../src/services/usage/receipts.ts";

function usage(overrides: Partial<UsageRecord>): UsageRecord {
  return {
    provider: "openai",
    operation: "scoring",
    label: "Usage",
    itemCount: 1,
    itemIds: ["post-1"],
    createdAt: "2026-06-05T08:00:00.000Z",
    ...overrides,
  };
}

test("refreshReceiptUsage keeps refresh usage records together", () => {
  const records = [
    usage({ operation: "x.timeline", provider: "x", label: "X timeline" }),
    usage({ operation: "scoring", label: "Scoring" }),
    usage({ operation: "translation", label: "Translation" }),
  ];

  const refreshRecords = refreshReceiptUsage(records);

  assert.deepEqual(refreshRecords.map((record) => record.operation), ["x.timeline", "scoring", "translation"]);
});

test("usageTotals summarizes provider-specific metrics for one receipt", () => {
  const totals = usageTotals([
    usage({
      operation: "x.timeline",
      provider: "x",
      label: "X timeline",
      requestCount: 1,
      itemCount: 100,
    }),
    usage({
      operation: "scoring",
      label: "Scoring",
      inputTokens: 1000,
      outputTokens: 300,
      totalTokens: 1300,
      cachedInputTokens: 120,
      reasoningTokens: 50,
      itemCount: 100,
    }),
    usage({
      operation: "translation",
      label: "Translation",
      inputTokens: 500,
      outputTokens: 250,
      totalTokens: 750,
      itemCount: 10,
    }),
  ]);

  assert.equal(totals.openAIRequests, 2);
  assert.equal(totals.xRequests, 1);
  assert.equal(totals.totalTokens, 2050);
  assert.equal(totals.cachedInputTokens, 120);
  assert.equal(totals.reasoningTokens, 50);
  assert.equal(totals.itemCount, 210);
});

test("createRefreshUsageReceipt returns one user-action receipt with scoring and translation lines", () => {
  const receipt = createRefreshUsageReceipt({
    runId: "run-1",
    createdAt: "2026-06-05T08:00:00.000Z",
    records: [
      usage({ operation: "x.timeline", provider: "x", label: "X timeline" }),
      usage({ operation: "scoring", label: "Scoring", totalTokens: 100 }),
      usage({ operation: "translation", label: "Translation", totalTokens: 200 }),
    ],
  });

  assert.equal(receipt?.scope, "refresh");
  assert.equal(receipt?.target?.runId, "run-1");
  assert.deepEqual(receipt?.lines.map((line) => line.operation), ["x.timeline", "scoring", "translation"]);
  assert.equal(receipt?.totals.totalTokens, 300);
});
