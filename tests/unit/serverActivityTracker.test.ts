import assert from "node:assert/strict";
import { test } from "node:test";
import { ActivityTracker } from "../../src/server/activityTracker.ts";

test("ActivityTracker resolves shutdown only after every in-flight request finishes", async () => {
  const tracker = new ActivityTracker();
  const finishFirst = tracker.enter();
  const finishSecond = tracker.enter();
  let idle = false;
  const idleBoundary = tracker.whenIdle().then(() => {
    idle = true;
  });

  finishFirst();
  await Promise.resolve();
  assert.equal(idle, false);

  finishFirst();
  finishSecond();
  await idleBoundary;
  assert.equal(idle, true);
  await tracker.whenIdle();
});
