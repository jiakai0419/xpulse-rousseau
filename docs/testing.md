# Testing Strategy

## What To Test First

- Exact text deduplication.
- Retweet duplicate deduplication.
- Obvious ad filtering.
- Strict OpenAI scoring/translation response handling.
- Pipeline selection of up to 7 posts.
- Seen Ledger filtering before OpenAI calls.
- OpenAI Cache reuse for scoring and translation.
- Local engagement scoring from latest metrics.
- Author-diverse final selection after ranking.
- Timeline cursor and X pagination behavior.
- Raw X snapshot recording for live timeline pages.
- Output shape for selected posts.
- Replay from saved X-derived run/trace data.
- Pulse job lifecycle: one running job at a time, progress preservation, commit ordering, failed-job reporting, and reader-safe job responses.

## Commands

```bash
node --experimental-strip-types --test tests/unit/*.test.ts
```

or:

```bash
npm run test:unit
npm run typecheck
npm run security:secrets
npm run test:server-entry
npm run data:inventory
npm run test:smoke-api
npm run test:smoke-ui
npm run x-display:test-replay-rendering
npm run x-display:collect-local-renderings
npm run x-display:collect-original-renderings
npm run x-display:compare-rendering-facts
npm run x-display:validate-diff-rules
npm run x-display:build-screenshot-review
npm run x-display:test-fresh-pulse-rendering
npm run x-display:check-sample-types
npm run test:coverage
npm run refactor:check-baseline
```

For a concise owner-readable command map, see [Command Guide](commands.md).

`npm run test:server-entry` executes the real HTTP entry point against empty isolated state, a unique OS-assigned port, blank provider credentials, and a unique health identity. It also exercises the wired Host, cross-site mutation, JSON content-type, and request-size boundaries, then requires a clean SIGTERM exit and removal of the state lock. It gives shared CI a provider-free startup/security/shutdown guard without inventing a product source.

`npm run test:smoke-api` and `npm run test:smoke-ui` start temporary local servers and force `TIMELINE_SOURCE=replay`. Before starting the server, each script copies the latest saved live X run from `.data/runs.json` into a unique run store under the system temporary directory, so parallel verification does not reorder or overwrite the user's real local reading history. The temporary run store is removed when the script exits. Explicit empty X/OpenAI environment values prevent `.env` from restoring real credentials. Each request/job loop has a deadline. For UI checks against a known historical live run, pass `BROWSER_SMOKE_RUN_ID=<run-id>` to `npm run test:smoke-ui`.

Smoke replay does not call the X API or OpenAI. Ordinary UI smoke also blocks non-local browser requests and intercepts the local video proxy, so X CDN availability cannot fail the cheap UI guard. Set `BROWSER_SMOKE_REQUIRE_REMOTE_MEDIA=1` only when deliberately verifying delivery from saved X media URLs. The actual Reader's Offline source mode can still retrieve images/video from X CDNs. If `.data/runs.json` has no saved live X run, API/UI smoke fails and the fix is to run one live X refresh first.

The older aliases `npm run smoke` and `npm run browser:smoke` were removed. Use `npm run test:smoke-api` and `npm run test:smoke-ui`.

`npm run data:inventory` is the read-only local data stewardship command. It scans `.data/`, classifies top-level files and directories by retention category, summarizes saved runs and Original X evidence, and writes `.data/data-inventory/.../report.md` plus `report.json`. It does not delete, archive, rewrite, upload, or call X/OpenAI. `npm run data:prune` is a separate dry-run retention planner that keeps the newest generated reports in each known timestamped family and preserves product state, baselines, durable Original screenshots, manual names, and unknown paths. Deletion requires `--apply --confirm=prune-generated-evidence`.

UI smoke validates the current reader surface rather than old debug/status chrome. It checks replay card count, one Chinese translation per card, one Original X status link per card, four X-like engagement metrics plus one 0-10 Signal action/disclosure per card, preservation of recorded media/quoted-post/link-preview structures from the saved live run, single-media X-like aspect-ratio geometry, the click-to-open modal media viewer, and video media behavior. It verifies saved media URLs and fit-to-screen CSS without requiring CDN bytes by default. Video markup must lazy-attach the saved proxied variant near the viewport, remain muted/inline, expose native controls, and keep a separate viewer trigger; older replay data without variants is obsolete for video playback and should be replaced by a fresh Online Pulse.

