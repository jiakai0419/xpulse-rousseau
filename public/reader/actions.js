import { escapeHtml, formatMetric } from "./format.js";

const dimensionLabels = {
  immediateValue: "立即值得看",
  informationDensity: "信息密度",
};

const metricIcons = {
  replies: '<path d="M6.4 17.5c-1.8-1.4-2.9-3.4-2.9-5.6 0-4.1 3.8-7.4 8.5-7.4s8.5 3.3 8.5 7.4-3.8 7.4-8.5 7.4c-.9 0-1.8-.1-2.6-.4L5.6 21l.8-3.5Z" />',
  reposts: '<path d="M7 7h8.8c2.1 0 3.7 1.7 3.7 3.7v.4" /><path d="m16.6 4.2 3.4 3.4-3.4 3.4" /><path d="M17 17H8.2c-2.1 0-3.7-1.7-3.7-3.7v-.4" /><path d="m7.4 20.8-3.4-3.4 3.4-3.4" />',
  likes: '<path d="M12 20.5s-7.5-4.4-8.9-9.1C2.2 8.2 4 5.5 7 5.5c1.8 0 3.2 1 4 2.4.8-1.4 2.2-2.4 4-2.4 3 0 4.8 2.7 3.9 5.9-1.4 4.7-8.9 9.1-8.9 9.1Z" />',
  views: '<path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" />',
  signal: '<path d="M4 12h3.2l2.1-5 4.4 10 2.1-5H20" />',
};

export function metricIcon(name) {
  return `
    <svg class="metric-icon" viewBox="0 0 24 24" aria-hidden="true">
      ${metricIcons[name] ?? ""}
    </svg>
  `;
}

export function signalTotalScale(score) {
  const declaredScale = score?.totalScale ?? score?.format?.totalScale ?? score?.scale;

  if (declaredScale === 10 || declaredScale === "0-10") {
    return 10;
  }

  return 100;
}

export function formatSignalScore(value, scale = 100) {
  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return "0.0";
  }

  const normalized = scale === 10 ? numeric : numeric / 10;
  const clamped = Math.max(0, Math.min(10, normalized));

  return clamped.toFixed(1);
}

export function renderSignal(score) {
  const dimensions = (score.dimensions ?? [])
    .map((dimension) => {
      const label = dimensionLabels[dimension.key] ?? dimension.label;

      return `
        <div class="signal-meter" title="${escapeHtml(dimension.reason)}">
          <div class="signal-meter-head">
            <span class="signal-dimension-label">${escapeHtml(label)}</span>
            <strong class="signal-score">${escapeHtml(dimension.score.toFixed(1))}</strong>
          </div>
          <p>${escapeHtml(dimension.reason)}</p>
        </div>
      `;
    })
    .join("");

  const totalScore = formatSignalScore(score.total, signalTotalScale(score));

  return `
    <div class="signal-details">
      <button class="signal-summary" type="button" aria-expanded="false" aria-label="Signal: ${escapeHtml(totalScore)} out of 10" title="Signal: ${escapeHtml(totalScore)} / 10">
        ${metricIcon("signal")}
        <strong class="signal-score signal-summary-score">${escapeHtml(totalScore)}</strong>
        <span class="signal-summary-caret" aria-hidden="true"></span>
      </button>
      <div class="signal-body" hidden>
        ${dimensions}
      </div>
    </div>
  `;
}

export function renderMetricItem(key, label, value) {
  const formatted = formatMetric(value);

  return `
    <span class="metric-item metric-${escapeHtml(key)}" aria-label="${escapeHtml(label)}: ${escapeHtml(formatted)}" title="${escapeHtml(label)}: ${escapeHtml(formatted)}">
      ${metricIcon(key)}
      <span class="metric-count">${escapeHtml(formatted)}</span>
    </span>
  `;
}

export function renderMetrics(metrics) {
  return `
    <div class="metrics-row" aria-label="Post metrics">
      ${renderMetricItem("replies", "Replies", metrics.replies)}
      ${renderMetricItem("reposts", "Reposts", metrics.reposts)}
      ${renderMetricItem("likes", "Likes", metrics.likes)}
      ${renderMetricItem("views", "Views", metrics.impressions)}
    </div>
  `;
}
