# Test Coverage Matrix

This matrix maps V1 accepted behavior to the tests or audit commands that protect it. It is meant to be readable by the product owner and by future agents before refactoring.

## Data Policy

- Unit tests may use tiny constructed posts when they are testing pure domain rules such as ranking, cache keys, or state identities.
- Replay, browser smoke, display regression, display audit, and fresh audit must use saved or newly fetched X-derived runs.
- Do not add a product source mode that fabricates timelines.
- When a display test needs a missing post shape, run Online Pulse and save a new real run instead of inventing a local sample.

## Coverage

| V1 behavior | Primary guard | Data source | Status |
| --- | --- | --- | --- |
| Live X refresh has no local OpenAI fallback | `tests/unit/pipeline.test.ts`, `tests/unit/scoring.test.ts`, `tests/unit/translation.test.ts` | Constructed domain posts | Covered |
| Online Pulse fetches newer pages first, then falls back to recent pages | `tests/unit/xClient.test.ts` | Constructed X API responses | Covered |
| Raw X fields, expansions, media variants, note tweets, link previews, and referenced posts are preserved | `tests/unit/xClient.test.ts`, `tests/unit/replay.test.ts` | Constructed X API responses plus replayed run shape | Covered |
| Missing nested quoted posts from reposted sources are enriched with X lookup | `tests/unit/xClient.test.ts` | Constructed X API responses | Covered |
| Ads and exact/retweet duplicates are removed before ranking | `tests/unit/pipeline.test.ts`, `tests/unit/adFilter.test.ts`, `tests/unit/dedupe.test.ts` | Constructed domain posts | Covered |
| Previously displayed posts are filtered before OpenAI scoring | `tests/unit/pipeline.test.ts`, `tests/unit/rankingFeatures.test.ts` | Constructed domain posts | Covered |
| Seen Ledger stores canonical retweet source identity | `tests/unit/onlineState.test.ts` | Constructed domain posts | Covered |
| OpenAI cache key is operation/model/prompt/content based and ignores engagement metrics | `tests/unit/openAICache.test.ts`, `tests/unit/scoring.test.ts`, `tests/unit/translation.test.ts` | Constructed domain posts | Covered |
| Engagement is recalculated locally from latest X metrics | `tests/unit/rankingFeatures.test.ts`, `tests/unit/scoring.test.ts` | Constructed domain posts | Covered |
| Top count defaults to 7 | `tests/unit/selection.test.ts`, `tests/unit/pipeline.test.ts` | Constructed domain posts | Covered |
| Author diversity runs after scoring and keeps the best reader-facing author post | `tests/unit/rankingFeatures.test.ts`, `tests/unit/pipeline.test.ts` | Constructed domain posts | Covered |
| Timeline Cursor updates from fetched input, not only selected posts | `tests/unit/onlineState.test.ts` | Constructed run trace | Covered |
| Replay creates a local run without new provider usage | `tests/unit/replay.test.ts`, `npm run smoke`, `npm run browser:smoke` | Saved X-derived run for smoke | Covered |
| Server commit saves a completed run and mutates Seen Ledger / Timeline Cursor only for Online runs | `tests/unit/commitRefreshRun.test.ts` | Constructed run objects | Covered |
| Replay preserves selected posts, translations, trace evidence, media, links, and quoted posts | `tests/unit/replay.test.ts`, `npm run browser:smoke` | Constructed pipeline output plus saved X-derived run for smoke | Covered |
| Usage is one action receipt, not global accumulation | `tests/unit/usage.test.ts` | Constructed usage records | Covered |
| Run Trace records input, filtering, dedupe, seen, scoring, selection, and translation evidence | `tests/unit/pipeline.test.ts`, `tests/unit/replay.test.ts` | Constructed domain posts | Covered |
| Reader rendering sample coverage is broad enough to avoid Top-7-only conclusions | `npm run render:coverage` | Saved X-derived live runs and trace input posts | Coverage inventory |
| Reader display gaps are inventoried before changing X-like rendering rules | `npm run display:inventory` | Saved and optionally freshly fetched X-derived posts, with local screenshots | Gap inventory |
| Original X screenshots/facts are captured as mandatory reusable evidence | `npm run display:original-cache` | Batch-captured Original X evidence from authenticated normal Chrome | Evidence cache |
| X-like display diffs are judged by evidence, not by rules self-validating | `npm run display:oracle` | Display inventory plus cached Original X screenshots/facts | Diff oracle |
| X rendering rules point back to the evidence map instead of self-validating | `npm run display:rule-ledger` | Checked-in rule ledger referencing Inventory buckets/risks and Oracle diff classes | Explanation ledger |
| X-like reader rendering for retweets, quote cards, media, videos, previews, action row, and Signal | `npm run browser:smoke`, `npm run display:regression` | Saved X-derived live runs | Covered locally |
| Local Reader screenshots are prepared for Original X comparison | `npm run display:audit`, or `DISPLAY_AUDIT_SKIP_ORIGINAL=1 npm run display:audit` when login walls block automation | Saved X-derived live runs plus manual Original X inspection from authenticated Chrome when needed | Audit guard |
| Distribution-outside display validation uses fresh Online Pulse | `FRESH_PULSE_RUNS=3 npm run fresh:audit` | Newly fetched X/OpenAI runs | Costful release guard |

## Known Refactor Targets

These are not product gaps, but they are the first places to improve once the test harness is in place:

- The server job commit path is extracted to `src/services/pipeline/commitRefreshRun.ts` and directly covered by unit tests. Future server refactors should keep that state mutation rule in the service instead of reintroducing it into HTTP route code.
- `browser:smoke` contains renderer-rule helpers that intentionally mirror `public/app.js`. During UI refactor, move shared shape classification into a small testable module if duplication starts obscuring intent.
- Display fidelity depends on X's live page behavior. Keep it as an audit layer, not the only automated guard.

## Command Sets

Cheap logic loop:

```bash
npm test
```

GitHub CI gate:

```bash
npm ci
npm run doctor
npm test
npm run test:coverage
```

Pre-refactor baseline:

```bash
npm run render:coverage
npm run display:inventory
DISPLAY_ORIGINAL_CACHE_INVENTORY_REPORT=.data/display-gap-inventory/display-gap-baseline-225-2026-06-14/report.json npm run display:original-cache
npm run display:rule-ledger
DISPLAY_ORACLE_REQUIRE_ALL=1 DISPLAY_ORACLE_INVENTORY_REPORT=.data/display-gap-inventory/display-gap-baseline-225-2026-06-14/report.json npm run display:oracle
DISPLAY_VISUAL_REVIEW_INVENTORY_REPORT=.data/display-gap-inventory/display-gap-baseline-225-2026-06-14/report.json npm run display:visual-review
npm run verify:refactor
npm run test:coverage
```

Rendering-sensitive refactor:

```bash
npm run browser:smoke
npm run display:regression
DISPLAY_AUDIT_MAX=42 DISPLAY_AUDIT_PER_BUCKET=4 npm run display:audit
```

Release-grade distribution-outside validation:

```bash
DISPLAY_INVENTORY_FRESH=1 DISPLAY_INVENTORY_FRESH_TARGET=100 npm run display:inventory
npm run display:original-cache
npm run display:rule-ledger
DISPLAY_ORACLE_REQUIRE_ALL=1 npm run display:oracle
FRESH_PULSE_RUNS=3 npm run fresh:audit
```
