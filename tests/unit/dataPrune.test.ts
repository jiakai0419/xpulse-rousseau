import assert from "node:assert/strict";
import test from "node:test";
import {
  generatedEvidenceFamily,
  planGeneratedEvidencePrune,
} from "../../scripts/data-prune-core.mjs";

test("generatedEvidenceFamily only accepts known timestamped generated report directories", () => {
  assert.equal(
    generatedEvidenceFamily("display-oracle/display-oracle-2026-07-12T12-10-21-992Z")?.id,
    "display-oracle/display-oracle-",
  );
  assert.equal(generatedEvidenceFamily("display-gap-inventory/display-gap-baseline-225-2026-06-14"), undefined);
  assert.equal(generatedEvidenceFamily("display-original-evidence/original-screenshots"), undefined);
  assert.equal(
    generatedEvidenceFamily("ui-smoke/ui-smoke-2026-07-12T12-10-21-992Z-123.png")?.id,
    "ui-smoke/ui-smoke-",
  );
  assert.equal(generatedEvidenceFamily("runs.json"), undefined);
  assert.equal(generatedEvidenceFamily("unknown/report-2026-07-12T12-10-21-992Z"), undefined);
});

test("prune plan keeps a bounded newest set without touching baselines or unknown data", () => {
  const entries = [
    "display-oracle/display-oracle-2026-07-12T12-10-21-992Z",
    "display-oracle/display-oracle-2026-07-11T12-10-21-992Z",
    "display-oracle/display-oracle-2026-07-10T12-10-21-992Z",
    "display-gap-inventory/display-gap-baseline-225-2026-06-14",
    "display-original-evidence/original-screenshots",
  ].map((relativePath, index) => ({ relativePath, path: `/tmp/${index}`, bytes: 100 }));

  const plan = planGeneratedEvidencePrune(entries, { keep: 2 });

  assert.deepEqual(plan.remove.map((entry) => entry.relativePath), [
    "display-oracle/display-oracle-2026-07-10T12-10-21-992Z",
  ]);
  assert.equal(plan.removableBytes, 100);
  assert.equal(plan.preserved.length, 2);
  assert.equal(plan.retain.length, 2);
});
