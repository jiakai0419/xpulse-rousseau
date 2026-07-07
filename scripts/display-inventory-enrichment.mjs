import { existsSync, readFileSync } from "node:fs";
import {
  enrichPostXArticlePreviewsFromEvidence,
  refreshInventorySampleDerivedFields,
} from "./display-inventory-samples.mjs";

export function originalEvidenceEntriesFromStorePayload(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }

  return Array.isArray(payload?.entries) ? payload.entries : [];
}

export function readOriginalEvidenceEntries(filePath, options = {}) {
  const enabled = options.enabled ?? true;
  if (!enabled || !existsSync(filePath)) {
    return [];
  }

  return originalEvidenceEntriesFromStorePayload(JSON.parse(readFileSync(filePath, "utf8")));
}

export function originalEvidenceByPostIdFromEntries(entries) {
  const byId = new Map();
  for (const entry of entries ?? []) {
    const id = String(entry?.id ?? entry?.postId ?? "");
    if (id) {
      byId.set(id, entry);
    }
  }

  return byId;
}

export function applyOriginalEvidenceXArticlePreviews(samples, entries) {
  const originalEvidence = originalEvidenceByPostIdFromEntries(entries);
  let applied = 0;

  for (const sample of samples ?? []) {
    const entry = originalEvidence.get(sample.displayPost.id);
    const sampleApplied = entry ? enrichPostXArticlePreviewsFromEvidence(sample.timelinePost, entry) : 0;
    sample.xArticlePreviewEvidenceApplied = sampleApplied;
    applied += sampleApplied;
  }

  return {
    samples: samples?.length ?? 0,
    xArticlePreviewEvidenceApplied: applied,
  };
}

export async function enrichDisplayInventorySamples(samples, options = {}) {
  const enrichLinkPreviews = options.enrichLinkPreviews ?? true;
  if (!enrichLinkPreviews || !samples?.length) {
    return {
      samples: samples?.length ?? 0,
      linkPreviewEnriched: false,
      xArticlePreviewEvidenceApplied: 0,
      refreshed: false,
    };
  }

  if (typeof options.enrichSelectedPostLinkPreviews === "function") {
    await options.enrichSelectedPostLinkPreviews(
      samples.map((sample) => sample.timelinePost),
      { cache: options.linkPreviewCache },
    );
  }

  const xArticleSummary = options.enrichXArticlePreviews === false
    ? { samples: samples.length, xArticlePreviewEvidenceApplied: 0 }
    : applyOriginalEvidenceXArticlePreviews(samples, options.originalEvidenceEntries ?? []);

  for (const sample of samples) {
    refreshInventorySampleDerivedFields(sample);
  }

  return {
    samples: samples.length,
    linkPreviewEnriched: typeof options.enrichSelectedPostLinkPreviews === "function",
    xArticlePreviewEvidenceApplied: xArticleSummary.xArticlePreviewEvidenceApplied,
    refreshed: true,
  };
}
