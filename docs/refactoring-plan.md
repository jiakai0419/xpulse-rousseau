# Refactoring Plan

This document records the refactoring strategy after V1 stabilization. Its purpose is to keep future cleanup deliberate, reviewable, and understandable to a non-coding owner.

## Purpose

Refactoring should make the project easier to understand, safer to change, and easier to test without changing the accepted V1 product behavior.

The project should continue to feel like one coherent product: an X-like reader that filters the user's Following timeline and makes selected posts easier to read with Chinese translation.

## Principles

- Preserve V1 behavior by default. A refactor is not a product change unless the user explicitly approves that change.
- Work one boundary at a time. Do not mix UI rendering cleanup, X ingestion cleanup, and pipeline cleanup in the same PR.
- Prefer small PRs that can be reviewed and reverted independently.
- Add or strengthen tests before moving high-risk logic.
- Keep abstractions owner-readable. A new module should make it easier to answer "where does this behavior live?"
- Do not introduce framework migration as part of cleanup. Keep the V1 dependency-light architecture unless a separate architecture decision approves a larger migration.
- Do not add mock or constructed timeline source modes. Replay, API/UI smoke, X display replay rendering, and audits should keep using X-derived runs.
- Do not add field-by-field compatibility shims for obsolete replay data. If a UI surface needs newly captured X fields, run a fresh Online Pulse.
- Keep product logic documented. When moving scoring, filtering, X API, OpenAI, usage, or UI behavior, update the relevant docs in the same change.

## Refactor Execution Protocol

For each refactor:

1. State the boundary being refactored and the behavior that must not change.
2. Read the relevant docs and tests before editing.
3. Add or adjust tests first when the current guard is weak.
4. Move code in small steps, preserving public behavior.
5. Run the verification command set for that boundary.
6. Open a focused PR with a concise summary and verification notes.

Do not start the next refactor until the current one is merged or explicitly paused.

## Phase 1 Closeout Status

As of 2026-06-18, the first V1 stabilization/refactor sweep is complete. The completed sweep includes Reader rendering extraction, display-fidelity tooling, screenshot-quality checks, the Original Evidence Cache, Display Oracle, Visual Review Pack, X ingestion/normalization boundaries, and Refresh Pipeline boundaries.

Accepted closeout verification:

```bash
npm run refactor:check-baseline
DISPLAY_ORIGINAL_CACHE_INVENTORY_REPORT=.data/display-gap-inventory/display-gap-baseline-225-2026-06-14/report.json npm run x-display:collect-original-renderings
DISPLAY_ORACLE_REQUIRE_ALL=1 DISPLAY_ORACLE_INVENTORY_REPORT=.data/display-gap-inventory/display-gap-baseline-225-2026-06-14/report.json npm run x-display:compare-rendering-facts
DISPLAY_VISUAL_REVIEW_INVENTORY_REPORT=.data/display-gap-inventory/display-gap-baseline-225-2026-06-14/report.json npm run x-display:build-screenshot-review
```

The accepted result from the closeout run is:

```txt
OK refactor baseline check passed.
OK x-display:collect-original-renderings: 225/225 valid, 0 missing, 0 invalid.
OK x-display:compare-rendering-facts: 225 samples.
OK x-display:build-screenshot-review: 225 samples, 38 sheets.
```

Do not continue broad refactoring by inertia. The next large cleanup phase should start only after a new review of product needs, code pressure points, and test coverage. Small bug fixes, test improvements, and narrowly scoped product work can continue under the Refactor Execution Protocol.

## Top 3 Refactor Tracks

### 1. Reader Rendering Boundary

**Status:** Completed in Phase 1.

**Goal:** Split the browser reader into clearer rendering modules while preserving the current X-like UI.

**Why this comes first:** The most expensive recent work was display fidelity. The current UI works, but `public/app.js` carries data state, API polling, X-like post rendering, link treatment, media geometry, media viewer behavior, Signal rendering, usage rendering, and event handling. That makes future UI changes risky.

**Current pressure points:**

- `public/app.js` is the largest file in the project.
- X-like link/media/quote rules are mixed with DOM event handling.
- `scripts/browser-smoke.mjs` mirrors some renderer rules for assertions, so rule drift is possible.

