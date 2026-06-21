# Test Coverage Matrix

This matrix maps V1 accepted behavior to the tests or audit commands that protect it. It is meant to be readable by the product owner and by future agents before refactoring.

## Data Policy

- Unit tests may use tiny constructed posts when they are testing pure domain rules such as ranking, cache keys, or state identities.
- Replay smoke, UI smoke, X display replay rendering, Original X evidence comparison, and fresh Pulse rendering must use saved or newly fetched X-derived runs.
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
| Replay creates a local run without new provider usage | `tests/unit/replay.test.ts`, `npm run test:smoke-api`, `npm run test:smoke-ui` | Saved X-derived run for smoke | Covered |
| Server commit saves a completed run and mutates Seen Ledger / Timeline Cursor only for Online runs | `tests/unit/commitRefreshRun.test.ts` | Constructed run objects | Covered |
| Replay preserves selected posts, translations, trace evidence, media, links, and quoted posts | `tests/unit/replay.test.ts`, `npm run test:smoke-ui` | Constructed pipeline output plus saved X-derived run for smoke | Covered |
| Usage is one action receipt, not global accumulation | `tests/unit/usage.test.ts` | Constructed usage records | Covered |
| Run Trace records input, filtering, dedupe, seen, scoring, selection, and translation evidence | `tests/unit/pipeline.test.ts`, `tests/unit/replay.test.ts` | Constructed domain posts | Covered |
| Local `.data` assets are classified before cleanup or evidence-heavy refactors | `tests/unit/dataInventory.test.ts`, `npm run data:inventory` | Tiny constructed classification cases plus local `.data` metadata | Stewardship inventory |
| Reader rendering sample coverage is broad enough to avoid Top-7-only conclusions | `npm run x-display:check-sample-types` | Saved X-derived live runs and trace input posts | Sample type coverage |
| Reader display gaps are inventoried before changing X-like rendering rules | `npm run x-display:collect-local-renderings` | Saved and optionally freshly fetched X-derived posts, with local screenshots | Local rendering collection |
| Original X screenshots/facts are captured as mandatory reusable evidence | `npm run x-display:collect-original-renderings` | Batch-captured Original X evidence from authenticated normal Chrome | Original rendering collection |
| X-like display diffs are judged by local-vs-Original facts and evidence, not by rules self-validating | `npm run x-display:compare-rendering-facts` | Local rendering collection plus cached Original X screenshots/facts | Rendering facts comparison |
| X rendering rules point back to the evidence map instead of self-validating | `npm run x-display:validate-diff-rules` | Checked-in diff-rule map referencing sample buckets/risks and Local-vs-Original diff classes | Diff rule validation |
| X-like reader rendering for retweets, quote cards, media, videos, previews, action row, and Signal | `npm run test:smoke-ui`, `npm run x-display:test-replay-rendering` | Saved X-derived live runs | Covered locally |
| Local Reader screenshots are prepared for Original X comparison | `npm run x-display:collect-local-renderings`, then `npm run x-display:collect-original-renderings`, `npm run x-display:compare-rendering-facts`, and `npm run x-display:build-screenshot-review` | Saved X-derived live runs plus cached Original evidence | Audit guard |
| Distribution-outside display validation uses fresh Online Pulse | `FRESH_PULSE_RUNS=3 npm run x-display:test-fresh-pulse-rendering` | Newly fetched X/OpenAI runs | Costful release guard |

## Known Refactor Targets

These are not product gaps, but they are the first places to improve once the test harness is in place:

- The server job commit path is extracted to `src/services/pipeline/commitRefreshRun.ts` and directly covered by unit tests. Future server refactors should keep that state mutation rule in the service instead of reintroducing it into HTTP route code.
- `test:smoke-ui` contains renderer-rule helpers that intentionally mirror `public/app.js`. During UI refactor, move shared shape classification into a small testable module if duplication starts obscuring intent.
- Display fidelity depends on X's live page behavior. Keep it as an audit layer, not the only automated guard.

## Command Sets

Cheap logic loop:

```bash
npm run test:unit
```

GitHub CI gate:

```bash
npm ci
npm run env:check
npm run test:unit
npm run test:coverage
```

Pre-refactor baseline:

```bash
npm run data:inventory
npm run x-display:check-sample-types
npm run x-display:collect-local-renderings
DISPLAY_ORIGINAL_CACHE_INVENTORY_REPORT=.data/display-gap-inventory/display-gap-baseline-225-2026-06-14/report.json npm run x-display:collect-original-renderings
npm run x-display:validate-diff-rules
DISPLAY_ORACLE_REQUIRE_ALL=1 DISPLAY_ORACLE_INVENTORY_REPORT=.data/display-gap-inventory/display-gap-baseline-225-2026-06-14/report.json npm run x-display:compare-rendering-facts
DISPLAY_VISUAL_REVIEW_INVENTORY_REPORT=.data/display-gap-inventory/display-gap-baseline-225-2026-06-14/report.json npm run x-display:build-screenshot-review
npm run refactor:check-baseline
npm run test:coverage
```

Rendering-sensitive refactor:

```bash
npm run test:smoke-ui
npm run x-display:test-replay-rendering
npm run x-display:collect-local-renderings
npm run x-display:collect-original-renderings
DISPLAY_ORACLE_REQUIRE_ALL=1 npm run x-display:compare-rendering-facts
npm run x-display:build-screenshot-review
```

Release-grade distribution-outside validation:

```bash
DISPLAY_INVENTORY_FRESH=1 DISPLAY_INVENTORY_FRESH_TARGET=100 npm run x-display:collect-local-renderings
npm run x-display:collect-original-renderings
npm run x-display:validate-diff-rules
DISPLAY_ORACLE_REQUIRE_ALL=1 npm run x-display:compare-rendering-facts
FRESH_PULSE_RUNS=3 npm run x-display:test-fresh-pulse-rendering
```
