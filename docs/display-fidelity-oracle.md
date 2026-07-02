# Display Fidelity Oracle

This document defines how the project judges X-like rendering fidelity without letting our own rendering rules prove themselves.

## Core Distinction

- **Display Gap Inventory** maps a broad real-data sample. It finds risky shapes, missing provider fields, local screenshots, and candidate samples.
- **Original Evidence Cache** stores mandatory Original X evidence by post id. It can be filled in batches and reused across audits.
- **Display Oracle** is the judge for a scoped sample set. It requires local screenshots, local facts, Original screenshots, and Original facts. Screenshot evidence is part of the automated judging contract, not an optional manual review aid. If evidence is missing, blank, low-quality, or not targeted to the exact article, the sample is blocked, not passed.
- **Rule Ledger** explains observed diffs. Rules are implementation hypotheses and regression guards; they are not the source of truth. Each rule must reference the Inventory buckets/risks that can surface that rule.

Original X is the calibration target. Rendering rules only explain why a local/Original diff exists.

## Evidence Contract

For every post checked by Display Oracle, the evidence must include:

- local Reader screenshot;
- local Reader DOM/geometric facts;
- Original X screenshot from the user's already-authenticated normal Chrome session;
- Original X DOM/geometric facts;
- screenshot probe showing both screenshots are contentful;
- screenshot quality evidence showing the Original screenshot is a targeted article-region capture rather than a viewport/sidebar fallback;
- exact target article evidence, not the first article on a conversation page.

If any of these are missing, the result is `blocked`.

## Batchable Original Evidence

Broad inventories can contain 100-225+ posts. It is acceptable to capture Original X evidence in batches, but not acceptable to skip it for a sample that Oracle is judging.

The cache flow is:

```bash
DISPLAY_INVENTORY_FRESH=1 DISPLAY_INVENTORY_FRESH_TARGET=100 npm run x-display:collect-local-renderings
npm run x-display:collect-original-renderings
```

`x-display:collect-original-renderings` reports the next missing batch. After a batch is captured from authenticated Chrome, import it:

```bash
DISPLAY_ORIGINAL_CACHE_IMPORT=.data/.../original-chrome-results.json npm run x-display:collect-original-renderings
```

Captured and validated entries are stored in:

```txt
.data/display-original-evidence/original-evidence-store.json
```

Because the cache is keyed by post id, previously captured Original evidence is reused. Re-running the cache command only reports missing or invalid rows.

Original screenshots are evidence assets, not temporary diagnostics. When Original evidence is imported, any screenshot path outside `.data/display-original-evidence` is copied into durable local evidence storage before the store is updated. If an older evidence row points to a missing temporary screenshot, the cache command may repair it only when exactly one durable `*-original.png` screenshot for the same post id already exists under `.data/display-original-evidence`. Otherwise the row remains invalid and must be recaptured. This avoids both data loss and false repair.

The batch file is:

```txt
.data/display-original-evidence/.../next-batch.json
```

Capture execution should use that file as its queue. The expected output is:

```txt
original-chrome-results.json
```

Each result row must include `id`, `url`, `screenshot`, `probe`, and `facts`. The project includes `scripts/display-original-evidence-chrome-capture.mjs` as the Chrome-runtime helper for this execution step; it is intentionally separate from `npm run x-display:collect-original-renderings`, because normal Node scripts do not own the user's authenticated Chrome session. This keeps responsibilities clean:

- `x-display:collect-original-renderings`: plan missing rows, validate evidence, and import results;
- Chrome capture helper: open Original URLs in normal Chrome and write screenshots/facts;
- `scripts/display-original-capture-core.mjs`: hold pure capture rules such as target article matching, target normalization, screenshot-probe validation, clip scaling, and retry classification so Chrome orchestration stays thin and testable;
- `x-display:compare-rendering-facts`: compare local Reader facts with Original X facts only for rows with mandatory local and Original evidence.

The Chrome capture helper treats blank or low-quality Original screenshots as retryable capture failures. For each sample it opens a fresh tab per capture attempt, waits for the exact article and media paint, reveals X interstitials such as `Show probable spam` when possible, nudges the viewport, prefers an article-region screenshot, records screenshot quality metadata, and validates the screenshot probe. If Chrome cannot produce a contentful direct article clip, the helper may capture the full viewport and crop it back to the known article rectangle; the final persisted evidence must still be an article-region screenshot. The helper re-locates the exact article immediately before screenshot capture, so stale pre-scroll clips are not accepted. The persisted `captureMethod` distinguishes direct article clips from valid viewport-cropped article evidence. Article clips without `captureMethod` are treated as legacy evidence and must be recaptured before they can satisfy the Oracle. Direct clips whose pixel probe does not match the target article width are invalid; nearly-all-white interstitial screenshots are invalid even when they contain a small amount of text. Viewport fallback screenshots are investigation artifacts only; they are not valid Oracle evidence because they can include sidebars, unrelated articles, or clipped content. The default is three fresh-tab attempts per sample and four screenshot attempts per screenshot mode. Increase `DISPLAY_ORIGINAL_CAPTURE_ATTEMPTS` only when Chrome/X rendering is temporarily slow.

