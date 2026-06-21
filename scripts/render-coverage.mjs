import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildSamplePool, buildSelectedSamplePool, defaultRequiredRenderBuckets } from "./render-buckets.mjs";

const sourceStorePath = process.env.RENDER_COVERAGE_RUN_STORE || ".data/runs.json";
const maxRuns = positiveInt(process.env.RENDER_COVERAGE_MAX_RUNS, 30);
const minPerBucket = positiveInt(process.env.RENDER_COVERAGE_MIN_PER_BUCKET, 1);
const strict = process.env.RENDER_COVERAGE_STRICT === "1";
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = process.env.RENDER_COVERAGE_DIR || `.data/render-coverage/render-coverage-${timestamp}`;
const requiredBuckets = (process.env.RENDER_COVERAGE_REQUIRED_BUCKETS ?? defaultRequiredRenderBuckets.join(","))
  .split(",")
  .map((bucket) => bucket.trim())
  .filter(Boolean);

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function readRunStore(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function compactText(value, maxLength = 90) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function summarizePool(samples) {
  const byBucket = new Map();

  for (const sample of samples) {
    for (const bucket of sample.buckets) {
      if (!byBucket.has(bucket)) {
        byBucket.set(bucket, []);
      }

      byBucket.get(bucket).push(sample);
    }
  }

  return byBucket;
}

function sampleCell(samples) {
  return samples
    .slice(0, 3)
    .map((sample) => {
      const username = sample.displayPost?.author?.username ?? sample.author?.username;
      const postId = sample.displayPost?.id ?? sample.postId ?? "unknown";
      const author = username ? `@${username}` : "unknown";
      return `${author} ${postId}`;
    })
    .join("<br>");
}

function missingBuckets(summary) {
  return requiredBuckets.filter((bucket) => (summary.get(bucket)?.length ?? 0) < minPerBucket);
}

function markdownReport(report) {
  const lines = [
    "# Reader Render Coverage",
    "",
    `Created: ${report.createdAt}`,
    `Run store: \`${report.sourceStorePath}\``,
    `Runs scanned: ${report.runCount}`,
    `Trace input samples: ${report.traceSampleCount}`,
    `Selected samples: ${report.selectedSampleCount}`,
    `Required minimum per bucket: ${report.minPerBucket}`,
    "",
    "## Required Buckets",
    "",
    "| Bucket | Trace Input | Selected Top Posts | Example Trace Samples |",
    "| --- | ---: | ---: | --- |",
  ];

  for (const bucket of report.requiredBuckets) {
    const trace = report.traceBuckets[bucket] ?? [];
    const selected = report.selectedBuckets[bucket] ?? [];
    lines.push(`| ${bucket} | ${trace.length} | ${selected.length} | ${sampleCell(trace)} |`);
  }

  const optionalBuckets = Object.keys(report.traceBuckets)
    .filter((bucket) => !report.requiredBuckets.includes(bucket))
    .sort();

  if (optionalBuckets.length) {
    lines.push("", "## Optional Buckets", "", "| Bucket | Trace Input | Selected Top Posts | Example Trace Samples |", "| --- | ---: | ---: | --- |");

    for (const bucket of optionalBuckets) {
      const trace = report.traceBuckets[bucket] ?? [];
      const selected = report.selectedBuckets[bucket] ?? [];
      lines.push(`| ${bucket} | ${trace.length} | ${selected.length} | ${sampleCell(trace)} |`);
    }
  }

  lines.push("", "## Recent Runs", "", "| Run | Created | Selected | Trace Inputs |", "| --- | --- | ---: | ---: |");
  for (const run of report.runs) {
    lines.push(`| ${run.id} | ${run.createdAt} | ${run.selectedCount} | ${run.traceInputCount} |`);
  }

  lines.push("", "## Notes", "");
  lines.push("- Trace input coverage is the broad pool for learning X rendering shapes beyond the Top 7.");
  lines.push("- Selected coverage is the stricter replay regression pool, because `test:smoke-ui` renders selected posts.");
  lines.push("- If a required bucket is thin or missing, run fresh Online Pulse or `FRESH_PULSE_RUNS=3 npm run x-display:test-fresh-pulse-rendering`, then rerun this report.");

  return `${lines.join("\n")}\n`;
}

function serializeBucketSummary(summary) {
  const output = {};

  for (const [bucket, samples] of [...summary.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    output[bucket] = samples.map((sample) => ({
      runId: sample.runId,
      postId: sample.displayPost.id,
      url: sample.displayPost.url,
      author: sample.displayPost.author,
      textStart: compactText(sample.displayPost.text),
      flags: sample.flags,
    }));
  }

  return output;
}

function main() {
  mkdirSync(outputDir, { recursive: true });
  const store = readRunStore(sourceStorePath);
  const liveRuns = (store.runs ?? [])
    .filter((run) => run.source === "x")
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, maxRuns);

  if (!liveRuns.length) {
    throw new Error(`x-display:check-sample-types needs saved live X runs in ${sourceStorePath}. Run Online Pulse first.`);
  }

  const traceSamples = buildSamplePool(liveRuns);
  const selectedSamples = buildSelectedSamplePool(liveRuns);
  const traceSummary = summarizePool(traceSamples);
  const selectedSummary = summarizePool(selectedSamples);
  const missingTraceBuckets = missingBuckets(traceSummary);
  const missingSelectedBuckets = missingBuckets(selectedSummary);
  const report = {
    createdAt: new Date().toISOString(),
    sourceStorePath,
    outputDir,
    runCount: liveRuns.length,
    minPerBucket,
    requiredBuckets,
    missingTraceBuckets,
    missingSelectedBuckets,
    traceSampleCount: traceSamples.length,
    selectedSampleCount: selectedSamples.length,
    runs: liveRuns.map((run) => ({
      id: run.id,
      createdAt: run.createdAt,
      selectedCount: (run.selectedPosts ?? []).length,
      traceInputCount: (run.trace?.inputPosts ?? []).length,
    })),
    traceBuckets: serializeBucketSummary(traceSummary),
    selectedBuckets: serializeBucketSummary(selectedSummary),
  };

  writeFileSync(join(outputDir, "report.json"), JSON.stringify(report, null, 2), "utf8");
  writeFileSync(join(outputDir, "report.md"), markdownReport(report), "utf8");

  console.log(`x-display:check-sample-types scanned ${liveRuns.length} real X-derived runs.`);
  console.log(`Trace input samples: ${traceSamples.length}; selected samples: ${selectedSamples.length}.`);
  console.log(`Report: ${join(outputDir, "report.md")}`);

  if (missingTraceBuckets.length) {
    console.error(`Missing trace-input buckets: ${missingTraceBuckets.join(", ")}`);
  }

  if (missingSelectedBuckets.length) {
    console.error(`Missing selected-post buckets: ${missingSelectedBuckets.join(", ")}`);
  }

  if (strict && (missingTraceBuckets.length || missingSelectedBuckets.length)) {
    throw new Error("x-display:check-sample-types is missing required buckets in strict mode.");
  }
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
