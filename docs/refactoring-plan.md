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

## Phase 2 Entry Assessment

As of 2026-07-11, the project is not in a "keep splitting whatever looks large" state. V1 behavior is stable enough to protect, Phase 1 has already completed the three highest-risk product boundaries, and the next cleanup should improve control and confidence rather than produce churn.

Current baseline signals:

- Phase 1 closeout remains accepted and Phase 2 display-tooling work is isolated in focused PRs.
- Unit test suite has 235 passing tests.
- Local data inventory reports 20 saved runs, including 18 live X-derived runs, and 330 Original evidence entries.
- X rendering sample coverage sees 558 trace input samples and 112 selected samples from real X-derived runs.
- The command set now separates ordinary tests, replay rendering checks, Original evidence collection, screenshot review, fresh Pulse validation, and local data inventory.

The Phase 2 rule is: do not begin a large refactor until the target boundary, non-goals, and verification set are written down first.

Before starting any Phase 2 refactor, run:

```bash
npm run data:inventory
npm run test:unit
npm run refactor:check-baseline
npm run x-display:check-sample-types
```

For display-sensitive Phase 2 work, also use the full evidence flow:

```bash
npm run x-display:collect-local-renderings
npm run x-display:collect-original-renderings
npm run x-display:validate-diff-rules
DISPLAY_ORACLE_REQUIRE_ALL=1 npm run x-display:compare-rendering-facts
npm run x-display:build-screenshot-review
```

Fresh Online Pulse validation should be deliberate because it calls X and OpenAI:

```bash
FRESH_PULSE_RUNS=3 npm run x-display:test-fresh-pulse-rendering
```

## Phase 2 Candidate Tracks

These are candidate tracks, not automatic commitments. Pick one, complete it, verify it, and merge it before starting another.

### 1. Display Evidence Tooling Boundary

**Status:** Completed for Phase 2.

**Goal:** Make the X display-fidelity tooling easier to understand and maintain without changing Reader rendering behavior.

**Why this comes first:** Recent product stability depends heavily on the display evidence system. The user has repeatedly emphasized screenshot comparison, broad samples, and not fixing one post while breaking another. The tooling now works, but it has many concepts and scripts: local rendering inventory, Original evidence cache, Chrome capture helper, screenshot probes, quality checks, Display Oracle, Rule Ledger, Visual Review Pack, replay rendering, and fresh Pulse rendering.

**What this boundary is really for:** This is not a generic script cleanup area. It is the project's display-fidelity evidence system. Its larger job is to stop the repeated cycle of fixing one X rendering mismatch while breaking another by turning subjective visual comparison into reusable evidence: broad real X-derived samples, local Reader screenshots and facts, authenticated Original X screenshots and facts, strict blocked/failed/pass semantics, screenshot review sheets, and rule explanations that can be challenged by new samples.

The display tools are successful when they help answer four owner-level questions:

- Are we learning X rendering behavior from enough real posts, not from a few memorable badcases?
- Do we have both local and Original evidence for every post we claim is aligned?
- If a post differs, do we know whether it is a missing data problem, a rendering rule problem, or a capture-quality problem?
- Can a future refactor prove that it did not damage the accepted X-like Reader experience?

**Current assessment:** The system now serves the larger goal with explicit, tested stages. It has real X-derived inventories, Original evidence caching, strict Oracle blocking for missing or low-quality evidence, screenshot-quality checks, screenshot review sheets, replay rendering regression, and fresh Pulse validation. Focused Phase 2 slices made the inventory, capture, enrichment, comparison, and report boundaries testable without changing Reader behavior.

**Phase 2 progress as of 2026-07-11:** The Display Evidence Tooling cleanup slices are complete. Command/data governance, display inventory sample helpers, local Reader evidence capture, Original capture core helpers, Original article matching rules, Original evidence cache rules, local inventory report construction, sample selection, enrichment, fresh X capture, and historical run selection are extracted and tested. Do not repeat those extractions.