**Target shape:**

- Keep `public/app.js` as the app coordinator: state, API calls, polling, and event wiring.
- Move X-like post rendering into smaller browser modules.
- Move link treatment and media geometry into focused functions with explicit tests or smoke assertions.
- Keep media viewer and inline video behavior intact.
- Keep UI smoke and X display replay rendering using real X-derived replay runs.

**Verification:**

```bash
npm run x-display:check-sample-types
npm run test:unit
npm run test:smoke-ui
npm run x-display:test-replay-rendering
```

For display-sensitive rendering moves, also run:

```bash
npm run x-display:collect-local-renderings
npm run x-display:collect-original-renderings
npm run x-display:validate-diff-rules
DISPLAY_ORACLE_REQUIRE_ALL=1 npm run x-display:compare-rendering-facts
npm run x-display:build-screenshot-review
```

Before declaring the rendering boundary stable after larger changes:

```bash
FRESH_PULSE_RUNS=3 npm run x-display:test-fresh-pulse-rendering
```

### 2. X Ingestion And Normalization Boundary

**Status:** Completed in Phase 1.

**Goal:** Make X API fetching, field selection, raw snapshot recording, and normalization easier to reason about.

**Why this comes second:** Reader fidelity depends on the normalized X-derived shape. Once rendering boundaries are clearer, the upstream X data boundary should be made equally clear.

**Current pressure points:**

- `src/services/x/client.ts` includes X field profiles, timeline fetch, tweet lookup fetch, raw snapshot recording, usage records, and normalization.
- Normalization is critical to retweets, quoted posts, media variants, note tweets, and link previews.
- Missing fields have historically caused UI fidelity gaps.

**Target shape:**

- Isolate X reader field profile constants.
- Isolate pure normalization from network fetch.
- Keep tweet lookup enrichment separate from timeline pagination.
- Keep raw snapshot and usage recording behavior unchanged.
- Make normalization tests easier to expand when new X shapes appear.

**Verification:**

```bash
npm run env:check
npm run test:unit
npm run test:smoke-api
npm run test:smoke-ui
npm run x-display:test-replay-rendering
```

If normalization changes may affect live shapes, validate with fresh data deliberately:

```bash
FRESH_PULSE_RUNS=3 npm run x-display:test-fresh-pulse-rendering
```

### 3. Refresh Pipeline Boundary

**Status:** Completed in Phase 1.

**Goal:** Make one Online Pulse refresh read as a sequence of explicit stages instead of one dense orchestration function.

**Why this comes third:** The pipeline is business-critical, but it already has stronger unit coverage than the UI. It should be cleaned after rendering and X ingestion boundaries are clearer.

**Current pressure points:**

- `src/services/pipeline/runRefresh.ts` handles env/config, credential-driven timeline loading, progress publishing, usage collection, ad filtering, dedupe, seen filtering, OpenAI scoring, author diversity, translation, link preview enrichment, and trace construction.
- Some helper logic is pipeline-specific but not named as a stage.
- Progress and usage publishing are embedded in the orchestration.

**Target shape:**

- Keep `runRefresh` as the readable top-level flow.
- Extract stage helpers for timeline loading, candidate preparation, scoring/selection, translation/enrichment, and run construction.
- Keep progress and usage behavior identical.
- Keep commit rules outside the pipeline in `commitRefreshRun`.
- Keep replay behavior separate from live refresh behavior.

**Verification:**

```bash
npm run env:check
npm run test:unit
npm run test:smoke-api
npm run test:smoke-ui
npm run x-display:test-replay-rendering
npm run test:coverage
```

## Already Completed

