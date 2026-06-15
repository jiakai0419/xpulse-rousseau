import { readFileSync } from "node:fs";

export const defaultRuleLedgerPath = "docs/display-rule-ledger.json";

export function readDisplayRuleLedger(filePath = defaultRuleLedgerPath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

export function validateDisplayRuleLedger(ledger) {
  const issues = [];
  const ruleIds = new Set();
  const diffOwners = new Map();

  if (ledger?.version !== 1) {
    issues.push("ledger_version_must_be_1");
  }

  if (!Array.isArray(ledger?.rules)) {
    issues.push("ledger_rules_must_be_array");
    return issues;
  }

  for (const [index, rule] of ledger.rules.entries()) {
    const label = rule?.id || `rule_${index}`;
    if (!rule?.id) {
      issues.push(`${label}:missing_id`);
    } else if (ruleIds.has(rule.id)) {
      issues.push(`${label}:duplicate_id`);
    } else {
      ruleIds.add(rule.id);
    }

    if (!["accepted", "open", "hypothesis"].includes(rule?.status)) {
      issues.push(`${label}:invalid_status`);
    }

    if (!["high", "medium", "low"].includes(rule?.confidence)) {
      issues.push(`${label}:invalid_confidence`);
    }

    if (!Array.isArray(rule?.inventoryBuckets) || !rule.inventoryBuckets.length) {
      issues.push(`${label}:missing_inventory_buckets`);
    }

    if (!Array.isArray(rule?.inventoryRisks)) {
      issues.push(`${label}:inventory_risks_must_be_array`);
    }

    if (!Array.isArray(rule?.oracleDiffs) || !rule.oracleDiffs.length) {
      issues.push(`${label}:missing_oracle_diffs`);
    }

    if (!Array.isArray(rule?.evidenceRequired) || !rule.evidenceRequired.length) {
      issues.push(`${label}:missing_evidence_required`);
    }

    for (const diff of rule?.oracleDiffs ?? []) {
      if (diffOwners.has(diff)) {
        issues.push(`${label}:oracle_diff_already_owned_by:${diffOwners.get(diff)}:${diff}`);
      } else {
        diffOwners.set(diff, rule.id);
      }
    }

    if (!rule?.observedXBehavior) {
      issues.push(`${label}:missing_observed_x_behavior`);
    }

    if (!rule?.readerRule) {
      issues.push(`${label}:missing_reader_rule`);
    }
  }

  return issues;
}

export function ruleByOracleDiff(ledger) {
  const byDiff = new Map();
  for (const rule of ledger?.rules ?? []) {
    for (const diff of rule.oracleDiffs ?? []) {
      byDiff.set(diff, rule);
    }
  }
  return byDiff;
}

export function explainDiffWithLedger(diff, ledger = readDisplayRuleLedger()) {
  return ruleByOracleDiff(ledger).get(diff)?.id ?? "unexplained_display_diff";
}

export function inventoryReferencesForRule(rule) {
  return {
    buckets: rule.inventoryBuckets ?? [],
    risks: rule.inventoryRisks ?? [],
  };
}

if (process.argv[1] && process.argv[1].endsWith("display-rule-ledger.mjs")) {
  const ledgerPath = process.env.DISPLAY_RULE_LEDGER || defaultRuleLedgerPath;
  const ledger = readDisplayRuleLedger(ledgerPath);
  const issues = validateDisplayRuleLedger(ledger);

  if (issues.length) {
    console.error(`Display Rule Ledger has ${issues.length} issue(s):`);
    for (const issue of issues) {
      console.error(`- ${issue}`);
    }
    process.exitCode = 1;
  } else {
    console.log(`OK display rule ledger: ${ledger.rules.length} rules.`);
  }
}
