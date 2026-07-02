function numberValue(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

function contentfulProbe(probe) {
  return Boolean(probe && probe.blank === false && !String(probe.reason ?? "").startsWith("probe_failed"));
}

export function buildOriginalScreenshotQuality({ screenshotMode, captureMethod, clip, facts, probe } = {}) {
  return {
    target: "original_article",
    mode: screenshotMode ?? "unknown",
    captureMethod,
    clip: clip
      ? {
          x: numberValue(clip.x),
          y: numberValue(clip.y),
          width: numberValue(clip.width),
          height: numberValue(clip.height),
        }
      : undefined,
    articleRect: facts?.articleRect,
    probe: probe
      ? {
          width: numberValue(probe.width),
          height: numberValue(probe.height),
          blank: Boolean(probe.blank),
          reason: probe.reason,
          whiteRatio: numberValue(probe.whiteRatio),
          darkRatio: numberValue(probe.darkRatio),
          variance: numberValue(probe.variance),
        }
      : undefined,
  };
}

export function originalScreenshotQualityIssues(entry) {
  const issues = [];
  const mode = entry?.screenshotMode ?? entry?.screenshotQuality?.mode;
  const captureMethod = entry?.captureMethod ?? entry?.screenshotQuality?.captureMethod;
  const probe = entry?.probe ?? entry?.screenshotQuality?.probe;
  const clip = entry?.screenshotQuality?.clip ?? entry?.clip;
  const articleRect = entry?.facts?.articleRect ?? entry?.screenshotQuality?.articleRect;

  if (!contentfulProbe(probe)) {
    return issues;
  }

  if (mode && mode !== "article_clip") {
    issues.push(`original_screenshot_not_target_article:${mode}`);
  }

  if (!mode && numberValue(probe?.width) >= 1200) {
    issues.push("original_screenshot_likely_viewport_capture");
  }

  if (mode === "article_clip" && !captureMethod) {
    issues.push("original_screenshot_missing_capture_method");
  }

  if (
    mode === "article_clip" &&
    numberValue(probe?.whiteRatio) >= 0.995 &&
    numberValue(probe?.darkRatio) <= 0.001 &&
    numberValue(probe?.variance) <= 60
  ) {
    issues.push("original_screenshot_likely_interstitial");
  }

  if (clip && articleRect) {
    const clipWidth = numberValue(clip.width);
    const articleWidth = numberValue(articleRect.width);
    const clipX = numberValue(clip.x);
    const articleX = numberValue(articleRect.x);

    if (clipWidth > 0 && articleWidth > 0 && Math.abs(clipWidth - articleWidth) > 80) {
      issues.push("original_screenshot_clip_width_mismatch");
    }

    if (Math.abs(clipX - articleX) > 80) {
      issues.push("original_screenshot_clip_x_mismatch");
    }

  }

  if (mode === "article_clip" && captureMethod !== "viewport_crop" && articleRect) {
    const probeWidth = numberValue(probe?.width);
    const articleWidth = numberValue(articleRect.width);

    if (probeWidth > 0 && articleWidth > 0 && Math.abs(probeWidth - articleWidth) > 80) {
      issues.push("original_screenshot_probe_width_mismatch");
    }
  }

  if (entry?.screenshotQuality?.rightRailRisk === true) {
    issues.push("original_screenshot_right_rail_risk");
  }

  return unique(issues);
}
