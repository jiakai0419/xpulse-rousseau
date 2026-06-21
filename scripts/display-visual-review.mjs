import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { evaluateDisplayOracle, evidencePostId } from "./display-oracle-core.mjs";
import { normalizeOriginalEvidenceDocument } from "./display-original-evidence-cache-core.mjs";

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const outputDir = process.env.DISPLAY_VISUAL_REVIEW_DIR || `.data/display-visual-review/visual-review-${timestamp}`;
const sheetSize = Number.parseInt(process.env.DISPLAY_VISUAL_REVIEW_SHEET_SIZE || "6", 10);
const viewportWidth = Number.parseInt(process.env.DISPLAY_VISUAL_REVIEW_VIEWPORT_WIDTH || "1800", 10);
const viewportHeight = Number.parseInt(process.env.DISPLAY_VISUAL_REVIEW_VIEWPORT_HEIGHT || "2600", 10);

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function latestReport(root, fileName) {
  if (!existsSync(root)) {
    throw new Error(`Missing ${root}. Run the corresponding display command first.`);
  }

  const candidates = readdirSync(root)
    .map((name) => join(root, name, fileName))
    .filter((filePath) => existsSync(filePath))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);

  if (!candidates.length) {
    throw new Error(`No ${fileName} found under ${root}.`);
  }

  return candidates[0];
}

function latestInventoryReport() {
  return process.env.DISPLAY_VISUAL_REVIEW_INVENTORY_REPORT || latestReport(".data/display-gap-inventory", "report.json");
}

function originalEvidencePath() {
  return process.env.DISPLAY_VISUAL_REVIEW_ORIGINALS || ".data/display-original-evidence/original-evidence-store.json";
}

function absoluteExistingPath(filePath) {
  if (!filePath) {
    return "";
  }

  const absolutePath = resolve(filePath);
  return existsSync(absolutePath) ? absolutePath : "";
}