## Full-Inventory Gate

The current V1 display-fidelity baseline is a 225-post real X-derived inventory. The gate is all-or-nothing: every inventory row must have local Reader evidence, Original X evidence, and zero detected fact diffs.

```bash
DISPLAY_ORACLE_REQUIRE_ALL=1 npm run x-display:compare-rendering-facts
```

A small set of known badcases is not an acceptable substitute for this gate. Fixes should be category-level changes, then the whole inventory should be rerun. The accepted baseline from 2026-06-15 was:

```txt
OK x-display:collect-original-renderings: 225/225 valid, 0 missing, 0 invalid.
OK x-display:compare-rendering-facts: 225 samples.
OK x-display:build-screenshot-review: 225 samples, 38 sheets.
```

To require every inventory sample to have valid Original evidence:

```bash
DISPLAY_ORACLE_REQUIRE_ALL=1 npm run x-display:compare-rendering-facts
```

Oracle exit semantics are intentionally strict:

- `blocked` always exits non-zero, even when `DISPLAY_ORACLE_ALLOW_DIFFS=1` is set. Blocked means the judge does not have enough local or Original evidence to decide.
- `failed` exits non-zero by default. `DISPLAY_ORACLE_ALLOW_DIFFS=1` can be used only when collecting a non-strict investigation report for already-evidenced rows.
- `DISPLAY_ORACLE_REQUIRE_ALL=1` makes the run strict again for the full inventory: both `blocked` and `failed` rows exit non-zero.

## Rule Ledger

The checked-in ledger lives at:

```txt
docs/display-rule-ledger.json
```

Validate it with:

```bash
npm run x-display:validate-diff-rules
```

Each rule records:

- `inventoryBuckets`: which Inventory categories should produce evidence for this rule;
- `inventoryRisks`: which Inventory risk labels should prioritize review;
- `oracleDiffs`: which hard local/Original fact diffs the rule explains;
- `observedXBehavior`: what was observed on Original X;
- `readerRule`: what the Reader is expected to do;
- `status` and `confidence`.

This creates the intended loop:

```txt
Inventory samples -> Original evidence -> Oracle diff -> Rule Ledger explanation -> rendering fix or documented data gap
```

If Oracle finds a diff that no rule explains, the diff remains a failure. Do not relax Oracle to fit the ledger; update the ledger only after checking the evidence.

## Reading Results

Oracle results have three statuses:

- `passed`: mandatory evidence exists and no fact diff was detected.
- `failed`: mandatory evidence exists and a local/Original fact diff was detected.
- `blocked`: mandatory evidence is missing, invalid, blank, or not tied to the exact Original article.

Rules explain failures. For example:

```txt
original_has_x_article_card_local_has_placeholder -> x_article_card_rendering
```

If a diff has no known rule, it is an unexplained display diff. The correct response is to add evidence, update the rule ledger, and then decide whether to change rendering.

## Evidence-Backed Preview Enrichment

The inventory renderer may enrich ordinary external previews from the URL preview cache so the local audit path matches Online Pulse behavior for selected posts. It may also enrich X Article links from authenticated Original evidence when X's public API only exposes `x.com/i/article/...` as a URL entity. That enrichment is evidence-backed, not synthetic: if Original evidence is missing, the Oracle row remains blocked or failed.

This distinction matters. The Reader should not invent article cards from heuristics. It should render X Article cards only when structured preview metadata or authenticated Original evidence exists.

Local screenshot capture uses the system Chrome channel by default because bundled Chromium can under-report video playback for X media codecs. Set `DISPLAY_INVENTORY_BROWSER_CHANNEL=<channel>` only when deliberately testing another browser.

## Visual Review Pack

Display Oracle consumes both fact evidence and screenshot evidence. Facts catch known structural diffs; screenshots catch visual shape mismatches that facts do not yet encode. For broad screenshot comparison, generate a side-by-side visual pack:

```bash
npm run x-display:build-screenshot-review
```

The command reads the latest Display Gap Inventory and the Original Evidence Cache, then writes:

```txt
.data/display-visual-review/.../index.html
.data/display-visual-review/.../sheet-001.png
.data/display-visual-review/.../review.json
.data/display-visual-review/.../report.md
```

Each row includes the local Reader screenshot, the Original X screenshot, the Oracle status, buckets, risks, and missing-data labels. This pack is the automated screenshot-comparison artifact. It is generated by tooling and must be inspected by Codex before summarizing rendering gaps; it is not a casual manual-only appendix. A row can be visually suspicious even when Oracle says `passed`; in that case the right fix is to record the visual finding and add a stronger fact/probe/test, not to treat the rule set as sufficient.

## Why Rules Cannot Be The Judge

Rules can be incomplete. A sample can satisfy every known rule and still look wrong. Therefore:

- local/Original screenshots and facts decide whether a diff exists;
- rules only explain known classes of diffs;
- unexplained diffs are first-class failures, not ignored edge cases;
- new fresh samples should be used to challenge the current rule set before large refactors.
