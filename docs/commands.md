# Command Guide

This guide explains the project commands in product language. Keep it updated when adding, renaming, or retiring commands.

## Everyday Commands

| Command | Purpose | Calls X/OpenAI? |
| --- | --- | --- |
| `npm run server:start` | Start the local web app. | No |
| `npm run server:stop` | Stop the local web app started by `npm run server:start`. | No |
| `npm run env:check` | Check local environment, ports, Node, GitHub CLI, and browser tooling assumptions. | No |
| `npm run typecheck` | Strictly type-check application source, including the HTTP entry point. | No |
| `npm run security:secrets` | Scan tracked and untracked worktree files for common credential-shaped values without printing the value. | No |
| `npm run test:unit` | Run the unit test suite. | No |
| `npm run test:coverage` | Run unit tests with Node's native coverage report. | No |
| `npm run test:server-entry` | Start an isolated empty server; verify health, HTTP safety wiring, graceful exit, and state-lock cleanup. | No |
| `npm run test:smoke-api` | Start a temporary replay server and verify the reader API path from a saved live X run. | No |
| `npm run test:smoke-ui` | Start a temporary replay server and verify the reader UI path from a saved live X run with Playwright; external media is blocked by default. | No |
| `npm run refactor:check-baseline` | Run the timed local baseline: environment, type, HTTP entry, unit, API/UI smoke, and replay rendering checks. | No |

## Local Data Stewardship

| Command | Purpose | Calls X/OpenAI? |
| --- | --- | --- |
| `npm run data:inventory` | Scan `.data/`, classify local assets, and summarize saved runs and Original evidence before cleanup or evidence-heavy work. | No |
| `npm run data:prune` | Dry-run a bounded cleanup plan for old timestamped generated reports; product state, baselines, durable Original screenshots, and unknown paths are preserved. | No |

`data:prune` never deletes by default. After reviewing the dry run (use `--verbose` for every path), apply the exact known-family policy explicitly:

```bash
npm run data:prune -- --verbose
npm run data:prune -- --keep=5 --apply --confirm=prune-generated-evidence
```

## X Display Fidelity Workflow

These commands protect the X-like rendering surface. They use real X-derived data rather than mock timeline sources.

| Step | Command | What It Answers | Calls X/OpenAI? |
| --- | --- | --- | --- |
| 1 | `npm run x-display:check-sample-types` | Do saved real samples cover enough rendering types, such as retweets, quotes, videos, multi-media, external previews, X status links, and text-only posts? | No |
| 2 | `npm run x-display:test-replay-rendering` | Does the Reader still render saved real X runs correctly in replay/offline mode? External media is blocked unless explicitly enabled. | No |
| 3 | `npm run x-display:collect-local-renderings` | What does our local Reader render for a broad sample set? Captures local screenshots, local facts, buckets, risks, and missing-data signals. | Optional X API only when `DISPLAY_INVENTORY_FRESH=1` |
| 4 | `npm run x-display:collect-original-renderings` | What does Original X render for the same posts? Plans or imports reusable Original screenshots and Original facts keyed by post id. | Uses captured Chrome results; the command itself does not call OpenAI |
| 5 | `npm run x-display:compare-rendering-facts` | Do local Reader facts and Original X facts disagree for checked posts? This is a structured facts comparison, not a screenshot pixel diff. Missing or low-quality evidence blocks the sample instead of passing it. | No |
| 6 | `npm run x-display:validate-diff-rules` | Are known rendering diff types mapped to exactly one documented rendering rule with evidence requirements and sample references? | No |
| 7 | `npm run x-display:build-screenshot-review` | Build the automated side-by-side screenshot comparison pack from local and Original evidence. | No |
| 8 | `npm run x-display:test-fresh-pulse-rendering` | Run real Online Pulse, save fresh Top results, and immediately run Reader UI rendering checks against each new run id. Original X comparison remains the reusable evidence flow above. | Yes, calls X and OpenAI |

The usual display-fidelity investigation flow is:

```bash
npm run x-display:check-sample-types
npm run x-display:collect-local-renderings
npm run x-display:collect-original-renderings
npm run x-display:validate-diff-rules
DISPLAY_ORACLE_REQUIRE_ALL=1 npm run x-display:compare-rendering-facts
npm run x-display:build-screenshot-review
```

`x-display:collect-local-renderings` acquires the product-state writer lock because preview enrichment and optional OAuth refresh can update caches/tokens. Stop the normal Reader server first. Fresh Pulse audit also writes the real Run/Seen/Cursor state and must not run beside another server. Cheap replay smoke uses isolated temporary state and can run independently.

For display-sensitive release validation, run fresh Pulse deliberately:

```bash
FRESH_PULSE_RUNS=3 npm run x-display:test-fresh-pulse-rendering
```

This path spends real X/OpenAI usage and should not be part of the cheap loop.

From the moment the audit attempts the Pulse POST—including when the response is lost before a job id arrives—it treats paid work as possibly started. If polling disconnects or reaches `FRESH_PULSE_TIMEOUT_MS`, the audit signals the server to drain and then waits up to `FRESH_PULSE_SHUTDOWN_TIMEOUT_MS` (25 minutes by default, or the larger job timeout). It keeps waiting after that deadline instead of force-killing paid work. `FRESH_PULSE_FORCE_KILL_ON_SHUTDOWN_TIMEOUT=1` is an explicit emergency escape hatch; using it can discard provider work that was already billed.