function html(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function fileHref(filePath) {
  return filePath ? pathToFileURL(filePath).href : "";
}

function textList(values) {
  return Array.isArray(values) && values.length ? values.join(", ") : "-";
}

function factSummary(sample, original) {
  const flags = sample.flags ?? {};
  const localFacts = sample.localFacts ?? {};
  const originalFacts = original?.facts ?? {};
  const localMediaItems = Array.isArray(localFacts.mediaGrids)
    ? localFacts.mediaGrids.reduce((sum, grid) => sum + Number(grid.mediaItems ?? 0), 0)
    : 0;
  const originalMedia = Array.isArray(originalFacts.media) ? originalFacts.media : [];
  const originalVideos = originalMedia.filter((item) => item?.tag === "video");
  const localVideos = Array.isArray(localFacts.videos) ? localFacts.videos.length : 0;

  return [
    `retweet:${Boolean(flags.retweet)}`,
    `quote:${Boolean(flags.quote)}`,
    `media:${Number(flags.mediaCount ?? 0)} local:${localMediaItems} x:${originalMedia.length}`,
    `video:${localVideos}/${originalVideos.length}`,
    `links:${Array.isArray(sample.links) ? sample.links.length : 0}`,
  ].join(" · ");
}

function rowTitle(row) {
  const author = row.sample.author?.username ? `@${row.sample.author.username}` : row.sample.author?.name ?? "unknown";
  return `#${String(row.sample.index).padStart(3, "0")} ${author} ${row.postId}`;
}

function renderRow(row) {
  const localImage = row.localScreenshot
    ? `<a href="${fileHref(row.localScreenshot)}"><img src="${fileHref(row.localScreenshot)}" alt="Local Reader screenshot"></a>`
    : `<div class="missing">Missing local screenshot</div>`;
  const originalImage = row.originalScreenshot
    ? `<a href="${fileHref(row.originalScreenshot)}"><img src="${fileHref(row.originalScreenshot)}" alt="Original X screenshot"></a>`
    : `<div class="missing">Missing Original screenshot</div>`;
  const statusClass = `status-${row.result.status}`;
  const diffs = row.result.factDiffs.length ? row.result.factDiffs.join(", ") : "no fact diff";
  const blockers = row.result.blocked.length ? row.result.blocked.join(", ") : "";

  return `
    <article class="review-row ${statusClass}" id="post-${html(row.postId)}">
      <header class="row-head">
        <div>
          <h2>${html(rowTitle(row))}</h2>
          <p class="meta">${html(factSummary(row.sample, row.original))}</p>
        </div>
        <a class="original-link" href="${html(row.sample.url)}">${html(row.result.status)}</a>
      </header>
      <div class="tags">
        <span>Oracle: ${html(diffs)}</span>
        ${blockers ? `<span>Blocked: ${html(blockers)}</span>` : ""}
        <span>Buckets: ${html(textList(row.sample.buckets))}</span>
        <span>Risks: ${html(textList(row.sample.risks))}</span>
        <span>Missing: ${html(textList(row.sample.missingData))}</span>
      </div>
      <div class="shot-pair">
        <section>
          <h3>Reader</h3>
          ${localImage}
        </section>
        <section>
          <h3>Original X</h3>
          ${originalImage}
        </section>
      </div>
    </article>
  `;
}

function documentHtml(rows, title) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${html(title)}</title>
  <style>
    :root {
      color-scheme: light;
      --ink: #0f1419;
      --muted: #536471;
      --line: #d8e1e8;
      --soft: #f7f9f9;
      --fail: #f4212e;
      --pass: #00ba7c;
      --block: #ff7a00;
    }

    * { box-sizing: border-box; }

    body {
      margin: 0;
      background: #eef2f4;
      color: var(--ink);
      font: 14px/1.35 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    main {
      width: 1720px;
      margin: 0 auto;
      padding: 24px 0 48px;
    }

    .review-row {
      margin: 0 0 26px;
      padding: 18px;
      border: 1px solid var(--line);
      border-radius: 18px;
      background: #fff;
      break-inside: avoid;
      box-shadow: 0 1px 2px rgba(15, 20, 25, 0.04);
    }

    .review-row.status-failed { border-left: 6px solid var(--fail); }
    .review-row.status-blocked { border-left: 6px solid var(--block); }
    .review-row.status-passed { border-left: 6px solid var(--pass); }

    .row-head {
      display: flex;
      justify-content: space-between;
      gap: 20px;
      align-items: flex-start;
      margin-bottom: 10px;
    }

    h2 {
      margin: 0 0 3px;
      font-size: 18px;
      line-height: 1.2;
    }

    h3 {
      margin: 0 0 8px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }

    .meta {
      margin: 0;
      color: var(--muted);
      font-weight: 600;
    }

    .original-link {
      color: var(--ink);
      font-weight: 800;
      text-transform: uppercase;
      text-decoration: none;
    }

    .tags {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 0 0 14px;
    }

    .tags span {
      max-width: 100%;
      padding: 5px 8px;
      border-radius: 999px;
      background: var(--soft);
      color: var(--muted);
      font-weight: 650;
      font-size: 12px;
    }

    .shot-pair {
      display: grid;
      grid-template-columns: 598px 1fr;
      gap: 18px;
      align-items: start;
    }

    .shot-pair section {
      min-width: 0;
    }

    img {
      display: block;
      max-width: 100%;
      height: auto;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: #fff;
    }

    .missing {
      min-height: 240px;
      display: grid;
      place-items: center;
      border: 1px dashed var(--line);
      border-radius: 10px;
      color: var(--muted);
      background: var(--soft);
      font-weight: 700;
    }
  </style>
</head>
<body>
  <main>
    ${rows.map(renderRow).join("\n")}
  </main>
</body>
</html>`;
}

async function renderSheets(rows) {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: viewportWidth, height: viewportHeight }, deviceScaleFactor: 1 });
    const sheetFiles = [];
    for (let index = 0; index < rows.length; index += sheetSize) {
      const sheetRows = rows.slice(index, index + sheetSize);
      const sheetNumber = Math.floor(index / sheetSize) + 1;
      const sheetHtmlPath = join(outputDir, `sheet-${String(sheetNumber).padStart(3, "0")}.html`);
      const sheetPngPath = join(outputDir, `sheet-${String(sheetNumber).padStart(3, "0")}.png`);
      writeFileSync(sheetHtmlPath, documentHtml(sheetRows, `X Display Screenshot Review Sheet ${sheetNumber}`), "utf8");
      await page.goto(pathToFileURL(resolve(sheetHtmlPath)).href);
      await page.waitForLoadState("networkidle");
      await page.screenshot({ path: sheetPngPath, fullPage: true });
      sheetFiles.push(resolve(sheetPngPath));
    }
    return sheetFiles;
  } finally {
    await browser.close();
  }
}

function markdownReport(report) {
  const lines = [
    "# X Display Screenshot Review",
    "",
    `Created: ${report.createdAt}`,
    `Inventory: \`${report.inventoryReportPath}\``,
    `Original evidence: \`${report.originalEvidencePath}\``,
    `Samples: ${report.rows.length}`,
    `Sheets: ${report.sheetFiles.length}`,
    "",
    "This pack is the automated screenshot-comparison artifact for Codex review. It does not replace x-display:compare-rendering-facts; it complements it by putting the mandatory Reader and Original screenshots side by side.",
    "",
    "## Sheets",
    "",
    ...report.sheetFiles.map((filePath, index) => `- Sheet ${index + 1}: \`${filePath}\``),
    "",
    "## Rows",
    "",
    "| # | Post | Oracle | Buckets | Risks | Reader | Original |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const row of report.rows) {
    lines.push(
      `| ${row.sample.index} | [${row.postId}](${row.sample.url}) | ${row.result.status} | ${textList(row.sample.buckets)} | ${textList(row.sample.risks)} | ${row.localScreenshot ? `[reader](${row.localScreenshot})` : "-"} | ${row.originalScreenshot ? `[original](${row.originalScreenshot})` : "-"} |`,
    );
  }

  return `${lines.join("\n")}\n`;
}

