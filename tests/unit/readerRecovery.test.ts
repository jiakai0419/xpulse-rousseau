import assert from "node:assert/strict";
import { test } from "node:test";
import { pulseJobRecovery, shouldApplyLatestRun } from "../../public/reader/recovery.js";

test("pulseJobRecovery follows running jobs and renders completed jobs", () => {
  const running = { id: "job-1", status: "running" };
  const run = { id: "run-1", selectedPosts: [] };

  assert.deepEqual(pulseJobRecovery(running), { kind: "follow", job: running });
  assert.deepEqual(pulseJobRecovery({ id: "job-1", status: "completed", run }), { kind: "render", run });
});

test("pulseJobRecovery keeps failed job errors visible after recovery", () => {
  assert.deepEqual(pulseJobRecovery({ id: "job-1", status: "failed", error: "OpenAI timed out" }), {
    kind: "error",
    message: "OpenAI timed out",
  });
  assert.deepEqual(
    pulseJobRecovery({ id: "job-2", status: "failed", progress: { detail: "X request failed" } }),
    { kind: "error", message: "X request failed" },
  );
});

test("pulseJobRecovery rejects incomplete or unknown job payloads", () => {
  assert.deepEqual(pulseJobRecovery(undefined), { kind: "none" });
  assert.deepEqual(pulseJobRecovery({ id: "job-1", status: "completed" }), { kind: "none" });
  assert.deepEqual(pulseJobRecovery({ id: "job-1", status: "unknown" }), { kind: "none" });
});

test("stale latest responses cannot overwrite a newer recovery or Pulse result", () => {
  assert.equal(shouldApplyLatestRun(3, 3), true);
  assert.equal(shouldApplyLatestRun(3, 4), false);
});

test("a delayed stored-job recovery cannot overwrite or clear a newer Pulse generation", () => {
  const recoveryRequestGeneration = 7;
  const generationAfterNewPulseStarted = 8;

  assert.equal(shouldApplyLatestRun(recoveryRequestGeneration, generationAfterNewPulseStarted), false);
});