## Internal Helper Scripts

Most scripts should be reached through the command names above. A few files in `scripts/` are intentionally internal because they hold shared logic for commands or tests:

| Script | Role |
| --- | --- |
| `scripts/data-inventory-core.mjs` | Shared data inventory classifiers used by `data:inventory` and unit tests. |
| `scripts/display-evidence-assets.mjs` | Shared Original evidence screenshot asset normalization: copies imported screenshots into durable `.data/display-original-evidence` storage and repairs old missing paths only when one matching durable screenshot exists. |
| `scripts/display-evidence-core.mjs` | Shared display evidence contracts for local screenshots/facts, Original X evidence, contentful probes, and evidence coverage. |
| `scripts/display-gap-inventory-core.mjs` | Shared local inventory run, sample-selection, audit-run, and report construction rules used by `x-display:collect-local-renderings` and unit tests. |
| `scripts/display-inventory-enrichment.mjs` | Shared inventory enrichment stage for cached link previews, Original X Article evidence, and refreshed bucket/risk/missing-data fields. |
| `scripts/display-inventory-fresh-capture.mjs` | Shared optional fresh X capture stage for token resolution, timeline fetching, raw snapshots, usage, and no-OpenAI inventory runs. |
| `scripts/display-inventory-history-runs.mjs` | Shared historical evidence selection: loads saved runs, keeps newest live X runs with trace input posts, and enforces the configured history limit. |
| `scripts/display-inventory-samples.mjs` | Shared display inventory sample contract: derives buckets, risks, missing-data signals, X Article preview evidence enrichment, and report JSON fields for local rendering inventories. |
| `scripts/display-local-reader-evidence.mjs` | Shared local Reader evidence capture: starts a replay server, opens the Reader in Playwright, captures local screenshots, local DOM facts, and screenshot probes for inventory samples. |
| `scripts/display-oracle-core.mjs` | Shared Local-vs-Original rendering comparison logic used by display commands and tests. |
| `scripts/display-original-capture-core.mjs` | Shared pure Original X capture rules: target article matching, target normalization, screenshot filename slugs, contentful screenshot probes, CSS clip scaling, validation errors, and retry classification. |
| `scripts/display-original-evidence-cache-core.mjs` | Shared pure Original evidence cache rules: compact capture-batch samples, plan the next missing/invalid Original capture batch, and build stable cache reports. |
| `scripts/display-screenshot-quality.mjs` | Screenshot quality probes used by Original evidence and Oracle checks. |
| `scripts/env-utils.mjs` | Shared host, process, and temporary server helpers. |
| `scripts/data-prune-core.mjs` | Safe generated-evidence family recognition and bounded retention planning. |
| `scripts/secret-scan-core.mjs` | Small credential-shape scanner used by the local/CI secret gate. |
| `scripts/render-buckets.mjs` | Shared X rendering bucket classification used by coverage, replay rendering, and tests. |
| `scripts/screenshot-probe.mjs` | Screenshot inspection helper used by local/Original evidence collectors and tests. |
| `scripts/display-original-evidence-chrome-capture.mjs` | Chrome-runtime helper for capturing Original X evidence from the user's already-authenticated Chrome session; it is intentionally not an npm command because normal Node commands do not own that browser session. |

The old commands `display:audit`, `display:audit:auth`, `display:audit:login`, and `legacy:display-audit` were removed from the command set. X/Google blocks dedicated automated audit profiles in this environment, and the supported evidence path is `x-display:collect-original-renderings` with the user's already-authenticated normal Chrome session.

## Removed Command Aliases

The command-name migration is now strict: old aliases are intentionally not available. If a historical note mentions one of these commands, use the clear current name instead.

| Old command | Preferred command |
| --- | --- |
| `npm test` | `npm run test:unit` |
| `npm run dev` | `npm run server:start` |
| `npm run stop` | `npm run server:stop` |
| `npm run doctor` | `npm run env:check` |
| `npm run verify:refactor` | `npm run refactor:check-baseline` |
| `npm run smoke` | `npm run test:smoke-api` |
| `npm run browser:smoke` | `npm run test:smoke-ui` |
| `npm run render:coverage` | `npm run x-display:check-sample-types` |
| `npm run display:inventory` | `npm run x-display:collect-local-renderings` |
| `npm run display:original-cache` | `npm run x-display:collect-original-renderings` |
| `npm run display:oracle` | `npm run x-display:compare-rendering-facts` |
| `npm run x-display:check-rendering-facts` | `npm run x-display:compare-rendering-facts` |
| `npm run display:rule-ledger` | `npm run x-display:validate-diff-rules` |
| `npm run display:visual-review` | `npm run x-display:build-screenshot-review` |
| `npm run display:regression` | `npm run x-display:test-replay-rendering` |
| `npm run fresh:audit` | `npm run x-display:test-fresh-pulse-rendering` |
| `npm run legacy:display-audit` | Use the reusable `x-display:*` evidence flow; there is no one-command replacement. |