async function main() {
  const inventoryReportPath = latestInventoryReport();
  const originalEvidenceStorePath = originalEvidencePath();

  if (!existsSync(originalEvidenceStorePath)) {
    throw new Error(`Missing Original evidence store: ${originalEvidenceStorePath}. Run npm run x-display:collect-original-renderings first.`);
  }

  const inventoryReport = readJson(inventoryReportPath);
  const originalEntries = normalizeOriginalEvidenceDocument(readJson(originalEvidenceStorePath));
  const originalsById = new Map(originalEntries.map((entry) => [evidencePostId(entry), entry]));
  const oracleSummary = evaluateDisplayOracle({ samples: inventoryReport.samples, originalEntries });

  const resultById = new Map(oracleSummary.results.map((result) => [result.postId, result]));
  const rows = inventoryReport.samples.map((sample) => {
    const original = originalsById.get(String(sample.postId));
    return {
      postId: String(sample.postId),
      sample,
      original,
      localScreenshot: absoluteExistingPath(sample.localScreenshot),
      originalScreenshot: absoluteExistingPath(original?.screenshot),
      result: resultById.get(String(sample.postId)) ?? {
        postId: String(sample.postId),
        status: "blocked",
        blocked: ["missing_oracle_result"],
        factDiffs: [],
        explanations: [],
        unexplainedDiffs: [],
      },
    };
  });

  mkdirSync(outputDir, { recursive: true });
  const indexHtmlPath = join(outputDir, "index.html");
  writeFileSync(indexHtmlPath, documentHtml(rows, "X Display Screenshot Review"), "utf8");
  const sheetFiles = await renderSheets(rows);

  const report = {
    createdAt: new Date().toISOString(),
    inventoryReportPath: resolve(inventoryReportPath),
    originalEvidencePath: resolve(originalEvidenceStorePath),
    outputDir: resolve(outputDir),
    oracleSummary,
    sheetSize,
    sheetFiles,
    rows: rows.map((row) => ({
      postId: row.postId,
      sample: row.sample,
      result: row.result,
      localScreenshot: row.localScreenshot,
      originalScreenshot: row.originalScreenshot,
    })),
  };

  writeFileSync(join(outputDir, "review.json"), JSON.stringify(report, null, 2), "utf8");
  writeFileSync(join(outputDir, "report.md"), markdownReport(report), "utf8");

  console.log(`OK x-display:build-screenshot-review: ${rows.length} samples, ${sheetFiles.length} sheets.`);
  console.log(`Report: ${join(outputDir, "report.md")}`);
  console.log(`Index: ${indexHtmlPath}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