`npm run x-display:test-replay-rendering` is the main local replay rendering guard for refactoring. It reads real saved live X runs from `.data/runs.json`, chooses a small set of runs that covers the required rendering buckets, and runs the UI smoke path against each selected run. It checks that saved posts still render with the expected Reader card count, translations, Original links, metrics, Signal controls, media, quote cards, videos, and preview-card structures. It does not call the X API or OpenAI and it does not construct fake posts; external media bytes are blocked by default. Required buckets currently include retweets, quotes, quote media, quote videos, single photo, single video, playable video metadata, multi-media, external preview, external no-preview link, media plus external links, X status links, and text-only posts. If the local real run pool does not cover one of those shapes, the command fails and the fix is to run fresh Online Pulse until that real shape exists.

Because browser/layout startup can occasionally miss a timing window while still being correct on retry, the replay rendering guard retries each selected run once by default. The report records the number of attempts. A run that fails all attempts is treated as a real regression. Remote X media is still blocked by default; enable it explicitly only for a delivery-focused audit.

`npm run x-display:check-sample-types` is the real-data coverage inventory for Reader rendering. It scans recent saved live X runs and reports two pools: selected Top posts and broader trace input posts. The selected pool tells whether `test:smoke-ui` and `x-display:test-replay-rendering` have enough in-distribution examples. The trace input pool is broader and helps avoid learning X rendering rules from only Top 7 posts. It writes `.data/render-coverage/.../report.md` and `.data/render-coverage/.../report.json`. If a required bucket is thin or missing, run fresh Online Pulse, or use `FRESH_PULSE_RUNS=3 npm run x-display:test-fresh-pulse-rendering`, then rerun the coverage report. Set `RENDER_COVERAGE_STRICT=1` when a refactor should fail fast on missing required buckets.

`npm run x-display:collect-local-renderings` is the decision-making inventory for X display gaps. It scans saved live X-derived runs, optionally fetches fresh Following timeline posts directly from the X API, classifies rendering buckets and high-risk shapes, renders local Reader screenshots, and writes `.data/display-gap-inventory/.../report.md` plus `.data/display-gap-inventory/.../report.json`. It does not call OpenAI, does not update Seen Ledger, and does not update the product timeline cursor. Use it before deciding whether a display mismatch is a one-off badcase or a rendering rule gap:

```bash
npm run x-display:collect-local-renderings
DISPLAY_INVENTORY_FRESH=1 DISPLAY_INVENTORY_FRESH_TARGET=100 npm run x-display:collect-local-renderings
```

The inventory acquires the same product-state writer lock as the app because it can update the Link Preview cache and, in fresh mode, OAuth tokens. Stop the normal Reader server before running it. Its child replay renderer still uses a completely isolated temporary state root.

The inventory treats screenshots as first-class automated evidence. Local screenshots are captured and checked for blank/near-uniform output. Original X screenshots still require the user's already-authenticated normal Chrome window in this environment; the inventory therefore records exact Original URLs, local screenshots, DOM-like local facts, bucket/risk labels, and missing data patterns so high-risk rows can be compared without losing the broader sample map.

Local inventory screenshots use the system Chrome channel by default so video autoplay facts match the user's browser more closely. The inventory may enrich ordinary external preview metadata from the URL preview cache, and may enrich X Article preview metadata from authenticated Original evidence. These are evidence-backed audit inputs, not fabricated posts. If preview evidence is missing, the Oracle must still block or fail the row.

When capturing Original X screenshots from the user's normal Chrome session, prefer targeted article-region screenshots. Full-page Chrome screenshots on X can produce all-white captures even when the page is visible, and viewport fallback screenshots can include sidebars or unrelated conversation content. Screenshot probes and screenshot-quality checks must validate the saved image and record blank, low-quality, or non-target captures as tooling failures.

