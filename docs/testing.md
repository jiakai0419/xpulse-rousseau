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
npm test
npm run smoke
npm run browser:smoke
npm run display:regression
npm run display:audit
npm run display:audit:auth
npm run display:inventory
npm run display:original-cache
npm run display:oracle
npm run display:rule-ledger
npm run display:visual-review
npm run fresh:audit
npm run render:coverage
npm run test:coverage
npm run verify:refactor
```

`npm run smoke` and `npm run browser:smoke` start temporary local servers and force `TIMELINE_SOURCE=replay`. Before starting the server, each script copies the latest saved live X run from `.data/runs.json` into a smoke-specific run store under `.data/`, so verification does not reorder the user's real local reading history. The temporary run store is removed when the script exits. For browser UI fidelity checks against a known historical live run, pass `BROWSER_SMOKE_RUN_ID=<run-id>` to `npm run browser:smoke`.

Smoke replay does not call X or OpenAI. If `.data/runs.json` has no saved live X run, smoke fails and the fix is to run one live X refresh first.

Browser smoke validates the current reader surface rather than old debug/status chrome. It checks replay card count, one Chinese translation per card, one Original X status link per card, four X-like engagement metrics plus one 0-10 Signal action/disclosure per card, preservation of recorded media/quoted-post/link-preview structures from the saved live run, single-media X-like aspect-ratio geometry, the click-to-open media viewer, and video media behavior. Media viewer image checks use the real saved X media URL; when the remote original image loads in time, smoke verifies viewport geometry, and when the X CDN is slow, it verifies the real media source plus fit-to-screen CSS instead of treating third-party image latency as a reader regression. Video media must autoplay muted inline from saved variants through `/api/media/proxy`; older replay data without variants is obsolete for video playback and should be replaced by a fresh Online Pulse.

`npm run display:regression` is the main local display regression guard for refactoring. It reads real saved live X runs from `.data/runs.json`, chooses a small set of runs that covers the required rendering buckets, and runs `browser:smoke` against each selected run. It does not call X or OpenAI and it does not construct fake posts. Required buckets currently include retweets, quotes, quote media, quote videos, single photo, single video, playable video, multi-media, external preview, external no-preview link, media plus external links, X status links, and text-only posts. If the local real run pool does not cover one of those shapes, the command fails and the fix is to run fresh Online Pulse until that real shape exists.

Because browser media playback can occasionally miss a timing window while still being correct on retry, display regression retries each selected run once by default. The report records the number of attempts. A run that fails all attempts is treated as a real regression.

`npm run render:coverage` is the real-data coverage inventory for Reader rendering. It scans recent saved live X runs and reports two pools: selected Top posts and broader trace input posts. The selected pool tells whether `browser:smoke` and `display:regression` have enough in-distribution examples. The trace input pool is broader and helps avoid learning X rendering rules from only Top 7 posts. It writes `.data/render-coverage/.../report.md` and `.data/render-coverage/.../report.json`. If a required bucket is thin or missing, run fresh Online Pulse, or use `FRESH_PULSE_RUNS=3 npm run fresh:audit`, then rerun the coverage report. Set `RENDER_COVERAGE_STRICT=1` when a refactor should fail fast on missing required buckets.

`npm run display:inventory` is the decision-making inventory for X display gaps. It scans saved live X-derived runs, optionally fetches fresh Following timeline posts directly from the X API, classifies rendering buckets and high-risk shapes, renders local Reader screenshots, and writes `.data/display-gap-inventory/.../report.md` plus `.data/display-gap-inventory/.../report.json`. It does not call OpenAI, does not update Seen Ledger, and does not update the product timeline cursor. Use it before deciding whether a display mismatch is a one-off badcase or a rendering rule gap:

```bash
npm run display:inventory
DISPLAY_INVENTORY_FRESH=1 DISPLAY_INVENTORY_FRESH_TARGET=100 npm run display:inventory
```

The inventory treats screenshots as first-class automated evidence. Local screenshots are captured and checked for blank/near-uniform output. Original X screenshots still require the user's already-authenticated normal Chrome window in this environment; the inventory therefore records exact Original URLs, local screenshots, DOM-like local facts, bucket/risk labels, and missing data patterns so high-risk rows can be compared without losing the broader sample map.

Local inventory screenshots use the system Chrome channel by default so video autoplay facts match the user's browser more closely. The inventory may enrich ordinary external preview metadata from the URL preview cache, and may enrich X Article preview metadata from authenticated Original evidence. These are evidence-backed audit inputs, not fabricated posts. If preview evidence is missing, the Oracle must still block or fail the row.

When capturing Original X screenshots from the user's normal Chrome session, prefer targeted article-region screenshots. Full-page Chrome screenshots on X can produce all-white captures even when the page is visible, and viewport fallback screenshots can include sidebars or unrelated conversation content. Screenshot probes and screenshot-quality checks must validate the saved image and record blank, low-quality, or non-target captures as tooling failures.

`npm run display:original-cache` manages long-lived Original X evidence. It reads the latest display inventory, imports any newly captured Original evidence, validates screenshots/facts, and reports the next missing batch. This lets large inventories be covered in several batches instead of one brittle run:

```bash
npm run display:original-cache
DISPLAY_ORIGINAL_CACHE_IMPORT=.data/.../original-chrome-results.json npm run display:original-cache
```

The cache lives at `.data/display-original-evidence/original-evidence-store.json` by default and is keyed by post id. A post already covered by a contentful Original screenshot and Original facts does not need to be recaptured unless the evidence is deleted or intentionally refreshed.

The next missing batch is written as `.data/display-original-evidence/.../next-batch.json`. Capture tools should consume that file, open each Original URL in the user's already-authenticated normal Chrome session, capture a contentful Original screenshot, collect Original facts, and write `original-chrome-results.json`. This keeps 100-225+ row inventories batchable without repeating already valid evidence.

The Chrome capture helper retries blank or low-quality Original screenshots instead of accepting them as evidence. Each sample gets fresh-tab capture attempts, article/media paint waits, viewport nudges, article-region screenshots, screenshot-probe validation, and screenshot-quality metadata. Viewport fallback captures are invalid for Oracle and should be recaptured rather than treated as passable evidence. The default is three capture attempts per sample; use `DISPLAY_ORIGINAL_CAPTURE_ATTEMPTS=<n>` only when Chrome/X is slow, not to hide persistent blank evidence.

`npm run display:oracle` is the hard display-fidelity judge for a scoped sample set. It consumes a display inventory plus Original evidence from the cache. For every checked post, local screenshots/facts and Original screenshots/facts are mandatory. Missing evidence, blank screenshots, low-quality screenshots, viewport/sidebar fallback captures, or failure to target the exact Original article makes the sample `blocked`, not passed. Local/Original fact diffs make the sample `failed`. Rule names only explain diffs; they do not decide whether a diff exists.

```bash
npm run display:oracle
DISPLAY_ORACLE_REQUIRE_ALL=1 npm run display:oracle
```

By default, Oracle checks the inventory rows already covered by cached Original evidence. Set `DISPLAY_ORACLE_REQUIRE_ALL=1` when the goal is to prove that every row in the inventory has valid Original evidence and no detected display diff.

The display-fidelity baseline should be evaluated as a full inventory, not as a few known badcases. The current V1 baseline is 225 real X-derived samples with valid local and Original evidence:

```bash
DISPLAY_ORACLE_REQUIRE_ALL=1 DISPLAY_ORACLE_INVENTORY_REPORT=.data/display-gap-inventory/display-gap-baseline-225-2026-06-14/report.json npm run display:oracle
```

The expected strict result is `OK display oracle: 225 samples.`. Pair it with the screenshot review pack:

```bash
DISPLAY_VISUAL_REVIEW_INVENTORY_REPORT=.data/display-gap-inventory/display-gap-baseline-225-2026-06-14/report.json npm run display:visual-review
```

The accepted result from 2026-06-15 is `OK display visual review: 225 samples, 38 sheets.`. If a rendering change fixes one post but breaks another, these commands must fail or surface the visual gap before the change is considered safe.

Oracle command exits are deliberately conservative:

- `blocked` exits non-zero in every mode, including `DISPLAY_ORACLE_ALLOW_DIFFS=1`.
- `failed` exits non-zero by default.
- `DISPLAY_ORACLE_ALLOW_DIFFS=1` is only for collecting non-strict reports with evidenced fact diffs.
- `DISPLAY_ORACLE_REQUIRE_ALL=1` makes full-inventory runs strict, so both blocked evidence and detected diffs fail the command.

`npm run display:rule-ledger` validates the checked-in rule ledger at `docs/display-rule-ledger.json`. The ledger links Inventory buckets/risks to Oracle diff classes. It is explanatory, not authoritative: a rule can explain a failure, but cannot turn missing local/Original evidence into a pass.

`npm run display:visual-review` generates the automated screenshot-comparison pack for the latest display inventory and Original evidence cache. It writes `.data/display-visual-review/.../index.html`, sheet PNGs, `review.json`, and `report.md`. Use it when the goal is to inspect visual diffs across a broad sample, especially when Oracle reports many `passed` rows but the UI still needs screenshot-level comparison. A visual finding from this pack should become either a rendering fix, a new Oracle fact/probe/test, or a documented data gap.

`npm run verify:refactor` is the local pre-refactor baseline. It runs `doctor`, `test`, `smoke`, `browser:smoke`, and `display:regression` in order, stopping at the first failure. It deliberately does not run `display:audit` or `fresh:audit`, because those may require authenticated Original X pages or real X/OpenAI spend.

`npm run test:coverage` uses Node's native test coverage report for unit tests. Treat it as a map of untested areas, not a hard percentage target. It is useful before refactoring because it highlights modules that are only protected by smoke or browser tests.

`npm run display:audit` is the stricter X display-fidelity check. It builds a temporary replay store from saved live X runs, renders representative local Reader cards, opens each card's `Original` X URL, captures paired screenshots, and writes `.data/render-audit/.../report.md` plus `.data/render-audit/.../report.json`. Use `DISPLAY_AUDIT_MAX`, `DISPLAY_AUDIT_PER_BUCKET`, and `DISPLAY_AUDIT_RUN_IDS=<run-id>` to broaden or focus the sample across retweets, quote cards, media, videos, external previews, and media-plus-link posts. The audit targets the Original article by exact `status/{postId}` instead of taking the first article, because X conversation pages can show parent posts first. It validates Original screenshots for blank or near-uniform captures and retries before reporting `original_screenshot_blank:<reason>`. This audit may open many X pages and requires saved live X-derived runs. It exits non-zero when it finds mismatches; set `DISPLAY_AUDIT_ALLOW_ISSUES=1` only when deliberately collecting a report for investigation.

For Original pages that require login, do not rely on automated X login from Playwright in this environment. X/Google has blocked the dedicated audit profile with login risk controls, so the login helper fails fast by design:

```bash
npm run display:audit:login
```

`display:audit:auth` is retained only for the rare case where `.data/x-audit-browser-profile/` is already authenticated by some external means. It keeps the local Reader replay browser separate from that profile, but it is not a supported login/setup path:

```bash
npm run display:audit:auth
```

Authenticated audits fail fast when the audit profile is not logged in. Tune `DISPLAY_AUDIT_AUTH_TIMEOUT_MS` only when X is unusually slow. If Original screenshots are needed, inspect the Original URLs manually from the user's already-authenticated normal Chrome window. If a local replay report is still useful, run `DISPLAY_AUDIT_SKIP_ORIGINAL=1 npm run display:audit`; that mode intentionally skips Original comparison and should not be used to declare X display fidelity complete.

`npm run fresh:audit` runs `display:audit` after each real Online Pulse run. The child display audit has its own timeout, controlled by `FRESH_PULSE_DISPLAY_AUDIT_TIMEOUT_MS`, so a broken X session cannot hang the full distribution-outside validation indefinitely.

## Test Layers

The test suite has three layers, each with a different purpose:

- **Unit and replay regression:** `npm test`, `npm run smoke`, and `npm run browser:smoke` use saved X-derived runs/traces. They are deterministic enough to protect refactors and should be run before architecture cleanup.
- **Render coverage inventory:** `npm run render:coverage` checks whether the local real X-derived run pool is broad enough before drawing conclusions from display tests.
- **Display gap inventory:** `npm run display:inventory` collects broader historical/fresh real-data evidence, local screenshots, risk labels, and missing provider fields before deciding which X-like rendering mismatches to fix.
- **Original evidence cache:** `npm run display:original-cache` tracks batch-captured Original X screenshots/facts and reports what still needs to be captured.
- **Display Oracle:** `npm run display:oracle` judges audited samples against mandatory local/Original evidence. Rules explain failures; evidence decides whether a diff exists.
- **Rule Ledger:** `npm run display:rule-ledger` validates that every known Oracle diff has one owner and points back to Inventory buckets/risks.
- **Visual review pack:** `npm run display:visual-review` puts local and Original screenshots side by side as an automated screenshot-comparison artifact so Codex can inspect broad visual differences that facts may not yet encode.
- **Display regression:** `npm run display:regression` is the broad in-distribution guard for X-like rendering. Run it before and after UI refactors.
- **Display fidelity audit:** `npm run display:audit` or `npm run display:audit:auth` compares local rendering with Original X pages. It is the calibration layer for X-like UI behavior, not the only regression test, because X is dynamic.
- **Fresh Pulse validation:** `npm run fresh:audit` creates new saved live runs through Online Pulse and immediately audits the new run ids. For display-sensitive changes, validate at least three fresh Online Pulse runs with `FRESH_PULSE_RUNS=3 npm run fresh:audit` so the sample includes distribution-outside historical replay. This path calls X and OpenAI and should be used deliberately.

GitHub Actions CI is intentionally narrower than the local refactor baseline. CI runs `npm ci`, `npm run doctor`, `npm test`, and `npm run test:coverage` on push and pull request. It does not run `.data`-dependent replay/display tests or real X/OpenAI audits. Treat CI as the shared logic gate, and treat `npm run verify:refactor` plus display/fresh audits as the local product-fidelity gate.

Replay regression and display fidelity are deliberately separate. Replay regression proves the Reader still follows the documented rendering rules on real stored inputs. Display fidelity checks whether those rules still match X on live Original pages.

For the owner-readable behavior-to-test map, see [Test Coverage Matrix](test-coverage-matrix.md). Update that matrix when adding a new V1 behavior, changing a major pipeline rule, or introducing a new refactor guard.

## When To Run What

- **Every logic change:** `npm test`.
- **Pipeline, X, OpenAI, storage, or environment changes:** `npm run doctor`, `npm test`, `npm run smoke`.
- **Reader UI or rendering changes:** `npm run browser:smoke`, then `npm run display:regression`.
- **X-like rendering calibration:** `npm run display:audit`; use `DISPLAY_AUDIT_SKIP_ORIGINAL=1 npm run display:audit` for local replay reports, and inspect Original X pages manually from already-authenticated Chrome when needed.
- **Before major refactors:** `npm run verify:refactor`, then `npm run test:coverage`, then a broad `DISPLAY_AUDIT_MAX=42 DISPLAY_AUDIT_PER_BUCKET=4 npm run display:audit` when Original X access is available.
- **Before drawing rendering conclusions from historical data:** `npm run render:coverage`; if the report is thin, collect more live X-derived runs first.
- **Before deciding whether to fix a display badcase:** `npm run display:inventory`; use `DISPLAY_INVENTORY_FRESH=1 DISPLAY_INVENTORY_FRESH_TARGET=100 npm run display:inventory` when historical samples are too narrow or stale. Then run `npm run display:original-cache`, `npm run display:rule-ledger`, and `DISPLAY_ORACLE_REQUIRE_ALL=1 npm run display:oracle` for the full inventory being judged.
- **Before summarizing display gaps across a broad inventory:** `npm run display:visual-review`, then inspect every generated sheet. Treat `passed` Oracle rows as "no known fact diff plus valid screenshot evidence", not as proof that every visual detail has already been encoded as a fact.
- **Before declaring display fidelity stable after refactor:** `FRESH_PULSE_RUNS=3 npm run fresh:audit`.

## Evaluation Direction

Future prompt evals should use replay artifacts derived from saved X runs/traces, not generated mock timelines. Each replay artifact or note should include:

- Which posts should be excluded as ads.
- Which posts are duplicates.
- Which posts should rank highly.

The goal is not to make the AI perfectly deterministic. The goal is to catch regressions in product behavior and prompt behavior.
