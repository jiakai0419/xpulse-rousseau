import assert from "node:assert/strict";
import { test } from "node:test";
import { formatSignalScore, metricIcon, renderMetricItem, renderMetrics, renderSignal, signalTotalScale } from "../../public/reader/actions.js";

test("formatSignalScore uses the current explicit 0-100 total contract without guessing", () => {
  assert.equal(formatSignalScore(7.234), "0.7");
  assert.equal(formatSignalScore(10), "1.0");
  assert.equal(formatSignalScore(84), "8.4");
  assert.equal(formatSignalScore(7.234, 10), "7.2");
  assert.equal(formatSignalScore(-1), "0.0");
  assert.equal(formatSignalScore(Number.NaN), "0.0");
});

test("signalTotalScale accepts only explicitly declared legacy 0-10 totals", () => {
  assert.equal(signalTotalScale({ total: 8 }), 100);
  assert.equal(signalTotalScale({ total: 8, totalScale: 10 }), 10);
  assert.equal(signalTotalScale({ total: 8, format: { totalScale: "0-10" } }), 10);
  assert.equal(signalTotalScale({ total: 80, scale: "0-100" }), 100);
});

test("metricIcon renders stable metric SVG shell", () => {
  const icon = metricIcon("reposts");

  assert.match(icon, /class="metric-icon"/);
  assert.match(icon, /viewBox="0 0 24 24"/);
  assert.match(icon, /m16\.6 4\.2/);
});

test("renderMetricItem formats and escapes one footer metric", () => {
  const html = renderMetricItem("likes", "Likes", 58900);

  assert.match(html, /class="metric-item metric-likes"/);
  assert.match(html, /aria-label="Likes: 58\.9K"/);
  assert.match(html, /<span class="metric-count">58\.9K<\/span>/);
});

test("renderMetrics keeps the X-like footer metric order", () => {
  const html = renderMetrics({
    replies: 3,
    reposts: 12,
    likes: 96,
    impressions: 13500,
  });

  assert.match(html, /aria-label="Post metrics"/);
  assert.equal(html.indexOf("metric-replies") < html.indexOf("metric-reposts"), true);
  assert.equal(html.indexOf("metric-reposts") < html.indexOf("metric-likes"), true);
  assert.equal(html.indexOf("metric-likes") < html.indexOf("metric-views"), true);
  assert.match(html, /13\.5K/);
});

test("renderSignal renders total score, localized dimensions, and escaped reasons", () => {
  const html = renderSignal({
    total: 84,
    dimensions: [
      {
        key: "immediateValue",
        label: "Immediate value",
        score: 8.2,
        reason: "Important <now>",
      },
      {
        key: "informationDensity",
        label: "Information density",
        score: 7.9,
        reason: "Concrete specs",
      },
    ],
  });

  assert.match(html, /class="signal-details"/);
  assert.match(html, /aria-label="Signal: 8\.4 out of 10"/);
  assert.match(html, /class="signal-score signal-summary-score">8\.4<\/strong>/);
  assert.match(html, /立即值得看/);
  assert.match(html, /信息密度/);
  assert.match(html, /Important &lt;now&gt;/);
  assert.match(html, /<div class="signal-body" hidden>/);
});

test("renderSignal treats low unmarked totals as current 0-100 values", () => {
  assert.match(renderSignal({ total: 8, dimensions: [] }), /Signal: 0\.8 out of 10/);
  assert.match(renderSignal({ total: 8, totalScale: 10, dimensions: [] }), /Signal: 8\.0 out of 10/);
});
