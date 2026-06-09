import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aiModelStatus,
  progressDetail,
  progressPercent,
  progressStatusLabel,
  progressText,
  receiptFromRecords,
  renderUsageDetails,
  usageGroups,
  usageLabel,
  usageTotals,
} from "../../public/reader/status.js";

const openAIUsage = {
  provider: "openai",
  operation: "scoring",
  model: "gpt-5",
  requestCount: 2,
  itemCount: 7,
  inputTokens: 12000,
  outputTokens: 800,
  totalTokens: 12800,
  cachedInputTokens: 1000,
  reasoningTokens: 120,
  createdAt: "2026-06-09T00:00:00.000Z",
};

const xUsage = {
  provider: "x",
  operation: "x.timeline",
  endpoint: "/2/users/:id/timelines/reverse_chronological",
  method: "GET",
  requestCount: 1,
  itemCount: 100,
  rateLimit: {
    limit: 15,
    remaining: 14,
  },
  createdAt: "2026-06-09T00:00:01.000Z",
};

test("usageTotals keeps OpenAI and X usage as factual per-run totals", () => {
  assert.deepEqual(usageTotals([openAIUsage, xUsage]), {
    inputTokens: 12000,
    outputTokens: 800,
    totalTokens: 12800,
    cachedInputTokens: 1000,
    reasoningTokens: 120,
    openAIRequests: 2,
    xRequests: 1,
    itemCount: 107,
  });
});

test("usageGroups groups records by provider, operation, and model or endpoint", () => {
  const groups = usageGroups([
    openAIUsage,
    {
      ...openAIUsage,
      requestCount: 1,
      itemCount: 3,
      inputTokens: 1000,
      outputTokens: 200,
      totalTokens: 1200,
    },
    xUsage,
  ]);

  assert.equal(groups.length, 2);
  assert.deepEqual(
    groups.map((group) => ({
      label: group.label,
      requestCount: group.requestCount,
      itemCount: group.itemCount,
      totalTokens: group.totalTokens,
    })),
    [
      {
        label: "Scoring",
        requestCount: 3,
        itemCount: 10,
        totalTokens: 14000,
      },
      {
        label: "X timeline",
        requestCount: 1,
        itemCount: 100,
        totalTokens: 0,
      },
    ],
  );
});

test("receiptFromRecords creates a display receipt only when records exist", () => {
  assert.equal(receiptFromRecords("Usage", []), undefined);

  const receipt = receiptFromRecords("Usage", [openAIUsage]);

  assert.equal(receipt?.title, "Usage");
  assert.equal(receipt?.createdAt, openAIUsage.createdAt);
  assert.equal(receipt?.totals.totalTokens, 12800);
  assert.equal(receipt?.lines.length, 1);
});

test("renderUsageDetails escapes display text and summarizes usage", () => {
  const html = renderUsageDetails({
    title: "<Usage>",
    lines: [
      {
        ...openAIUsage,
        operation: "custom",
        label: "<Scoring>",
      },
      xUsage,
    ],
  });

  assert.match(html, /&lt;Usage&gt;/);
  assert.match(html, /&lt;Scoring&gt;/);
  assert.match(html, /12\.8K tokens/);
  assert.match(html, /2 OpenAI calls/);
  assert.match(html, /1 X call/);
  assert.doesNotMatch(html, /<Usage>/);
});

test("progress helpers render bounded stage and item progress", () => {
  assert.equal(progressPercent({ stage: "starting" }), 8);
  assert.equal(progressPercent({ stage: "scoring", processedItems: 3, totalItems: 7 }), 43);
  assert.equal(progressPercent({ stage: "scoring", processedItems: 99, totalItems: 7 }), 100);
  assert.equal(progressStatusLabel({ stage: "scoring" }), "Ranking signal");
  assert.equal(progressStatusLabel({ stage: "unknown", label: "Custom step" }), "Custom step");
  assert.equal(progressText({ stage: "translating", processedItems: 5, totalItems: 7, model: "gpt-5" }), "Translating · 5/7 · gpt-5");
});

test("progressDetail keeps operational copy and token context together", () => {
  const totals = usageTotals([openAIUsage]);

  assert.equal(progressDetail({ stage: "scoring" }, totals), "OpenAI scoring is ranking candidate posts · 12.8K tokens");
  assert.equal(progressDetail({ stage: "failed", detail: "OpenAI request timed out" }, totals), "OpenAI request timed out");
});

test("aiModelStatus stays compact for the sidebar", () => {
  assert.equal(aiModelStatus({ scoring: "gpt-5", translation: "gpt-5" }), "gpt-5");
  assert.equal(aiModelStatus({ scoring: "gpt-5", translation: "gpt-5-mini" }), "mixed models");
  assert.equal(aiModelStatus({}), "unknown");
});

test("usageLabel prefers known operation labels and preserves custom labels", () => {
  assert.equal(usageLabel({ operation: "translation" }), "Translation");
  assert.equal(usageLabel({ operation: "custom", label: "Custom operation" }), "Custom operation");
  assert.equal(usageLabel({ operation: "custom" }), "custom");
});
