import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  loadHistoricalDisplayInventoryRuns,
  selectHistoricalDisplayInventoryRuns,
} from "../../scripts/display-inventory-history-runs.mjs";

function run(overrides: Record<string, unknown> = {}) {
  return {
    id: "run-1",
    source: "x",
    createdAt: "2026-06-10T00:00:00.000Z",
    trace: {
      inputPosts: [{ post: { id: "post-1" }, fetchIndex: 0 }],
    },
    ...overrides,
  };
}

test("historical inventory run selection keeps eligible live X runs newest first", () => {
  const selected = selectHistoricalDisplayInventoryRuns([
    run({ id: "older", createdAt: "2026-06-09T00:00:00.000Z" }),
    run({ id: "replay", source: "replay", createdAt: "2026-06-12T00:00:00.000Z" }),
    run({ id: "missing-trace", trace: undefined, createdAt: "2026-06-13T00:00:00.000Z" }),
    run({ id: "empty-trace", trace: { inputPosts: [] }, createdAt: "2026-06-14T00:00:00.000Z" }),
    run({ id: "newer", createdAt: "2026-06-11T00:00:00.000Z" }),
  ], 20);

  assert.deepEqual(selected.map((item: any) => item.id), ["newer", "older"]);
});

test("historical inventory run selection applies the configured history limit", () => {
  const selected = selectHistoricalDisplayInventoryRuns([
    run({ id: "oldest", createdAt: "2026-06-08T00:00:00.000Z" }),
    run({ id: "newest", createdAt: "2026-06-10T00:00:00.000Z" }),
    run({ id: "middle", createdAt: "2026-06-09T00:00:00.000Z" }),
  ], 2);

  assert.deepEqual(selected.map((item: any) => item.id), ["newest", "middle"]);
});

test("historical inventory run loading returns an empty list when the store is missing", () => {
  const selected = loadHistoricalDisplayInventoryRuns(
    join(tmpdir(), `xpulse-missing-runs-${Date.now()}.json`),
    20,
  );

  assert.deepEqual(selected, []);
});

test("historical inventory run loading reads the store and applies selection rules", () => {
  const directory = mkdtempSync(join(tmpdir(), "xpulse-history-runs-"));
  const storePath = join(directory, "runs.json");

  try {
    writeFileSync(storePath, JSON.stringify({
      runs: [
        run({ id: "older", createdAt: "2026-06-09T00:00:00.000Z" }),
        run({ id: "newer", createdAt: "2026-06-11T00:00:00.000Z" }),
        run({ id: "replay", source: "replay", createdAt: "2026-06-12T00:00:00.000Z" }),
      ],
    }));

    const selected = loadHistoricalDisplayInventoryRuns(storePath, 1);

    assert.deepEqual(selected.map((item: any) => item.id), ["newer"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("historical inventory run loading does not hide malformed store data", () => {
  const directory = mkdtempSync(join(tmpdir(), "xpulse-history-runs-invalid-"));
  const storePath = join(directory, "runs.json");

  try {
    writeFileSync(storePath, "{not-json", "utf8");

    assert.throws(
      () => loadHistoricalDisplayInventoryRuns(storePath, 20),
      SyntaxError,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
