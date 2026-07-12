import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { RefreshRun } from "../../src/domain/tweet.ts";
import { commitRefreshRun, recoverPendingRefreshCommit } from "../../src/services/pipeline/commitRefreshRun.ts";
import {
  FileRefreshCommitJournal,
  type RefreshCommitJournal,
  type RefreshCommitJournalRecord,
} from "../../src/services/pipeline/refreshCommitJournal.ts";
import { FileSeenPostRepository } from "../../src/services/seen/seenLedger.ts";
import { FileRunRepository } from "../../src/services/storage/fileRunRepository.ts";
import { FileTimelineCursorRepository } from "../../src/services/x/timelineCursor.ts";
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

function memoryCommitJournal(calls?: string[]): RefreshCommitJournal & {
  pending(): RefreshCommitJournalRecord | undefined;
} {
  let record: RefreshCommitJournalRecord | undefined;

  return {
    async read() {
      calls?.push("journal:read");
      return record;
    },
    async write(next) {
      calls?.push("journal:write");
      record = next;
    },
    async clear() {
      calls?.push("journal:clear");
      record = undefined;
    },
    pending: () => record,
  };
}

function recordingCommitter() {
  const calls: string[] = [];
  const savedRuns: RefreshRun[] = [];
  const runCheckpoint = { runs: [testRun({ id: "previous-run" })] };
  const seenCheckpoint = { records: [] };
  const cursorCheckpoint = { latestPostId: "previous-post", runId: "previous-run" };

  return {
    calls,
    savedRuns,
    committer: {
      repository: {
        async checkpoint() {
          calls.push("checkpoint:run");
          return runCheckpoint;
        },
        async restore(checkpoint: typeof runCheckpoint) {
          assert.equal(checkpoint, runCheckpoint);
          calls.push("restore:run");
        },
        async save(run: RefreshRun) {
          calls.push("save");
          savedRuns.push(run);
        },
      },
      seenRepository: {
        async checkpoint() {
          calls.push("checkpoint:seen");
          return seenCheckpoint;
        },
        async restore(checkpoint: typeof seenCheckpoint) {
          assert.equal(checkpoint, seenCheckpoint);
          calls.push("restore:seen");
        },
        async markRunShown(run: RefreshRun) {
          calls.push(`seen:${run.id}`);
        },
      },
      timelineCursor: {
        async checkpoint() {
          calls.push("checkpoint:cursor");
          return cursorCheckpoint;
        },
        async restore(checkpoint: typeof cursorCheckpoint) {
          assert.equal(checkpoint, cursorCheckpoint);
          calls.push("restore:cursor");
        },
        async updateFromRun(run: RefreshRun) {
          calls.push(`cursor:${run.id}`);
        },
      },
      journal: memoryCommitJournal(calls),
    },
  };
}

test("commitRefreshRun saves Online runs then updates Seen Ledger and Timeline Cursor", async () => {
  const { calls, savedRuns, committer } = recordingCommitter();
  const run = testRun({ source: "x" });

  await commitRefreshRun(run, committer);

  assert.equal(calls[0], "journal:read");
  assert.deepEqual(calls.slice(1, 4).sort(), ["checkpoint:cursor", "checkpoint:run", "checkpoint:seen"]);
  assert.deepEqual(calls.slice(4), [
    "journal:write",
    "save",
    "seen:run-commit",
    "cursor:run-commit",
    "journal:clear",
  ]);
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

  assert.deepEqual(calls, ["journal:read", "save"]);
  assert.deepEqual(savedRuns, [run]);
});

test("commitRefreshRun does not update Online state when saving fails", async () => {
  const calls: string[] = [];
  const run = testRun({ source: "x" });

  await assert.rejects(
    () =>
      commitRefreshRun(run, {
        repository: {
          async checkpoint() {
            calls.push("checkpoint:run");
            return { runs: [] };
          },
          async restore() {
            calls.push("restore:run");
          },
          async save() {
            calls.push("save");
            throw new Error("save failed");
          },
        },
        seenRepository: {
          async checkpoint() {
            calls.push("checkpoint:seen");
            return { records: [] };
          },
          async restore() {
            calls.push("restore:seen");
          },
          async markRunShown() {
            calls.push("seen");
          },
        },
        timelineCursor: {
          async checkpoint() {
            calls.push("checkpoint:cursor");
            return {};
          },
          async restore() {
            calls.push("restore:cursor");
          },
          async updateFromRun() {
            calls.push("cursor");
          },
        },
        journal: memoryCommitJournal(calls),
      }),
    /save failed/,
  );

  assert.equal(calls[0], "journal:read");
  assert.deepEqual(calls.slice(1, 4).sort(), ["checkpoint:cursor", "checkpoint:run", "checkpoint:seen"]);
  assert.deepEqual(calls.slice(4), [
    "journal:write",
    "save",
    "restore:cursor",
    "restore:seen",
    "restore:run",
    "journal:clear",
  ]);
});

