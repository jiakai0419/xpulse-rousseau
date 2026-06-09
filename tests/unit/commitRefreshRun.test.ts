import assert from "node:assert/strict";
import { test } from "node:test";
import type { RefreshRun } from "../../src/domain/tweet.ts";
import { commitRefreshRun } from "../../src/services/pipeline/commitRefreshRun.ts";
import { testPost } from "../helpers/posts.ts";

function testRun(overrides: Partial<RefreshRun> = {}): RefreshRun {
  return {
    id: "run-commit",
    createdAt: "2026-06-08T00:00:00.000Z",
    source: "x",
    stats: { fetched: 1, adsExcluded: 0, duplicatesExcluded: 0, seenExcluded: 0, scored: 1, selected: 1 },
    selectedPosts: [{ post: testPost({ id: "post-commit" }), score: { total: 8.2, dimensions: [] } }],
    usage: [],
    ...overrides,
  };
}

function recordingCommitter() {
  const calls: string[] = [];
  const savedRuns: RefreshRun[] = [];

  return {
    calls,
    savedRuns,
    committer: {
      repository: {
        async save(run: RefreshRun) {
          calls.push("save");
          savedRuns.push(run);
        },
      },
      seenRepository: {
        async markRunShown(run: RefreshRun) {
          calls.push(`seen:${run.id}`);
        },
      },
      timelineCursor: {
        async updateFromRun(run: RefreshRun) {
          calls.push(`cursor:${run.id}`);
        },
      },
    },
  };
}

test("commitRefreshRun saves Online runs then updates Seen Ledger and Timeline Cursor", async () => {
  const { calls, savedRuns, committer } = recordingCommitter();
  const run = testRun({ source: "x" });

  await commitRefreshRun(run, committer);

  assert.deepEqual(calls, ["save", "seen:run-commit", "cursor:run-commit"]);
  assert.deepEqual(savedRuns, [run]);
});

test("commitRefreshRun saves replay runs without mutating Online state", async () => {
  const { calls, savedRuns, committer } = recordingCommitter();
  const run = testRun({
    source: "replay",
    replayOf: {
      runId: "source-live-run",
      createdAt: "2026-06-07T00:00:00.000Z",
      source: "x",
    },
  });

  await commitRefreshRun(run, committer);

  assert.deepEqual(calls, ["save"]);
  assert.deepEqual(savedRuns, [run]);
});

test("commitRefreshRun does not update Online state when saving fails", async () => {
  const calls: string[] = [];
  const run = testRun({ source: "x" });

  await assert.rejects(
    () =>
      commitRefreshRun(run, {
        repository: {
          async save() {
            calls.push("save");
            throw new Error("save failed");
          },
        },
        seenRepository: {
          async markRunShown() {
            calls.push("seen");
          },
        },
        timelineCursor: {
          async updateFromRun() {
            calls.push("cursor");
          },
        },
      }),
    /save failed/,
  );

  assert.deepEqual(calls, ["save"]);
});