**Resolved design pressure:** `scripts/display-gap-inventory.ts` is now the command orchestrator: it reads configuration, calls named historical/fresh/sample/enrichment/capture/report stages, and writes command outputs. Historical evidence eligibility is no longer hidden in that script. The remaining Chrome and Playwright-heavy files are execution adapters; their size alone is not a reason for another refactor.

**Refactor hypothesis:** Effective Phase 2 work should make the evidence system's domain language explicit before moving code for its own sake. The useful abstractions are not "misc helpers"; they are:

- display sample selection and bucket classification;
- local Reader evidence capture;
- Original X evidence planning, capture import, and validation;
- screenshot probe and screenshot-quality validation;
- Local-vs-Original Oracle comparison;
- visual review artifact generation;
- fresh Pulse distribution-outside rendering validation.

The first useful code cleanup is therefore to extract stable evidence contracts and stage helpers, then shrink the large orchestration scripts around those contracts. A shallow helper extraction that merely reduces line count without clarifying these stages is not meaningful refactoring.

**Residual constraints, not active refactor targets:**

- The display scripts are now the densest part of the project.
- Some script names are clear, but the internal flow is still mentally expensive.
- Facts comparison, screenshot evidence, screenshot review, and rule validation are separate layers that must remain distinct.
- Chrome-based Original capture is necessarily special because it depends on the user's authenticated normal Chrome session.
- Evidence-shaped data contracts are implicit JSON objects shared across scripts rather than a small explicit module.
- Some flows are robust operationally but still hard to explain: inventory, Original cache planning/import, Chrome capture, Oracle, visual review, and replay/fresh validation are correct concepts, but their implementation boundaries are uneven.

**Target shape:**

- Keep the npm command names stable.
- Keep screenshots as automated evidence, not optional manual decoration.
- Make script responsibilities map directly to the documented evidence flow:
  - collect local Reader evidence;
  - collect or import Original X evidence;
  - validate known diff explanations;
  - compare local facts with Original facts;
  - build screenshot review sheets.
- Prefer extracting shared display evidence contracts and stage helpers over adding another one-off script.
- Keep real X-derived runs as the data source; do not add mock display samples.
- Keep `Rule Ledger` explanatory. It must never become the judge that proves UI alignment.
- Keep Chrome Original capture as a dedicated execution adapter around normal authenticated Chrome, while moving reusable target matching, validation, and quality semantics into testable helpers.

**Non-goals:**

- Do not change Reader UI rendering rules as part of tooling cleanup.
- Do not reintroduce the removed `display:audit` login/profile path.
- Do not make Rule Ledger the judge. Oracle evidence remains the judge.
- Do not start by adding screenshot pixel-diff thresholds. First make current evidence contracts and stages explicit; then decide whether image comparison needs stronger automation.
- Do not rewrite all display scripts in one PR.

**Completed first slices:**

- Extracted display inventory sample helpers and bucket/risk classification.
- Split local Reader evidence capture out of `display-gap-inventory.ts`, keeping command names and output paths unchanged.
- Extracted Original capture core helpers and article matching rules.
- Extracted Original evidence cache planning/import/validation core helpers.
- Extracted local inventory run and report construction from `display-gap-inventory.ts`.
- Extracted sample selection from `display-gap-inventory.ts`.
- Extracted inventory sample enrichment from `display-gap-inventory.ts`: link preview enrichment, Original evidence X Article preview application, and derived bucket/risk refresh.
- Extracted fresh X inventory capture from `display-gap-inventory.ts`: token resolution, X timeline fetching, raw snapshot and usage collection, and no-OpenAI inventory run construction.
- Extracted saved run loading and historical run selection from `display-gap-inventory.ts`: missing stores are empty, only live X runs with trace input posts are eligible, newest runs are preferred, and the configured history limit is enforced.
- Added unit coverage for those extracted boundaries.

**Track closeout:**

