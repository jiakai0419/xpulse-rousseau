import { originalScreenshotQualityIssues } from "./display-screenshot-quality.mjs";

export function sanitizeOriginalCaptureSlug(value) {
  return (
    String(value ?? "unknown")
      .replace(/^@/, "")
      .replace(/[^a-zA-Z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "unknown"
  );
}

export function originalCaptureAuthorSlug(sample) {
  return sample?.author?.username ?? sample?.author?.name ?? sample?.author ?? "unknown";
}

export function originalCaptureTarget(sampleOrPostId) {
  if (typeof sampleOrPostId === "object" && sampleOrPostId) {
    return {
      postId: String(sampleOrPostId.postId ?? sampleOrPostId.id),
      textStart: String(sampleOrPostId.textStart ?? ""),
    };
  }

  return {
    postId: String(sampleOrPostId),
    textStart: "",
  };
}

export function contentfulOriginalProbeResult(probe) {
  return Boolean(probe?.blank === false && !String(probe?.reason ?? "").startsWith("probe_failed"));
}

export function originalProbeMatchesCssClip(probe, clip) {
  if (!clip) {
    return true;
  }

  const probeWidth = positiveNumber(probe?.width);
  const clipWidth = positiveNumber(clip.width);

  if (!probeWidth || !clipWidth) {
    return true;
  }

  return Math.abs(probeWidth - clipWidth) <= 80;
}

export function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function scaleClipForScreenshot(clip, viewport, imageDimensions) {
  const imageWidth = positiveNumber(imageDimensions?.width);
  const imageHeight = positiveNumber(imageDimensions?.height);
  const viewportWidth = positiveNumber(viewport?.width);
  const viewportHeight = positiveNumber(viewport?.height);

  if (!clip || !imageWidth || !imageHeight) {
    return undefined;
  }

  const scaleX = viewportWidth ? imageWidth / viewportWidth : 1;
  const scaleY = viewportHeight ? imageHeight / viewportHeight : scaleX;
  const x = Math.max(0, Math.min(Math.floor(positiveNumber(clip.x) * scaleX), imageWidth - 1));
  const y = Math.max(0, Math.min(Math.floor(positiveNumber(clip.y) * scaleY), imageHeight - 1));
  const width = Math.max(1, Math.min(Math.ceil(positiveNumber(clip.width) * scaleX), imageWidth - x));
  const height = Math.max(1, Math.min(Math.ceil(positiveNumber(clip.height) * scaleY), imageHeight - y));

  return {
    x,
    y,
    width,
    height,
  };
}

export function originalValidationErrors(facts, probe, screenshotQuality) {
  const validationErrors = [];

  if (!facts?.foundExactArticle) {
    validationErrors.push("original_exact_article_not_found");
  }

  if (!probe || probe.blank || String(probe.reason ?? "").startsWith("probe_failed")) {
    validationErrors.push(probe?.blank ? `original_screenshot_blank:${probe.reason}` : "missing_original_screenshot_probe");
  }

  for (const qualityIssue of originalScreenshotQualityIssues({ facts, probe, screenshotQuality })) {
    validationErrors.push(qualityIssue);
  }

  return validationErrors;
}

export function retryableOriginalValidationIssue(issue) {
  return (
    issue.startsWith("original_screenshot_blank:") ||
    issue === "missing_original_screenshot_probe" ||
    issue.startsWith("original_screenshot_not_target_article:") ||
    issue === "original_screenshot_likely_viewport_capture" ||
    issue === "original_screenshot_missing_capture_method" ||
    issue === "original_screenshot_clip_width_mismatch" ||
    issue === "original_screenshot_clip_x_mismatch" ||
    issue === "original_screenshot_probe_width_mismatch" ||
    issue === "original_screenshot_likely_interstitial" ||
    issue === "original_screenshot_right_rail_risk"
  );
}

export function retryableOriginalCaptureErrors(validationErrors, error) {
  if (error) {
    return !/original_requires_auth/i.test(String(error instanceof Error ? error.message : error));
  }

  return validationErrors.length > 0 && validationErrors.every(retryableOriginalValidationIssue);
}
