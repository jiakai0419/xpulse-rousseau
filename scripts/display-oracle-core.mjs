import { existsSync } from "node:fs";
import { explainDiffWithLedger, readDisplayRuleLedger } from "./display-rule-ledger.mjs";
import { originalScreenshotQualityIssues } from "./display-screenshot-quality.mjs";

function numberValue(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function textValue(value) {
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

export function localVideoCount(localFacts) {
  return arrayValue(localFacts?.videos).length;
}

export function originalVideos(originalFacts) {
  return arrayValue(originalFacts?.media).filter((item) => item?.tag === "video");
}

export function originalImages(originalFacts) {
  return arrayValue(originalFacts?.media).filter((item) => item?.tag === "img");
}

export function localLinkCards(localFacts) {
  return arrayValue(localFacts?.linkCards);
}

export function originalPrimaryCardCount(originalFacts) {
  const wrappers = arrayValue(originalFacts?.cardWrappers);
  const primaryWrappers = wrappers.filter((wrapper) => wrapper?.testId === "card.wrapper");

  return primaryWrappers.length || wrappers.length;
}

export function localMediaItemCount(localFacts) {
  return arrayValue(localFacts?.mediaGrids).reduce((count, grid) => count + numberValue(grid?.mediaItems), 0);
}

export function originalHasXArticleCard(originalFacts) {
  const text = textValue(originalFacts?.textStart);
  return /(^|\n|\s)Article(\n|\s)/.test(text);
}

export function localLooksLikeXArticlePlaceholder(localFacts) {
  return arrayValue(localFacts?.quoteCards).some((quote) => /x\.com\/i\/article\//i.test(textValue(quote?.text)));
}

export function localExposesXArticleLink(localFacts) {
  const exposedLinks = [...arrayValue(localFacts?.inlineLinks), ...arrayValue(localFacts?.linkChips)];
  if (exposedLinks.some((link) => /(^|\s|https?:\/\/)(?:www\.)?(?:x|twitter)\.com\/i\/article\//i.test(`${textValue(link?.text)} ${textValue(link?.href)}`))) {
    return true;
  }

  return arrayValue(localFacts?.linkCards).some((link) => /(^|\s|https?:\/\/)(?:www\.)?(?:x|twitter)\.com\/i\/article\//i.test(textValue(link?.text)));
}

export function originalLooksLikeExpandedXArticle(originalFacts) {
  if (originalHasXArticleCard(originalFacts)) {
    return true;
  }

  return originalImages(originalFacts).length > 0 && textValue(originalFacts?.textStart).length > 300;
}

export function localExposesRawTco(localFacts) {
  const links = [...arrayValue(localFacts?.inlineLinks), ...arrayValue(localFacts?.linkChips), ...arrayValue(localFacts?.linkCards)];
  return links.some((link) => /(^|[\s/])t\.co\//i.test(textValue(link?.text)) || /^t\.co$/i.test(textValue(link?.text)));
}

export function originalVideoIsPlaying(originalFacts) {
  return originalVideos(originalFacts).some((video) => video?.paused === false && numberValue(video?.currentTime) > 0.1);
}

export function localVideoIsPlaying(localFacts) {
  return arrayValue(localFacts?.videos).some((video) => video?.paused === false && numberValue(video?.currentTime) > 0.1);
}

function missingEvidenceIssues(sample, original) {
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

function factDiffs(sample, original) {
  const diffs = [];
  const flags = sample?.flags ?? {};
  const localFacts = sample?.localFacts;
  const originalFacts = original?.facts;
  const localVideos = localVideoCount(localFacts);
  const xVideos = originalVideos(originalFacts);
  const xImages = originalImages(originalFacts);
  const localMediaItems = localMediaItemCount(localFacts);
  const localCards = localLinkCards(localFacts).length;
  const originalCards = originalPrimaryCardCount(originalFacts);
  const risks = new Set(arrayValue(sample?.risks));
  const missingData = new Set(arrayValue(sample?.missingData));

  if (xVideos.length > 0 && localVideos === 0) {
    diffs.push("original_has_video_local_missing_video");
  }

  if (flags.playableVideo && localVideos === 0) {
    diffs.push("expected_playable_video_local_missing_video");
  }

  if (originalVideoIsPlaying(originalFacts) && !localVideoIsPlaying(localFacts)) {
    diffs.push("original_video_playing_local_not_playing");
  }

  if (Number(flags.mediaCount ?? 0) > 0 && xImages.length + xVideos.length > 0 && localMediaItems === 0) {
    diffs.push("original_has_media_local_missing_media");
  }

  if (localExposesRawTco(localFacts)) {
    diffs.push("local_exposes_raw_tco_text");
  }

  if (numberValue(flags.externalPreviewLinks) > 1 && localCards > 1 && originalCards <= 1) {
    diffs.push("local_renders_multiple_external_preview_cards");
  }

  if (numberValue(flags.externalNoPreviewLinks) > 0 && originalCards > 0 && localCards === 0) {
    diffs.push("original_has_external_preview_local_missing_card");
  }

  if (
    originalHasXArticleCard(originalFacts) &&
    localLooksLikeXArticlePlaceholder(localFacts) &&
    (risks.has("quote_x_article_card_likely") || risks.has("quote_x_article_link") || missingData.has("quoted_x_article_preview_metadata"))
  ) {
    diffs.push("original_has_x_article_card_local_has_placeholder");
  }

  if (
    localExposesXArticleLink(localFacts) &&
    originalLooksLikeExpandedXArticle(originalFacts) &&
    (risks.has("main_x_article_link") || missingData.has("x_article_preview_metadata"))
  ) {
    diffs.push("original_has_main_x_article_local_has_raw_link");
  }

  return [...new Set(diffs)].sort();
}

let cachedRuleLedger;

function ruleLedger() {
  cachedRuleLedger ??= readDisplayRuleLedger();
  return cachedRuleLedger;
}

export function explainDiff(diff) {
  return explainDiffWithLedger(diff, ruleLedger());
}

export function evaluateDisplayOracleSample(sample, original) {
  const blocked = missingEvidenceIssues(sample, original);
  const diffs = blocked.length ? [] : factDiffs(sample, original);
  const explanations = diffs.map((diff) => ({ diff, rule: explainDiff(diff) }));

  return {
    postId: textValue(sample?.postId ?? sample?.displayPost?.id),
    status: blocked.length ? "blocked" : diffs.length ? "failed" : "passed",
    blocked,
    factDiffs: diffs,
    explanations,
    unexplainedDiffs: explanations.filter((item) => item.rule === "unexplained_display_diff").map((item) => item.diff),
  };
}

export function evaluateDisplayOracle({ samples, originalEntries, selectedPostIds }) {
  const originals = originalEvidenceById(originalEntries);
  const selected = new Set(arrayValue(selectedPostIds).map(String));
  const scopedSamples = arrayValue(samples).filter((sample) => !selected.size || selected.has(String(sample.postId)));
  const results = scopedSamples.map((sample) => evaluateDisplayOracleSample(sample, originals.get(String(sample.postId))));

  return {
    sampleCount: scopedSamples.length,
    results,
    blockedCount: results.filter((result) => result.status === "blocked").length,
    failedCount: results.filter((result) => result.status === "failed").length,
    passedCount: results.filter((result) => result.status === "passed").length,
  };
}

export function displayOracleFailureIssues(summary, { allowDiffs = false, requireAllInventorySamples = false } = {}) {
  const issues = [];

  if (numberValue(summary?.blockedCount) > 0) {
    issues.push({
      kind: "blocked",
      count: numberValue(summary.blockedCount),
    });
  }

  if (numberValue(summary?.failedCount) > 0 && (!allowDiffs || requireAllInventorySamples)) {
    issues.push({
      kind: "failed",
      count: numberValue(summary.failedCount),
    });
  }

  return issues;
}
