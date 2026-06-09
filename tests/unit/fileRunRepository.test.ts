import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { RefreshRun, TimelineSource } from "../../src/domain/tweet.ts";
import { FileRunRepository } from "../../src/services/storage/fileRunRepository.ts";

function testRun(id: string, source: TimelineSource): RefreshRun {
  return {
    id,
    createdAt: "2026-06-05T00:00:00.000Z",
    source,
    stats: {
      fetched: 1,
      adsExcluded: 0,
      duplicatesExcluded: 0,
      scored: 1,
      selected: 1,
    },
    selectedPosts: [],
    usage: [],
  };
}

test("FileRunRepository keeps the latest live X run when replay history rolls over", async () => {
  const dir = await mkdtemp(join(tmpdir(), "xpulse-run-store-"));
  const filePath = join(dir, "runs.json");
  const repository = new FileRunRepository(filePath);

  try {
    await repository.save(testRun("live-1", "x"));

    for (let index = 1; index <= 25; index += 1) {
      await repository.save(testRun(`replay-${index}`, "replay"));
    }

    const latest = await repository.latest();
    const latestLive = await repository.latestBySource("x");
    const store = JSON.parse(await readFile(filePath, "utf8")) as { runs: RefreshRun[] };

    assert.equal(latest?.id, "replay-25");
    assert.equal(latestLive?.id, "live-1");
    assert.equal(store.runs.length, 20);
    assert.ok(store.runs.some((run) => run.id === "live-1"));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
