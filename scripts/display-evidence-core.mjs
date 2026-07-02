import { existsSync } from "node:fs";
import { originalScreenshotQualityIssues } from "./display-screenshot-quality.mjs";

export function numberValue(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

export function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

export function textValue(value) {
  return String(value ?? "");
}

export function contentfulScreenshotProbe(probe) {
  return Boolean(probe && probe.blank === false && !String(probe.reason ?? "").startsWith("probe_failed"));
}

export function evidencePostId(evidence) {
  return textValue(evidence?.id ?? evidence?.postId ?? evidence?.displayPost?.id);
}

export function originalEvidenceById(originalEntries) {
  const byId = new Map();
  for (const entry of arrayValue(originalEntries)) {
    const id = evidencePostId(entry);
    if (id) {
      byId.set(id, entry);
    }
  }
  return byId;
}

export function normalizeOriginalEvidenceDocument(document) {
  if (Array.isArray(document)) {
    return document;
  }

  if (Array.isArray(document?.entries)) {
    return document.entries;
  }

  if (Array.isArray(document?.originalEntries)) {
    return document.originalEntries;
  }

  return [];
}

export function localEvidenceIssues(sample) {
  const issues = [];

  if (!sample?.localScreenshot) {
    issues.push("missing_local_screenshot");
  } else if (!existsSync(sample.localScreenshot)) {
    issues.push("local_screenshot_file_missing");
  }

  if (!contentfulScreenshotProbe(sample?.localScreenshotProbe)) {
    issues.push(sample?.localScreenshotProbe?.blank ? `local_screenshot_blank:${sample.localScreenshotProbe.reason}` : "missing_local_screenshot_probe");
  }

  if (!sample?.localFacts) {
    issues.push("missing_local_facts");
  }

  return issues;
}

export function oracleOriginalEvidenceIssues(original) {
  const issues = [];

  if (!original) {
    issues.push("missing_original_evidence");
    return issues;
  }

  if (!original.screenshot) {
    issues.push("missing_original_screenshot");
  } else if (!existsSync(original.screenshot)) {
    issues.push("original_screenshot_file_missing");
  }

  if (!contentfulScreenshotProbe(original.probe)) {
    issues.push(original?.probe?.blank ? `original_screenshot_blank:${original.probe.reason}` : "missing_original_screenshot_probe");
  }

  for (const qualityIssue of originalScreenshotQualityIssues(original)) {
    issues.push(qualityIssue);
  }

  if (!original.facts) {
    issues.push("missing_original_facts");
  } else if (original.facts.foundExactArticle === false) {
    issues.push("original_exact_article_not_found");
  }

  return issues;
}

export function originalEvidenceValidationIssues(entry) {
  const issues = [];
  const postId = evidencePostId(entry);

  if (!postId) {
    issues.push("missing_post_id");
  }

  if (!entry?.screenshot) {
    issues.push("missing_screenshot");
  } else if (!existsSync(entry.screenshot)) {
    issues.push("screenshot_file_missing");
  }

  if (!contentfulScreenshotProbe(entry?.probe)) {
    issues.push(entry?.probe?.blank ? `screenshot_blank:${entry.probe.reason}` : "missing_contentful_probe");
  }

  for (const qualityIssue of originalScreenshotQualityIssues(entry)) {
    issues.push(qualityIssue);
  }

  if (!entry?.facts) {
    issues.push("missing_facts");
  } else if (entry.facts.foundExactArticle === false) {
    issues.push("exact_article_not_found");
  }

  return issues;
}

export function validOriginalEvidenceEntry(entry) {
  const issues = originalEvidenceValidationIssues(entry);

  return {
    valid: issues.length === 0,
    issues,
  };
}

export function mergeOriginalEvidenceEntries(existingEntries, importedEntries, importedAt = new Date().toISOString()) {
  const byId = new Map();

  for (const entry of arrayValue(existingEntries)) {
    const id = evidencePostId(entry);
    if (id) {
      byId.set(id, entry);
    }
  }

  for (const entry of arrayValue(importedEntries)) {
    const id = evidencePostId(entry);
    if (id) {
      byId.set(id, {
        ...entry,
        importedAt,
      });
    }
  }

  return [...byId.values()].sort((left, right) => evidencePostId(left).localeCompare(evidencePostId(right)));
}

export function originalEvidenceCoverage(samples, entries) {
  const byId = originalEvidenceById(entries);
  const covered = [];
  const invalid = [];
  const missing = [];

  for (const sample of arrayValue(samples)) {
    const postId = String(sample.postId ?? "");
    const entry = byId.get(postId);
    if (!entry) {
      missing.push(sample);
      continue;
    }

    const validation = validOriginalEvidenceEntry(entry);
    if (validation.valid) {
      covered.push({ sample, entry });
    } else {
      invalid.push({ sample, entry, issues: validation.issues });
    }
  }

  return {
    covered,
    invalid,
    missing,
  };
}
