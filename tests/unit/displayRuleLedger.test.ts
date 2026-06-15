import assert from "node:assert/strict";
import { test } from "node:test";
import {
  explainDiffWithLedger,
  inventoryReferencesForRule,
  readDisplayRuleLedger,
  validateDisplayRuleLedger,
} from "../../scripts/display-rule-ledger.mjs";

test("display rule ledger validates the checked-in rendering rules", () => {
  const ledger = readDisplayRuleLedger();
  assert.deepEqual(validateDisplayRuleLedger(ledger), []);
});

test("display rule ledger explains oracle diffs and references inventory categories", () => {
  const ledger = readDisplayRuleLedger();
  const rule = ledger.rules.find((item) => item.id === "x_article_card_rendering");

  assert.equal(explainDiffWithLedger("original_has_x_article_card_local_has_placeholder", ledger), "x_article_card_rendering");
  assert.deepEqual(inventoryReferencesForRule(rule), {
    buckets: ["x-article-link", "quote-x-article-link"],
    risks: ["main_x_article_link", "quote_x_article_link", "quote_x_article_card_likely"],
  });
});

test("display rule ledger reports duplicate oracle diff ownership", () => {
  const issues = validateDisplayRuleLedger({
    version: 1,
    rules: [
      {
        id: "one",
        status: "accepted",
        confidence: "high",
        inventoryBuckets: ["text-only"],
        inventoryRisks: [],
        oracleDiffs: ["same_diff"],
        evidenceRequired: ["local facts", "Original facts"],
        observedXBehavior: "A",
        readerRule: "B",
      },
      {
        id: "two",
        status: "accepted",
        confidence: "high",
        inventoryBuckets: ["text-only"],
        inventoryRisks: [],
        oracleDiffs: ["same_diff"],
        evidenceRequired: ["local facts", "Original facts"],
        observedXBehavior: "A",
        readerRule: "B",
      },
    ],
  });

  assert.ok(issues.includes("two:oracle_diff_already_owned_by:one:same_diff"));
});

test("display rule ledger requires inventory references and evidence shape", () => {
  const issues = validateDisplayRuleLedger({
    version: 1,
    rules: [
      {
        id: "thin_rule",
        status: "accepted",
        inventoryBuckets: ["text-only"],
        oracleDiffs: ["thin_diff"],
        observedXBehavior: "A",
        readerRule: "B",
      },
    ],
  });

  assert.ok(issues.includes("thin_rule:invalid_confidence"));
  assert.ok(issues.includes("thin_rule:inventory_risks_must_be_array"));
  assert.ok(issues.includes("thin_rule:missing_evidence_required"));
});