`npm run x-display:collect-original-renderings` manages long-lived Original X evidence. It reads the latest display inventory, imports any newly captured Original evidence, validates screenshots/facts, and reports the next missing batch. This lets large inventories be covered in several batches instead of one brittle run:

```bash
npm run x-display:collect-original-renderings
DISPLAY_ORIGINAL_CACHE_IMPORT=.data/.../original-chrome-results.json npm run x-display:collect-original-renderings
```

The cache lives at `.data/display-original-evidence/original-evidence-store.json` by default and is keyed by post id. A post already covered by a contentful Original screenshot and Original facts does not need to be recaptured unless the evidence is deleted or intentionally refreshed.

The next missing batch is written as `.data/display-original-evidence/.../next-batch.json`. Capture tools should consume that file, open each Original URL in the user's already-authenticated normal Chrome session, capture a contentful Original screenshot, collect Original facts, and write `original-chrome-results.json`. This keeps 100-225+ row inventories batchable without repeating already valid evidence.

The Chrome capture helper retries blank or low-quality Original screenshots instead of accepting them as evidence. Each sample gets fresh-tab capture attempts, article/media paint waits, viewport nudges, article-region screenshots, screenshot-probe validation, and screenshot-quality metadata. Viewport fallback captures are invalid for Oracle and should be recaptured rather than treated as passable evidence. The default is three capture attempts per sample; use `DISPLAY_ORIGINAL_CAPTURE_ATTEMPTS=<n>` only when Chrome/X is slow, not to hide persistent blank evidence.

`npm run x-display:compare-rendering-facts` is the hard display-fidelity facts comparison for a scoped sample set. It consumes local Reader rendering evidence plus Original X rendering evidence. For every checked post, local screenshots/facts and Original screenshots/facts are mandatory. Missing evidence, blank screenshots, low-quality screenshots, viewport/sidebar fallback captures, or failure to target the exact Original article makes the sample `blocked`, not passed. Local Reader facts vs Original X facts diffs make the sample `failed`. This command does not do screenshot pixel diff; screenshot evidence proves the compared renderings are real and targeted. Diff rules only explain detected diffs; they do not decide whether a diff exists.

```bash
npm run x-display:compare-rendering-facts
DISPLAY_ORACLE_REQUIRE_ALL=1 npm run x-display:compare-rendering-facts
```

By default, this command checks the collected local-rendering rows already covered by cached Original evidence. Set `DISPLAY_ORACLE_REQUIRE_ALL=1` when the goal is to prove that every collected row has valid Original evidence and no detected display diff.

The display-fidelity baseline should be evaluated as a full inventory, not as a few known badcases. The current V1 baseline is 225 real X-derived samples with valid local and Original evidence:

```bash
DISPLAY_ORACLE_REQUIRE_ALL=1 DISPLAY_ORACLE_INVENTORY_REPORT=.data/display-gap-inventory/display-gap-baseline-225-2026-06-14/report.json npm run x-display:compare-rendering-facts
```

The expected strict result is `OK x-display:compare-rendering-facts: 225 samples.`. Pair it with the screenshot review pack:

```bash
DISPLAY_VISUAL_REVIEW_INVENTORY_REPORT=.data/display-gap-inventory/display-gap-baseline-225-2026-06-14/report.json npm run x-display:build-screenshot-review
```

The accepted result from 2026-06-15 is `OK x-display:build-screenshot-review: 225 samples, 38 sheets.`. If a rendering change fixes one post but breaks another, these commands must fail or surface the visual gap before the change is considered safe.

Rendering facts-comparison exits are deliberately conservative:

- `blocked` exits non-zero in every mode, including `DISPLAY_ORACLE_ALLOW_DIFFS=1`.
- `failed` exits non-zero by default.
- `DISPLAY_ORACLE_ALLOW_DIFFS=1` is only for collecting non-strict reports with evidenced fact diffs.
- `DISPLAY_ORACLE_REQUIRE_ALL=1` makes full-inventory runs strict, so both blocked evidence and detected diffs fail the command.

