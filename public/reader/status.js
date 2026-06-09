import { escapeHtml, formatTokens, plural } from "./format.js";

const operationLabels = {
  scoring: "Scoring",
  translation: "Translation",
  "x.timeline": "X timeline",
  "x.lookup": "X tweet lookup",
  "x.me": "X user",
};

export const progressLabels = {
  starting: "Preparing Pulse",
  loading: "Reading source",
  filtering: "Filtering noise",
  scoring: "Ranking signal",
  translating: "Translating",
  saving: "Preparing results",
  completed: "Done",
  failed: "Needs attention",
};

export function usageLabel(record) {
  return operationLabels[record.operation] ?? record.label ?? record.operation;
}

export function usageTotals(records) {
  return records.reduce(
    (totals, record) => ({
      inputTokens: totals.inputTokens + (record.inputTokens ?? 0),
      outputTokens: totals.outputTokens + (record.outputTokens ?? 0),
      totalTokens: totals.totalTokens + (record.totalTokens ?? 0),
      cachedInputTokens: totals.cachedInputTokens + (record.cachedInputTokens ?? 0),
      reasoningTokens: totals.reasoningTokens + (record.reasoningTokens ?? 0),
      openAIRequests: totals.openAIRequests + (record.provider === "openai" ? record.requestCount ?? 1 : 0),
      xRequests: totals.xRequests + (record.provider === "x" ? record.requestCount ?? 1 : 0),
      itemCount: totals.itemCount + (record.itemCount ?? 0),
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

export function receiptFromRecords(title, records = []) {
  if (!records.length) {
    return undefined;
  }

  return {
    title,
    createdAt: records[0]?.createdAt ?? new Date().toISOString(),
    totals: usageTotals(records),
    lines: records,
  };
}

export function usageGroups(records) {
  const grouped = new Map();

  for (const record of records) {
    const key = `${record.provider}:${record.operation}:${record.model ?? record.endpoint ?? ""}`;
    const current = grouped.get(key) ?? {
      provider: record.provider,
      operation: record.operation,
      label: usageLabel(record),
      model: record.model,
      endpoint: record.endpoint,
      method: record.method,
      requestCount: 0,
      itemCount: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      reasoningTokens: 0,
      cachedInputTokens: 0,
      rateLimit: record.rateLimit,
    };
    current.requestCount += record.requestCount ?? 1;
    current.itemCount += record.itemCount ?? 0;
    current.inputTokens += record.inputTokens ?? 0;
    current.outputTokens += record.outputTokens ?? 0;
    current.totalTokens += record.totalTokens ?? 0;
    current.reasoningTokens += record.reasoningTokens ?? 0;
    current.cachedInputTokens += record.cachedInputTokens ?? 0;
    current.rateLimit = record.rateLimit ?? current.rateLimit;
    grouped.set(key, current);
  }

  return Array.from(grouped.values());
}

export function renderUsageDetails(receipt) {
  const lines = receipt.lines ?? [];
  const totals = receipt.totals ?? usageTotals(lines);
  const grouped = usageGroups(lines);
  const tokenSummary = totals.totalTokens ? `${formatTokens(totals.totalTokens)} tokens` : "no token usage";
  const requestSummary = [
    totals.openAIRequests ? plural(totals.openAIRequests, "OpenAI call") : "",
    totals.xRequests ? plural(totals.xRequests, "X call") : "",
  ]
    .filter(Boolean)
    .join(" · ");

  return `
    <details class="usage-details">
      <summary>
        <span class="usage-summary-title">${escapeHtml(receipt.title ?? "Usage")}</span>
        <span>${escapeHtml([tokenSummary, requestSummary].filter(Boolean).join(" · "))}</span>
      </summary>
      <div class="usage-grid">
      ${grouped
        .map((item) => {
          const target = item.provider === "openai" ? item.model : `${item.method ?? "GET"} ${item.endpoint ?? "X API"}`;
          const detail =
            item.provider === "openai"
              ? `in ${formatTokens(item.inputTokens)} / out ${formatTokens(item.outputTokens)} / total ${formatTokens(item.totalTokens)}`
              : `rate ${item.rateLimit?.remaining ?? "?"} / ${item.rateLimit?.limit ?? "?"}`;

          return `
            <div class="usage-item">
              <strong>${escapeHtml(item.label)}</strong>
              <span>${escapeHtml(target)}</span>
              <span>${escapeHtml(plural(item.itemCount, "item"))} · ${escapeHtml(plural(item.requestCount, "request"))}</span>
              <span>${escapeHtml(detail)}</span>
            </div>
          `;
        })
        .join("")}
      </div>
    </details>
  `;
}

export function progressPercent(progress) {
  if (progress.totalItems > 0 && progress.processedItems >= 0) {
    const raw = Math.round((progress.processedItems / progress.totalItems) * 100);
    return Math.max(10, Math.min(100, raw));
  }

  const stagePercent = {
    starting: 8,
    loading: 18,
    filtering: 34,
    scoring: 58,
    translating: 78,
    saving: 90,
    completed: 100,
    failed: 100,
  };

  return stagePercent[progress.stage] ?? 20;
}

export function progressText(progress) {
  const label = progressStatusLabel(progress);
  const itemText = progress.totalItems ? ` · ${progress.processedItems ?? 0}/${progress.totalItems}` : "";
  const modelText = progress.model ? ` · ${progress.model}` : "";

  return `${label}${itemText}${modelText}`;
}

export function progressStatusLabel(progress) {
  return progressLabels[progress.stage] ?? progress.label ?? "Working";
}

export function aiModelStatus(models) {
  const scoring = models.scoring ?? "unknown";
  const translation = models.translation ?? "unknown";

  if (scoring === translation) {
    return scoring;
  }

  return "mixed models";
}

export function progressDetail(progress, totals) {
  const tokenText = totals.totalTokens ? ` · ${formatTokens(totals.totalTokens)} tokens` : "";

  if (progress.stage === "loading") {
    return `Reading the selected source${tokenText}`;
  }

  if (progress.stage === "filtering") {
    return `Removing obvious ads and exact duplicates${tokenText}`;
  }

  if (progress.stage === "scoring") {
    return `OpenAI scoring is ranking candidate posts${tokenText}`;
  }

  if (progress.stage === "translating") {
    return `OpenAI is translating selected posts${tokenText}`;
  }

  if (progress.stage === "saving") {
    return `Saving selected posts and usage records${tokenText}`;
  }

  if (progress.stage === "completed") {
    return `Saved this Pulse${tokenText}`;
  }

  if (progress.stage === "failed") {
    return progress.detail ?? `Pulse failed${tokenText}`;
  }

  return `Waiting for server${tokenText}`;
}