- Phase 1 refactor closeout: `npm run refactor:check-baseline`, 225-sample Original Evidence Cache, strict Display Oracle, and Visual Review Pack passed on 2026-06-18.
- CI baseline: GitHub Actions runs environment check, unit tests, and native coverage on push and pull request.
- Refactor guard: `npm run refactor:check-baseline` runs environment check, unit tests, API smoke, UI smoke, and X display replay rendering.
- Refresh job boundary: in-memory Pulse job state moved to `src/server/refreshJobs.ts` with unit coverage.
- Reader format helpers: browser-side formatting and HTML escaping helpers moved to `public/reader/format.js`, keeping `public/app.js` focused one step closer to app coordination and X-like rendering.
- Reader link rules: X-like link normalization, quote/media/preview treatment, and hidden-link text cleanup moved to `public/reader/linkRules.js` with unit coverage.
- Reader media rules: X media image URLs, video variant selection, gallery ratios, single-media sizing, and duration formatting moved to `public/reader/mediaRules.js` with unit coverage.
- Reader status helpers: usage receipt rendering, per-run usage grouping, Pulse progress labels, and compact model status moved to `public/reader/status.js` with unit coverage.
- Reader source/auth helpers: Online/Offline source display, X auth sidebar display state, and shared avatar markup moved to `public/reader/sourceStatus.js` with unit coverage.
- Reader action helpers: post footer metric icons/counts and Signal summary/detail rendering moved to `public/reader/actions.js` with unit coverage.
- Reader render bucket classifier: shared X-derived sample classification for X display replay rendering, local rendering inventory, and sample type coverage, so refactors do not learn UI rules from only the latest Top 7.
- Reader post model helpers: reader-facing post selection and retweet context display data moved to `public/reader/postModel.js` with unit coverage, while HTML composition remains in `public/app.js`.
- Reader translation renderer: Chinese translation text selection, pending display, and source-link cleanup moved to `public/reader/translation.js` with unit coverage.
- Reader post text renderer: source text cleanup, inline link replacement, and HTML escaping moved to `public/reader/postText.js` with unit coverage.
- Reader post link renderer: link preview card and fallback link chip rendering moved to `public/reader/postLinks.js` with unit coverage.
- Reader post chrome renderer: avatar, retweet context, author line, original-link action, and rank badge rendering moved to `public/reader/postChrome.js` with unit coverage.
- Reader quote renderer: quoted-post placeholder and quote-card rendering moved to `public/reader/postQuote.js` with unit coverage while media rendering remains a caller-supplied dependency.
- Reader post media renderer: media grid HTML, viewer data attributes, inline video tags, and duration labels moved to `public/reader/postMedia.js` with unit coverage while media viewer behavior remains in `public/app.js`.
- Reader post composer: full post-card assembly moved to `public/reader/post.js` with integration-level unit coverage, leaving `public/app.js` focused on app state, API calls, event wiring, and media viewer behavior.
- X field profile boundary: reader-oriented X expansions and field lists moved to `src/services/x/fieldProfile.ts`, protected by tests that assert the requested profile includes note tweets, URL entities, referenced-tweet media, media variants, profile images, and metrics.
- X normalization boundary: X API response types moved to `src/services/x/apiTypes.ts`, and pure X payload normalization moved to `src/services/x/normalize.ts` with tests covering note text, URL preview evidence, media variants, metrics, quoted posts, missing-reference collection, and attachment of lookup results.
- X lookup enrichment boundary: missing referenced-post lookup, recursive attachment, lookup raw snapshots, and `x.lookup` usage records moved to `src/services/x/enrichment.ts` with direct unit coverage.
- Refresh candidate preparation boundary: ad filtering, duplicate filtering, Seen Ledger filtering, candidate list construction, and trace input snapshots moved to `src/services/pipeline/candidates.ts` with unit coverage.
- Refresh scoring/selection boundary: OpenAI candidate scoring and author-diverse final selection moved to `src/services/pipeline/selection.ts` with unit coverage.
- Refresh selected-post finalization boundary: selected-post translation attachment and selected-post link preview enrichment moved to `src/services/pipeline/finalization.ts` with unit coverage.
- Refresh run assembly boundary: final `RefreshRun` stats and trace construction moved to `src/services/pipeline/runAssembly.ts` with unit coverage.
- Refresh progress/usage boundary: per-refresh usage collection and progress publishing moved to `src/services/pipeline/progress.ts` with unit coverage.

## Not Yet Approved

These are possible future improvements, but they are not part of the current refactor plan:

- Frontend framework migration.
- Database migration from file storage to SQLite.
- New ranking dimensions.
- Prompt/ranking lab UI.
- Long-running background monitoring.