`npm run x-display:validate-diff-rules` validates the checked-in diff-rule map at `docs/display-rule-ledger.json`. That map links known Local-vs-Original rendering diff types to exactly one documented rendering rule, plus the sample buckets, risks, X behavior, Reader rule, and evidence requirements that explain the diff. It is explanatory, not authoritative: a rule can explain a failure, but cannot turn missing local/Original evidence into a pass.

`npm run x-display:build-screenshot-review` generates the automated screenshot-comparison pack for the latest display inventory and Original evidence cache. It writes `.data/display-visual-review/.../index.html`, sheet PNGs, `review.json`, and `report.md`. Use it when the goal is to inspect visual diffs across a broad sample, especially when Oracle reports many `passed` rows but the UI still needs screenshot-level comparison. A visual finding from this pack should become either a rendering fix, a new Oracle fact/probe/test, or a documented data gap.

`npm run refactor:check-baseline` is the local pre-refactor baseline. It runs `env:check`, application type-checking, the isolated HTTP entry check, unit tests, API smoke, UI smoke, and `x-display:test-replay-rendering` in order, with a deadline for every child step and stopping at the first failure. It deliberately does not run Original X evidence capture or `x-display:test-fresh-pulse-rendering`, because those may require reachable Original X pages or real X/OpenAI spend.

`npm run test:coverage` uses Node's native test coverage report for unit tests. Treat it as a map of untested areas, not a hard percentage target. It is useful before refactoring because it highlights modules that are only protected by API smoke, UI smoke, or browser-driven tests.

For Original pages that require login, do not rely on automated X login from Playwright in this environment. X/Google has blocked dedicated automated audit profiles with login risk controls, so the old audit-profile auth/login commands and the one-pass legacy display audit were removed. If Original screenshots are needed, capture Original evidence from the user's already-authenticated normal Chrome session through `x-display:collect-original-renderings`, then compare with `x-display:compare-rendering-facts` and `x-display:build-screenshot-review`.

`npm run x-display:test-fresh-pulse-rendering` runs real Online Pulse, saves the fresh Top results, and immediately runs the Reader UI rendering smoke check on each new run id. It verifies the live chain from X fetch through OpenAI scoring/translation, run persistence, and distribution-outside Reader rendering. It does not open Original X or update Original evidence; use the reusable evidence flow for Local-vs-Original comparison. The child rendering check has its own timeout, controlled by `FRESH_PULSE_RENDERING_CHECK_TIMEOUT_MS`, so a broken UI run cannot hang the full validation indefinitely. Set `FRESH_PULSE_RENDERING_CHECK=0` only when deliberately collecting fresh runs without local UI assertions.

Fresh Pulse audit intentionally writes the real product state and obtains the real server-state lock. Stop any managed Reader server first; the command refuses a competing live owner rather than allowing two Online writers.

## Test Layers

The test suite has three layers, each with a different purpose:

- **Unit and replay regression:** `npm run test:unit`, `npm run test:smoke-api`, and `npm run test:smoke-ui` use saved X-derived runs/traces. They are deterministic enough to protect refactors and should be run before architecture cleanup.
- **Local data stewardship:** `npm run data:inventory` explains what is in `.data`; `npm run data:prune` previews a bounded known-family cleanup before an explicitly confirmed apply.
- **Sample type coverage:** `npm run x-display:check-sample-types` checks whether the local real X-derived run pool is broad enough before drawing conclusions from display tests.
- **Local rendering collection:** `npm run x-display:collect-local-renderings` collects broader historical/fresh real-data evidence, local screenshots, risk labels, and missing provider fields before deciding which X-like rendering mismatches to fix.
- **Original rendering collection:** `npm run x-display:collect-original-renderings` tracks batch-captured Original X screenshots/facts and reports what still needs to be captured.
- **Rendering facts comparison:** `npm run x-display:compare-rendering-facts` compares local Reader facts with Original X facts against mandatory local/Original evidence. Rules explain failures; evidence decides whether a diff exists.
- **Diff rule validation:** `npm run x-display:validate-diff-rules` validates that every known Local-vs-Original rendering diff has one owner and points back to sample buckets/risks.
- **Screenshot review pack:** `npm run x-display:build-screenshot-review` puts local and Original screenshots side by side as an automated screenshot-comparison artifact so Codex can inspect broad visual differences that facts may not yet encode.
- **Replay rendering test:** `npm run x-display:test-replay-rendering` is the broad in-distribution guard for X-like rendering. Run it before and after UI refactors.
- **Fresh Pulse validation:** `npm run x-display:test-fresh-pulse-rendering` creates new saved live runs through Online Pulse and immediately runs Reader UI rendering checks on the new run ids. For display-sensitive changes, validate at least three fresh Online Pulse runs with `FRESH_PULSE_RUNS=3 npm run x-display:test-fresh-pulse-rendering` so the sample includes distribution-outside historical replay. This path calls X and OpenAI and should be used deliberately.

