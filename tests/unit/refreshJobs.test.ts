import assert from "node:assert/strict";
import { setTimeout } from "node:timers/promises";
import { test } from "node:test";
import type { RefreshRun, UsageRecord } from "../../src/domain/tweet.ts";
import { createProgress, RefreshJobStore, responseJob, type RefreshJob } from "../../src/server/refreshJobs.ts";
import { testPost } from "../helpers/posts.ts";

function testUsage(overrides: Partial<UsageRecord> = {}): UsageRecord {
  return {
    provider: "openai",
    operation: "scoring",
    label: "Scoring",
    model: "gpt-test",
    inputTokens: 100,
    outputTokens: 20,
    totalTokens: 120,
    itemCount: 1,
    itemIds: ["post-job"],
    requestCount: 1,
    createdAt: "2026-06-08T00:00:00.000Z",
    ...overrides,
  };
}

function testRun(overrides: Partial<RefreshRun> = {}): RefreshRun {
  return {
    id: "run-job",
    createdAt: "2026-06-08T00:00:00.000Z",
    source: "x",
    stats: { fetched: 1, adsExcluded: 0, duplicatesExcluded: 0, seenExcluded: 0, scored: 1, selected: 1 },
    selectedPosts: [{ post: testPost({ id: "post-job" }), score: { total: 8.2, dimensions: [] } }],
    usage: [],
    ...overrides,
  };
}

function testTrace(runId: string): RefreshRun["trace"] {
  return {
    version: "run-trace-v1",
    runId,
    createdAt: "2026-06-08T00:00:00.000Z",
    source: "x",
    pipelineVersion: "reader-refresh-v1",
    config: {
      selectedPostCount: 1,
      scoringWeights: [],
      configuredModels: {
        scoring: "gpt-test-scoring",
        translation: "gpt-test-translation",
      },
      batches: {
        scoring: 20,
        translation: 10,
      },
      promptVersions: {
        scoring: "scoring-v2",
        translation: "translation-v2",
      },
    },
    inputPosts: [],
    decisions: [],
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

async function waitForStatus(job: RefreshJob, status: RefreshJob["status"]): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (job.status === status) {
      return;
    }

    await setTimeout(0);
  }

  assert.fail(`Timed out waiting for job ${job.id} to become ${status}; current status is ${job.status}.`);
}

function createTestStore(): RefreshJobStore {
  let id = 0;
  const dates = [
    new Date("2026-06-08T00:00:00.000Z"),
    new Date("2026-06-08T00:01:00.000Z"),
    new Date("2026-06-08T00:02:00.000Z"),
  ];

  return new RefreshJobStore({
    createJobId: () => `job-${++id}`,
    now: () => dates[Math.min(id, dates.length - 1)],
  });
}

test("RefreshJobStore reuses a running job and starts a new job after completion", async () => {
  const store = createTestStore();
  const firstRun = deferred<RefreshRun>();
  const runCalls: string[] = [];

  const job = store.start("x", {
    run: async ({ source }) => {
      runCalls.push(source);
      return firstRun.promise;
    },
    commit: async () => {},
  });
  const reusedJob = store.start("replay", {
    run: async ({ source }) => {
      runCalls.push(source);
      return testRun({ source });
    },
    commit: async () => {},
  });

  assert.equal(reusedJob, job);
  assert.equal(store.get(job.id), job);
  assert.equal(store.get("missing-job"), undefined);
  assert.equal(store.running(), job);
  assert.deepEqual(runCalls, ["x"]);

  firstRun.resolve(testRun({ id: "run-one" }));
  await waitForStatus(job, "completed");

  assert.equal(job.progress.label, "Pulse complete");
  assert.equal(job.progress.detail, "Selected 1 posts and recorded usage");
  assert.equal(store.running(), undefined);

  const replayJob = store.start("replay", {
    run: async ({ source }) =>
      testRun({
        id: "run-two",
        source,
        replayOf: {
          runId: "run-one",
          createdAt: "2026-06-08T00:00:00.000Z",
          source: "x",
        },
      }),
    commit: async () => {},
  });
  await waitForStatus(replayJob, "completed");

  assert.equal(replayJob.id, "job-2");
  assert.equal(replayJob.progress.label, "Replay complete");
  assert.equal(store.latest(), replayJob);
});

test("RefreshJobStore commits completed runs and responseJob returns reader-safe usage", async () => {
  const store = createTestStore();
  const usage = testUsage();
  const run = testRun({
    usage: [usage],
    trace: testTrace("run-job"),
  });
  const committedRuns: RefreshRun[] = [];

  const job = store.start("x", {
    run: async ({ onProgress }) => {
      onProgress(
        createProgress({
          stage: "scoring",
          label: "Scoring",
          detail: "Scoring one candidate",
          usage: [usage],
        }),
      );
      return run;
    },
    commit: async (completedRun) => {
      committedRuns.push(completedRun);
    },
  });
  await waitForStatus(job, "completed");

  assert.deepEqual(committedRuns, [run]);
  assert.deepEqual(job.progress.usage, [usage]);

  const payload = responseJob(job);

  assert.equal(payload.run?.id, "run-job");
  assert.equal(payload.run ? Object.hasOwn(payload.run, "trace") : true, false);
  assert.equal(payload.run?.usageReceipt?.scope, "refresh");
  assert.equal(payload.run?.usageReceipt?.totals.openAIRequests, 1);
  assert.equal(payload.run?.usageReceipt?.totals.totalTokens, 120);
});

test("RefreshJobStore marks failures and preserves the last recorded usage progress", async () => {
  const store = createTestStore();
  const usage = testUsage({ operation: "translation", label: "Translation" });
  let commitCalled = false;

  const job = store.start("x", {
    run: async ({ onProgress }) => {
      onProgress(
        createProgress({
          stage: "translating",
          label: "Translation",
          detail: "Translating selected posts",
          usage: [usage],
        }),
      );
      throw new Error("OpenAI timed out");
    },
    commit: async () => {
      commitCalled = true;
    },
  });
  await waitForStatus(job, "failed");

  assert.equal(commitCalled, false);
  assert.equal(job.error, "OpenAI timed out");
  assert.equal(job.progress.stage, "failed");
  assert.equal(job.progress.label, "Pulse failed");
  assert.equal(job.progress.detail, "OpenAI timed out");
  assert.deepEqual(job.progress.usage, [usage]);
});
