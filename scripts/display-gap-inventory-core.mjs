import { readerDisplayPost } from "./render-buckets.mjs";

export function fallbackScore() {
  return {
    total: 0,
    dimensions: [],
  };
}

export function scoreByPostIdFromRuns(runs) {
  const scores = new Map();

  for (const run of runs ?? []) {
    for (const selected of run.selectedPosts ?? []) {
      scores.set(selected.post.id, selected.score);
      scores.set(readerDisplayPost(selected.post).id, selected.score);
    }

    for (const decision of run.trace?.decisions ?? []) {
      if (decision.score?.weightedScore) {
        scores.set(decision.postId, decision.score.weightedScore);
      }
    }
  }

  return scores;
}

export function translationByPostIdFromRuns(runs) {
  const translations = new Map();

  for (const run of runs ?? []) {
    for (const selected of run.selectedPosts ?? []) {
      if (!selected.translation) {
        continue;
      }

      translations.set(selected.post.id, selected.translation);
      translations.set(readerDisplayPost(selected.post).id, selected.translation);
    }
  }

  return translations;
}

export function inventoryRunFromPosts(posts, createdAt) {
  const runId = `inventory_fresh_${Date.parse(createdAt)}`;

  return {
    id: runId,
    createdAt,
    source: "x",
    stats: {
      fetched: posts.length,
      adsExcluded: 0,
      duplicatesExcluded: 0,
      seenExcluded: 0,
      scored: 0,
      selected: 0,
    },
    selectedPosts: [],
    usage: [],
    trace: {
      version: "run-trace-v1",
      runId,
      createdAt,
      source: "x",
      pipelineVersion: "reader-refresh-v1",
      config: {
        selectedPostCount: 0,
        scoringWeights: [],
        configuredModels: {
          scoring: "inventory-no-openai",
          translation: "inventory-no-openai",
        },
        batches: {
          scoring: 0,
          translation: 0,
        },
        promptVersions: {
          scoring: "scoring-v2",
          translation: "translation-v2",
        },
      },
      inputPosts: posts.map((post, fetchIndex) => ({ post, fetchIndex })),
      decisions: [],
    },
  };
}

export function auditRunFromSamples(samples, runs, options = {}) {
  const scores = scoreByPostIdFromRuns(runs);
  const translations = translationByPostIdFromRuns(runs);
  const now = options.createdAt ?? new Date().toISOString();

  return {
    id: options.id ?? `display_inventory_${Date.now()}`,
    createdAt: now,
    source: "x",
    stats: {
      fetched: samples.length,
      adsExcluded: 0,
      duplicatesExcluded: 0,
      seenExcluded: 0,
      scored: samples.length,
      selected: samples.length,
    },
    selectedPosts: samples.map((sample) => {
      const timelineId = sample.timelinePost.id;
      const displayId = sample.displayPost.id;
      const translation = translations.get(timelineId) ?? translations.get(displayId);
      return {
        post: sample.timelinePost,
        score: scores.get(timelineId) ?? scores.get(displayId) ?? fallbackScore(),
        ...(translation ? { translation } : {}),
      };
    }),
    usage: [],
  };
}

export function countBy(items) {
  const counts = {};
  for (const item of items) {
    counts[item] = (counts[item] ?? 0) + 1;
  }

  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

export function buildDisplayGapInventoryReport({
  createdAt = new Date().toISOString(),
  sourceStorePath,
  outputDir,
  includeFresh,
  freshRun,
  historicalRuns,
  runs,
  reportSamples,
  screenshotSummary,
}) {
  return {
    createdAt,
    sourceStorePath,
    outputDir,
    includeFresh,
    freshRunId: freshRun?.id,
    freshPostCount: freshRun?.trace?.inputPosts?.length ?? 0,
    historyRunCount: historicalRuns.length,
    sampledRunIds: runs.map((run) => run.id),
    sampleCount: reportSamples.length,
    bucketCounts: countBy(reportSamples.flatMap((sample) => sample.buckets)),
    riskCounts: countBy(reportSamples.flatMap((sample) => sample.risks)),
    missingDataCounts: countBy(reportSamples.flatMap((sample) => sample.missingData)),
    screenshotSummary,
    samples: reportSamples,
  };
}

export function markdownDisplayGapInventoryReport(report) {
  const lines = [
    "# Display Gap Inventory",
    "",
    `Created: ${report.createdAt}`,
    `Output: \`${report.outputDir}\``,
    `Historical runs scanned: ${report.historyRunCount}`,
    `Fresh capture: ${report.freshRunId ? `${report.freshRunId} (${report.freshPostCount} posts)` : "not requested"}`,
    `Samples inventoried: ${report.samples.length}`,
    "",
    "## Screenshot Reliability",
    "",
    `Local screenshots attempted: ${report.screenshotSummary.localAttempted}`,
    `Local blank/near-uniform screenshots: ${report.screenshotSummary.localBlank}`,
    "",
    "Original X screenshots are intentionally not treated as solved by this inventory command. For this round, the report keeps exact Original URLs and local screenshots, then the high-risk rows should be opened in the user's already-authenticated Chrome window for visual comparison. Screenshot failures must be recorded as tooling gaps, not ignored.",
    "",
    "## Risk Counts",
    "",
    "| Risk | Count |",
    "| --- | ---: |",
  ];

  for (const [risk, count] of Object.entries(report.riskCounts)) {
    lines.push(`| ${risk} | ${count} |`);
  }

  lines.push("", "## Bucket Counts", "", "| Bucket | Count |", "| --- | ---: |");
  for (const [bucket, count] of Object.entries(report.bucketCounts)) {
    lines.push(`| ${bucket} | ${count} |`);
  }

  lines.push("", "## Missing Data Counts", "", "| Missing Data | Count |", "| --- | ---: |");
  for (const [missing, count] of Object.entries(report.missingDataCounts)) {
    lines.push(`| ${missing} | ${count} |`);
  }

  lines.push("", "## High-Risk Samples", "", "| # | Pool | Author | Buckets | Risks | Missing Data | Local | Original | Text |", "| ---: | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const sample of report.samples.filter((item) => item.risks.length || item.missingData.length).slice(0, 40)) {
    lines.push(
      `| ${sample.index} | ${sample.pool} | @${sample.author.username} | ${sample.buckets.join(", ") || "-"} | ${sample.risks.join(", ") || "-"} | ${sample.missingData.join(", ") || "-"} | ${sample.localScreenshot ? `[local](${sample.localScreenshot})` : "-"} | [X](${sample.url}) | ${sample.textStart.replaceAll("|", "\\|")} |`,
    );
  }

  lines.push("", "## Notes", "");
  lines.push("- This inventory uses real X-derived data only: saved live runs plus optional fresh X API capture.");
  lines.push("- Fresh capture does not call OpenAI, does not update Seen Ledger, and does not update the product timeline cursor.");
  lines.push("- X Article links (`x.com/i/article/...`) are tracked explicitly because they can render as rich X Article cards on Original pages while X API tweet entities may only provide a URL.");
  lines.push("- Use this report to decide whether to add API enrichment, rendering rules, or targeted regression specimens before the next refactor block.");

  return `${lines.join("\n")}\n`;
}