GitHub Actions CI is intentionally narrower than the local refactor baseline. CI runs `npm ci`, `env:check`, application `typecheck`, the worktree secret scan, the isolated HTTP entry check, unit tests, and native coverage on push and pull request. It does not run `.data`-dependent replay/display tests or real X/OpenAI audits. Treat CI as the shared logic/startup/credential gate, and treat `npm run refactor:check-baseline` plus X display/fresh Pulse validation as the local product-fidelity gate.

Replay regression and display fidelity are deliberately separate. Replay regression proves the Reader still follows the documented rendering rules on real stored inputs. Display fidelity checks whether those rules still match X on live Original pages.

For the owner-readable behavior-to-test map, see [Test Coverage Matrix](test-coverage-matrix.md). Update that matrix when adding a new V1 behavior, changing a major pipeline rule, or introducing a new refactor guard.

## When To Run What

- **Every logic change:** `npm run test:unit`.
- **Pipeline, X, OpenAI, storage, or environment changes:** `npm run env:check`, `npm run test:unit`, `npm run test:smoke-api`.
- **Reader UI or rendering changes:** `npm run test:smoke-ui`, then `npm run x-display:test-replay-rendering`.
- **X-like rendering calibration:** use `x-display:collect-local-renderings`, `x-display:collect-original-renderings`, `x-display:compare-rendering-facts`, and `x-display:build-screenshot-review`.
- **Before cleanup or evidence-store decisions:** `npm run data:inventory`.
- **Before major refactors:** `npm run data:inventory`, then `npm run refactor:check-baseline`, then `npm run test:coverage`, then the X display evidence flow when Original X access is needed.
- **Before drawing rendering conclusions from historical data:** `npm run x-display:check-sample-types`; if the report is thin, collect more live X-derived runs first.
- **Before deciding whether to fix a display badcase:** `npm run x-display:collect-local-renderings`; use `DISPLAY_INVENTORY_FRESH=1 DISPLAY_INVENTORY_FRESH_TARGET=100 npm run x-display:collect-local-renderings` when historical samples are too narrow or stale. Then run `npm run x-display:collect-original-renderings`, `npm run x-display:validate-diff-rules`, and `DISPLAY_ORACLE_REQUIRE_ALL=1 npm run x-display:compare-rendering-facts` for the full inventory being judged.
- **Before summarizing display gaps across a broad inventory:** `npm run x-display:build-screenshot-review`, then inspect every generated sheet. Treat `passed` Oracle rows as "no known fact diff plus valid screenshot evidence", not as proof that every visual detail has already been encoded as a fact.
- **Before declaring display fidelity stable after refactor:** `FRESH_PULSE_RUNS=3 npm run x-display:test-fresh-pulse-rendering`.

## Evaluation Direction

Future prompt evals should use replay artifacts derived from saved X runs/traces, not generated mock timelines. Each replay artifact or note should include:

- Which posts should be excluded as ads.
- Which posts are duplicates.
- Which posts should rank highly.

The goal is not to make the AI perfectly deterministic. The goal is to catch regressions in product behavior and prompt behavior.