test("commitRefreshRun rolls back the Run Store and Seen Ledger when the Timeline Cursor update fails", async () => {
  const calls: string[] = [];
  const run = testRun({ source: "x" });

  await assert.rejects(
    () =>
      commitRefreshRun(run, {
        repository: {
          async checkpoint() {
            return { runs: [testRun({ id: "previous-run" })] };
          },
          async save() {
            calls.push("save");
          },
          async restore(checkpoint) {
            calls.push(`restore:run:${checkpoint.runs[0].id}`);
          },
        },
        seenRepository: {
          async checkpoint() {
            return { records: [] };
          },
          async markRunShown() {
            calls.push("seen");
          },
          async restore(checkpoint) {
            calls.push(`restore:seen:${checkpoint.records.length}`);
          },
        },
        timelineCursor: {
          async checkpoint() {
            return { latestPostId: "previous-post" };
          },
          async updateFromRun() {
            calls.push("cursor");
            throw new Error("cursor failed");
          },
          async restore(checkpoint) {
            calls.push(`restore:cursor:${checkpoint.latestPostId}`);
          },
        },
        journal: memoryCommitJournal(),
      }),
    /cursor failed/,
  );

  assert.deepEqual(calls, [
    "save",
    "seen",
    "cursor",
    "restore:cursor:previous-post",
    "restore:seen:0",
    "restore:run:previous-run",
  ]);
});

test("commitRefreshRun reports an incomplete rollback instead of hiding recovery failure", async () => {
  const run = testRun({ source: "x" });

  await assert.rejects(
    () =>
      commitRefreshRun(run, {
        repository: {
          async checkpoint() {
            return { runs: [] };
          },
          async save() {},
          async restore() {
            throw new Error("run restore failed");
          },
        },
        seenRepository: {
          async checkpoint() {
            return { records: [] };
          },
          async markRunShown() {
            throw new Error("seen failed");
          },
          async restore() {},
        },
        timelineCursor: {
          async checkpoint() {
            return {};
          },
          async updateFromRun() {},
          async restore() {},
        },
        journal: memoryCommitJournal(),
      }),
    /could not be fully restored/,
  );
});

