# xpulse-rousseau

A local-first web reader for quickly screening X.com following-timeline posts and reading the best ones with Chinese translation.

The project is intentionally small at the start: modular TypeScript, reliable environment checks, a strict live X path, and a local replay path based on saved X runs.

## Current V1 Shape

- Active refresh, initiated by the user.
- In live mode, prefer newer authenticated X home-timeline posts with a local cursor, then fall back to recent paginated timeline pages when needed.
- Replay saved X-derived runs without new X/OpenAI calls or online-state mutation.
- Remove obvious ads and exact/retweet duplicates.
- Skip posts that were already shown in previous live selected sets.
- Score posts with weighted dimensions, including OpenAI quality dimensions and a local engagement signal from the latest X metrics.
- Cache OpenAI scoring and translation outputs by operation, model, prompt version, and source-content fingerprint.
- Keep at most one selected post per author after scoring, choosing that author's highest-ranked post.
- Show up to 7 selected posts with Chinese translation in an X-like reading UI.
- Trigger a run with the `Pulse` action; scoring details live behind `Signal`, and usage stays secondary.

## Run

```bash
npm run dev
```

Then open:

```txt
http://localhost:3000
```

## Test

```bash
npm test
```

Run the native coverage report when preparing larger refactors:

```bash
npm run test:coverage
```

Run browser and display-fidelity checks:

```bash
npm run browser:smoke
npm run display:regression
npm run display:inventory
npm run display:original-cache
npm run display:oracle
npm run display:rule-ledger
npm run display:audit
```

When Original X pages require login during display-fidelity work, do not rely on automated X login from Playwright. In this environment X/Google blocks the dedicated audit profile, so the login helper fails fast by design:

```bash
npm run display:audit:login
```

`display:audit:auth` is retained only for the rare case where `.data/x-audit-browser-profile/` is already authenticated by some external means. It is not a supported setup path. When the profile is not authenticated, it fails fast instead of opening a login flow.

Use `DISPLAY_AUDIT_SKIP_ORIGINAL=1 npm run display:audit` only when you deliberately want a local replay report without Original X screenshots. For rigorous Original X comparison, use the Display Oracle flow: `display:inventory` finds real-data candidates, `display:original-cache` tracks which Original screenshots/facts have been captured from the user's already-authenticated normal Chrome session, and `display:oracle` blocks any checked sample with missing or blank local or Original evidence.

For distribution-outside validation after display-sensitive refactors, run a real Online Pulse audit deliberately:

```bash
FRESH_PULSE_RUNS=3 npm run fresh:audit
```

This path calls X and OpenAI, so it is not part of the ordinary cheap test loop.

Before broad refactors, run the local pre-refactor baseline:

```bash
npm run verify:refactor
```

This runs the environment doctor, unit tests, replay smoke, browser smoke, and display regression without calling X or OpenAI.

## CI

GitHub Actions runs the basic repository checks on push and pull request:

```bash
npm ci
npm run doctor
npm test
npm run test:coverage
```

CI intentionally does not run replay smoke, browser smoke, display regression, display audit, or fresh audit because those depend on local saved X-derived `.data` runs, browser media behavior, authenticated Original X pages, or real X/OpenAI usage.

## Environment Doctor

Run this before changing infrastructure, dependencies, browser automation, X API, or OpenAI integration:

```bash
npm run doctor
```

Run an end-to-end local smoke check:

```bash
npm run smoke
```

## Configuration

Copy `.env.example` to `.env` once credentials are available.

```txt
X_USER_ID=
X_USER_ACCESS_TOKEN=
X_CLIENT_ID=
X_CLIENT_SECRET=
X_REDIRECT_URI=http://127.0.0.1:3000/api/auth/x/callback
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5
OPENAI_SCORING_BATCH_SIZE=20
OPENAI_TRANSLATION_BATCH_SIZE=10
SELECTED_POST_COUNT=7
X_TIMELINE_PAGE_SIZE=100
X_TIMELINE_TARGET_POSTS=100
X_TIMELINE_MAX_PAGES=3
TIMELINE_SOURCE=replay
```

Without credentials, live refresh fails. Replay uses saved `.data/runs.json` history instead of generated local timelines.

Scoring and translation share `OPENAI_MODEL` by default. To lower OpenAI cost during development, set `OPENAI_MODEL=gpt-5-nano`.

## Project Docs

- [Product brief](docs/product.md)
- [V1 accepted behavior](docs/v1-accepted-behavior.md)
- [Architecture](docs/architecture.md)
- [Environment](docs/environment.md)
- [X OAuth setup](docs/integrations/x-oauth.md)
- [Testing strategy](docs/testing.md)
- [Test coverage matrix](docs/test-coverage-matrix.md)
- [Display fidelity oracle](docs/display-fidelity-oracle.md)
- [Display rule ledger](docs/display-rule-ledger.json)
- [Refactoring plan](docs/refactoring-plan.md)
- [Usage design](docs/usage.md)
- [Run trace design](docs/run-trace.md)
- [Online Pulse state](docs/online-pulse-state.md)
- [UI rendering notes](docs/ui-rendering.md)
- [Ranking design](docs/ranking-plan.md)
- [Scoring prompt spec](docs/prompts/scoring-v2.md)
- [Translation prompt spec](docs/prompts/translation-v2.md)
- [ADR 0002: Live and replay, no silent fallback](docs/decisions/0002-live-and-replay-no-fallback.md)
- [Agent rules](AGENTS.md)
