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
npm run display:audit:login
npm run display:audit:auth
npm run fresh:audit
npm run test:coverage
npm run verify:refactor
```

`npm run smoke` and `npm run browser:smoke` start temporary local servers and force `TIMELINE_SOURCE=replay`. Before starting the server, each script copies the latest saved live X run from `.data/runs.json` into a smoke-specific run store under `.data/`, so verification does not reorder the user's real local reading history. The temporary run store is removed when the script exits. For browser UI fidelity checks against a known historical live run, pass `BROWSER_SMOKE_RUN_ID=<run-id>` to `npm run browser:smoke`.

Smoke replay does not call X or OpenAI. If `.data/runs.json` has no saved live X run, smoke fails and the fix is to run one live X refresh first.

Browser smoke validates the current reader surface rather than old debug/status chrome. It checks replay card count, one Chinese translation per card, one Original X status link per card, four X-like engagement metrics plus one 0-10 Signal action/disclosure per card, preservation of recorded media/quoted-post/link-preview structures from the saved live run, single-media X-like aspect-ratio geometry, the click-to-open media viewer, and video media behavior. Video media must autoplay muted inline from saved variants through `/api/media/proxy`; older replay data without variants is obsolete for video playback and should be replaced by a fresh Online Pulse.

`npm run display:regression` is the main local display regression guard for refactoring. It reads real saved live X runs from `.data/runs.json`, chooses a small set of runs that covers the required rendering buckets, and runs `browser:smoke` against each selected run. It does not call X or OpenAI and it does not construct fake posts. Required buckets currently include retweets, quotes, quote media, quote videos, single photo, single video, playable video, multi-media, external preview, external no-preview link, media plus external links, X status links, and text-only posts. If the local real run pool does not cover one of those shapes, the command fails and the fix is to run fresh Online Pulse until that real shape exists.

Because browser media playback can occasionally miss a timing window while still being correct on retry, display regression retries each selected run once by default. The report records the number of attempts. A run that fails all attempts is treated as a real regression.

`npm run verify:refactor` is the local pre-refactor baseline. It runs `doctor`, `test`, `smoke`, `browser:smoke`, and `display:regression` in order, stopping at the first failure. It deliberately does not run `display:audit` or `fresh:audit`, because those may require authenticated Original X pages or real X/OpenAI spend.

`npm run test:coverage` uses Node's native test coverage report for unit tests. Treat it as a map of untested areas, not a hard percentage target. It is useful before refactoring because it highlights modules that are only protected by smoke or browser tests.

`npm run display:audit` is the stricter X display-fidelity check. It builds a temporary replay store from saved live X runs, renders representative local Reader cards, opens each card's `Original` X URL, captures paired screenshots, and writes `.data/render-audit/.../report.md` plus `.data/render-audit/.../report.json`. Use `DISPLAY_AUDIT_MAX`, `DISPLAY_AUDIT_PER_BUCKET`, and `DISPLAY_AUDIT_RUN_IDS=<run-id>` to broaden or focus the sample across retweets, quote cards, media, videos, external previews, and media-plus-link posts. The audit targets the Original article by exact `status/{postId}` instead of taking the first article, because X conversation pages can show parent posts first. This audit may open many X pages and requires saved live X-derived runs. It exits non-zero when it finds mismatches; set `DISPLAY_AUDIT_ALLOW_ISSUES=1` only when deliberately collecting a report for investigation.

For Original pages that require login, initialize a local authenticated audit profile once:

```bash
npm run display:audit:login
```

This opens a dedicated Playwright browser profile at `.data/x-audit-browser-profile/`. The user logs into X in that browser window. The profile is ignored by git, and the script does not read, export, or print cookies. After that, run:

```bash
npm run display:audit:auth
```

`display:audit:auth` keeps the local Reader replay browser separate from the authenticated X browser profile. It exists for manual or release-grade display fidelity audits where login walls would otherwise hide valid Original posts.

Some X login flows, especially Google SSO, can reject automated browser profiles with a "browser or app may not be secure" message. Do not spend time bypassing that. For those cases, use the user's already-authenticated Chrome through the Codex Chrome connector to open the `Original` URLs listed in the display-audit report. That connector uses the real Chrome session for visual inspection and screenshots, while the repository scripts continue to generate the local replay screenshots, sample buckets, and report manifest.

## Test Layers

The test suite has three layers, each with a different purpose:

- **Unit and replay regression:** `npm test`, `npm run smoke`, and `npm run browser:smoke` use saved X-derived runs/traces. They are deterministic enough to protect refactors and should be run before architecture cleanup.
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
- **X-like rendering calibration:** `npm run display:audit`; use `npm run display:audit:auth` only when the audit profile works for the needed Original pages.
- **Before major refactors:** `npm run verify:refactor`, then `npm run test:coverage`, then a broad `DISPLAY_AUDIT_MAX=42 DISPLAY_AUDIT_PER_BUCKET=4 npm run display:audit` when Original X access is available.
- **Before declaring display fidelity stable after refactor:** `FRESH_PULSE_RUNS=3 npm run fresh:audit`.

## Evaluation Direction

Future prompt evals should use replay artifacts derived from saved X runs/traces, not generated mock timelines. Each replay artifact or note should include:

- Which posts should be excluded as ads.
- Which posts are duplicates.
- Which posts should rank highly.

The goal is not to make the AI perfectly deterministic. The goal is to catch regressions in product behavior and prompt behavior.
