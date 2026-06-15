import { existsSync } from "node:fs";
import { contentfulScreenshotProbe, evidencePostId } from "./display-oracle-core.mjs";
import { originalScreenshotQualityIssues } from "./display-screenshot-quality.mjs";

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

export function validOriginalEvidenceEntry(entry) {
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

  return {
    valid: issues.length === 0,
    issues,
  };
}

export function mergeOriginalEvidenceEntries(existingEntries, importedEntries, importedAt = new Date().toISOString()) {
  const byId = new Map();

  for (const entry of existingEntries) {
    const id = evidencePostId(entry);
    if (id) {
      byId.set(id, entry);
    }
  }

  for (const entry of importedEntries) {
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
  const byId = new Map();
  for (const entry of entries) {
    const id = evidencePostId(entry);
    if (id) {
      byId.set(id, entry);
    }
  }

  const covered = [];
  const invalid = [];
  const missing = [];

  for (const sample of samples) {
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