- `x-display:collect-local-renderings` was verified against the real saved X-derived run store after the final extraction.
- The display evidence command names, output paths, Reader behavior, evidence formats, and real-data policy remain unchanged.
- No further Display Evidence Tooling extraction is planned. A future change must start from a new concrete problem, not from file size or refactoring inertia.
- The Local Data And Evidence Stewardship and App Coordination tracks remain optional candidates. Neither is an automatic next step; each requires a separate owner decision.

**Verification:**

```bash
npm run test:unit
npm run data:inventory
npm run x-display:check-sample-types
npm run x-display:test-replay-rendering
```

For larger display-tooling changes:

```bash
npm run x-display:collect-local-renderings
npm run x-display:collect-original-renderings
npm run x-display:validate-diff-rules
DISPLAY_ORACLE_REQUIRE_ALL=1 npm run x-display:compare-rendering-facts
npm run x-display:build-screenshot-review
```

### 2. Local Data And Evidence Stewardship Boundary

**Status:** Candidate for Phase 2.

**Goal:** Make `.data/` easier to reason about as private product state plus reusable evidence, without deleting or rewriting owner data automatically.

**Why this comes second:** The project now depends on real local evidence: saved live runs, raw X snapshots, OpenAI cache, link preview cache, Original evidence, visual review packs, render coverage reports, and generated inventories. This is valuable, but it needs a clear lifecycle so future agents do not confuse product state, canonical evidence, generated reports, browser state, and transient diagnostics.

**Current pressure points:**

- `.data/` is large and valuable, but intentionally ignored by git.
- Canonical display baselines and generated reports live near ordinary debug artifacts.
- There is a read-only inventory command, but no accepted baseline registry or cleanup decision record.
- Fresh data collection is important, but it should not casually mutate product reading state unless that is the goal.

**Target shape:**

- Keep `npm run data:inventory` read-only.
- Add owner-readable records for accepted display baselines and evidence replacement decisions.
- Clarify which generated reports are disposable, which are canonical, and which are active investigation artifacts.
- If cleanup tooling is ever added, make it dry-run first and require explicit owner approval before deleting.
- Keep replay/smoke/display tests based on X-derived data, not fabricated timelines.

**Non-goals:**

- Do not migrate storage to SQLite in this track.
- Do not delete `.data` files automatically.
- Do not upload private evidence.

**Verification:**

```bash
npm run data:inventory
npm run test:unit
npm run test:smoke-api
npm run test:smoke-ui
npm run x-display:test-replay-rendering
```

### 3. App Coordination And Reader Shell Boundary

**Status:** Candidate for Phase 2, lower priority than tooling and data stewardship.

**Goal:** Keep `public/app.js` as a small browser app coordinator by moving remaining event, polling, and media-viewer coordination into focused modules when doing so reduces real complexity.

**Why this is not first:** Phase 1 already extracted the high-risk post rendering modules. The Reader works, and display fidelity has been heavily verified. The remaining `public/app.js` size is a maintainability concern, but it is less urgent than making the evidence tools and local data lifecycle easier to control.

**Current pressure points:**

- `public/app.js` still coordinates API state, polling, Pulse source state, job progress, rendering calls, media viewer behavior, and DOM event wiring.
- Media viewer behavior is important and visually sensitive.
- Any UI shell change can accidentally affect display fidelity even when post rendering modules are untouched.

**Target shape:**

- Extract only when a named responsibility becomes easier to test or explain.
- Keep rendering rules in `public/reader/` modules.
- Keep app coordination readable to a non-coding owner.
- Run display replay checks before and after any UI shell movement.

**Non-goals:**

- Do not redesign the UI in this track.
- Do not change X-like rendering rules unless a display evidence run shows a real mismatch.
- Do not start a frontend framework migration.

**Verification:**

```bash
npm run test:unit
npm run test:smoke-ui
npm run x-display:test-replay-rendering
```

If the change touches media viewer behavior, post layout, source links, or Signal placement:

```bash
npm run x-display:collect-local-renderings
npm run x-display:collect-original-renderings
DISPLAY_ORACLE_REQUIRE_ALL=1 npm run x-display:compare-rendering-facts
npm run x-display:build-screenshot-review
```

## Phase 1 Refactor Tracks

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