test("commitRefreshRun restores real file-backed Run, Seen, and Cursor state after a late failure", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xpulse-commit-rollback-"));
  const repository = new FileRunRepository(join(directory, "runs.json"));
  const seenRepository = new FileSeenPostRepository(join(directory, "seen.json"));
  const timelineCursor = new FileTimelineCursorRepository(join(directory, "cursor.json"));
  const previousRun = testRun({
    id: "previous-run",
    createdAt: "2026-06-07T00:00:00.000Z",
    selectedPosts: [{ post: testPost({ id: "100" }), score: { total: 70, dimensions: [] } }],
  });
  const failedRun = testRun({
    id: "failed-run",
    selectedPosts: [{ post: testPost({ id: "200" }), score: { total: 80, dimensions: [] } }],
  });

  try {
    await repository.save(previousRun);
    await seenRepository.markRunShown(previousRun);
    await timelineCursor.updateFromRun(previousRun);

    await assert.rejects(
      () =>
        commitRefreshRun(failedRun, {
          repository,
          seenRepository,
          timelineCursor: {
            checkpoint: () => timelineCursor.checkpoint(),
            restore: (checkpoint) => timelineCursor.restore(checkpoint),
            async updateFromRun(run) {
              await timelineCursor.updateFromRun(run);
              throw new Error("simulated failure after cursor write");
            },
          },
          journal: new FileRefreshCommitJournal(join(directory, "commit-journal.json")),
        }),
      /simulated failure after cursor write/,
    );

    assert.equal((await repository.latest())?.id, "previous-run");
    assert.equal(await repository.find("failed-run"), undefined);
    assert.deepEqual(Array.from(await seenRepository.identities()), ["post:100"]);
    assert.deepEqual(await timelineCursor.get(), {
      latestPostId: "100",
      updatedAt: previousRun.createdAt,
      runId: previousRun.id,
    });
    assert.equal(await new FileRefreshCommitJournal(join(directory, "commit-journal.json")).read(), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("recoverPendingRefreshCommit rolls back a crash left between file replacements before startup", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xpulse-commit-recovery-"));
  const repository = new FileRunRepository(join(directory, "runs.json"));
  const seenRepository = new FileSeenPostRepository(join(directory, "seen.json"));
  const timelineCursor = new FileTimelineCursorRepository(join(directory, "cursor.json"));
  const journal = new FileRefreshCommitJournal(join(directory, "commit-journal.json"));
  const previousRun = testRun({
    id: "pre-crash-run",
    createdAt: "2026-06-07T00:00:00.000Z",
    selectedPosts: [{ post: testPost({ id: "300" }), score: { total: 70, dimensions: [] } }],
  });
  const interruptedRun = testRun({
    id: "interrupted-run",
    selectedPosts: [{ post: testPost({ id: "400" }), score: { total: 80, dimensions: [] } }],
  });

  try {
    await repository.save(previousRun);
    await seenRepository.markRunShown(previousRun);
    await timelineCursor.updateFromRun(previousRun);
    await journal.write({
      version: "refresh-commit-v1",
      runId: interruptedRun.id,
      createdAt: interruptedRun.createdAt,
      checkpoints: {
        run: await repository.checkpoint(),
        seen: await seenRepository.checkpoint(),
        cursor: await timelineCursor.checkpoint(),
      },
    });

    // These writes model a process exiting after all three renames but before journal clear.
    await repository.save(interruptedRun);
    await seenRepository.markRunShown(interruptedRun);
    await timelineCursor.updateFromRun(interruptedRun);

    const recovered = await recoverPendingRefreshCommit({
      repository,
      seenRepository,
      timelineCursor,
      journal,
    });

    assert.equal(recovered, true);
    assert.equal((await repository.latest())?.id, previousRun.id);
    assert.equal(await repository.find(interruptedRun.id), undefined);
    assert.deepEqual(Array.from(await seenRepository.identities()), ["post:300"]);
    assert.equal((await timelineCursor.get()).runId, previousRun.id);
    assert.equal(await journal.read(), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("commitRefreshRun restores state and retains the journal when journal clear repeatedly fails", async () => {
  const { calls, committer } = recordingCommitter();
  let pending: RefreshCommitJournalRecord | undefined;
  let clearCalls = 0;

  committer.journal = {
    async read() {
      return pending;
    },
    async write(record) {
      pending = record;
    },
    async clear() {
      clearCalls += 1;
      throw new Error("journal clear failed");
    },
  };

  await assert.rejects(
    () => commitRefreshRun(testRun(), committer),
    /recovery journal could not be cleared/,
  );

  assert.equal(clearCalls, 2);
  assert.equal(pending?.runId, "run-commit");
  assert.deepEqual(calls.slice(-3), ["restore:cursor", "restore:seen", "restore:run"]);
});

test("recoverPendingRefreshCommit stops startup and keeps a journal whose clear fails", async () => {
  const record: RefreshCommitJournalRecord = {
    version: "refresh-commit-v1",
    runId: "startup-recovery",
    createdAt: "2026-06-08T00:00:00.000Z",
    checkpoints: {
      run: { runs: [] },
      seen: { records: [] },
      cursor: {},
    },
  };
  const calls: string[] = [];
  let pending: RefreshCommitJournalRecord | undefined = record;

  await assert.rejects(
    () =>
      recoverPendingRefreshCommit({
        repository: {
          async save() {},
          async checkpoint() {
            return { runs: [] };
          },
          async restore() {
            calls.push("restore:run");
          },
        },
        seenRepository: {
          async markRunShown() {},
          async checkpoint() {
            return { records: [] };
          },
          async restore() {
            calls.push("restore:seen");
          },
        },
        timelineCursor: {
          async updateFromRun() {},
          async checkpoint() {
            return {};
          },
          async restore() {
            calls.push("restore:cursor");
          },
        },
        journal: {
          async read() {
            return pending;
          },
          async write(next) {
            pending = next;
          },
          async clear() {
            throw new Error("clear unavailable");
          },
        },
      }),
    /startup must retry/,
  );

  assert.deepEqual(calls, ["restore:cursor", "restore:seen", "restore:run"]);
  assert.equal(pending, record);
});

test("commitRefreshRun never overwrites an unfinished recovery journal", async () => {
  const { calls, committer } = recordingCommitter();
  const pending: RefreshCommitJournalRecord = {
    version: "refresh-commit-v1",
    runId: "older-unfinished-run",
    createdAt: "2026-06-07T00:00:00.000Z",
    checkpoints: {
      run: { runs: [] },
      seen: { records: [] },
      cursor: {},
    },
  };

  committer.journal = {
    async read() {
      return pending;
    },
    async write() {
      assert.fail("must not overwrite pending journal");
    },
    async clear() {
      assert.fail("must not clear pending journal without recovery");
    },
  };

  await assert.rejects(
    () => commitRefreshRun(testRun({ id: "new-run" }), committer),
    /older-unfinished-run must be recovered/,
  );

  assert.deepEqual(calls, []);
});

test("FileRefreshCommitJournal refuses to replace pending recovery evidence", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xpulse-commit-journal-"));
  const journal = new FileRefreshCommitJournal(join(directory, "commit-journal.json"));
  const first: RefreshCommitJournalRecord = {
    version: "refresh-commit-v1",
    runId: "first-pending-run",
    createdAt: "2026-06-07T00:00:00.000Z",
    checkpoints: { run: { runs: [] }, seen: { records: [] }, cursor: {} },
  };
  const second: RefreshCommitJournalRecord = {
    ...first,
    runId: "second-run",
  };

  try {
    await journal.write(first);
    await assert.rejects(
      () => journal.write(second),
      /first-pending-run must be recovered/,
    );
    assert.deepEqual(await journal.read(), first);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
