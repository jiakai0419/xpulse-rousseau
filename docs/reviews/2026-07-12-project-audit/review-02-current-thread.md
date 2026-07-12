# Current Project Audit — Current Thread Reviewer

- Date: 2026-07-12
- Reviewer: Codex current thread
- Scope: security, persistence, Pulse recovery, X/OpenAI usage, frontend state, operations, tests, and local evidence
- Change policy: review only; no product code was changed
- Handoff purpose: independent input for a fixer to compare and deduplicate with the other reviewer report

## Executive Summary

The replay path is healthy, but the project has confirmed security, persistence, recovery, and operational defects that are not covered by the green test suite. The first fixes should address link-preview SSRF, private-file permissions, concurrent cache writes, failed Pulse recovery, test credential isolation, and server process identity.

## Priority 1 Findings

### 1. Link-preview redirects permit SSRF

Files: `src/services/linkPreview/enrich.ts`, especially the initial URL check around lines 78-94 and redirect handling around lines 258-305.

Only the initial target is checked for obvious private hosts. Redirect targets are followed without repeating that validation, and resolved IP addresses are not checked.

Confirmed reproduction: a public-looking URL returned a redirect to `http://127.0.0.1:4321/private`; the implementation issued the second request and saved the internal page title as preview metadata.

Impact: an attacker-controlled link in a selected X post can cause the local server to access localhost or private-network HTTP services.

### 2. Sensitive local files have overly broad permissions

Files: `src/services/x/tokenStore.ts`, `src/services/storage/fileRunRepository.ts`, and `src/services/x/rawSnapshotStore.ts`.

Observed permissions:

- `.data`: `0755`
- `.env`: `0644`
- `.data/x-oauth.json`: `0644`
- `.data/runs.json`: `0644`
- `.data/x-snapshots.json`: `0644`

These files can contain OpenAI credentials, X access and refresh tokens, private Following timeline data, raw X responses, and model outputs. On a multi-user machine, another local account in the same group may be able to read them.

Recommended direction: create sensitive directories as `0700`, write sensitive files as `0600`, repair existing modes, and add an environment warning for unsafe permissions.

### 3. Link-preview cache loses concurrent writes

Files: `src/services/linkPreview/enrich.ts` around lines 358-393 and `src/services/linkPreview/cache.ts` around lines 65-76.

Preview enrichment uses nested `Promise.all`, while every cache write independently reads, modifies, and rewrites the whole JSON file without serialization.

Confirmed reproduction: 40 concurrent preview writes left only one cache record.

Impact: repeated network fetches, slower Pulse runs, defeated cache behavior, and possible JSON corruption during overlapping writes.

### 4. Failed Pulse jobs disappear after page reload

File: `public/app.js`, especially job recovery around lines 500-534.

The browser restores `running` and `completed` jobs but ignores `failed` jobs. The stored job id is cleared, and the latest-job fallback also ignores failure.

Confirmed reproduction: a replay job failed and the API retained its error; after reload the page showed no cards, no visible progress, and no error message.

This violates the product requirement that Pulse failures remain visible and recoverable.

### 5. Smoke tests do not truly disable the real OpenAI key

Files: `src/server/env.ts`, `scripts/smoke.mjs`, and `scripts/browser-smoke.mjs`.

The smoke scripts pass `OPENAI_API_KEY: ""`, but `loadDotEnv` treats an empty environment value as absent and reloads the real value from `.env`.

Confirmed reproduction: setting the key to an empty string before `loadDotEnv()` resulted in a configured non-empty key afterward.

The current replay flow avoids OpenAI calls for another reason, but a routing regression could let a supposedly provider-free smoke test use real credentials and incur cost.

### 6. `server:stop` can terminate an unrelated Node process

Files: `scripts/stop-server.mjs`, `scripts/dev-server.mjs`, and `scripts/doctor.mjs`.

When no PID file exists, the stop script kills the only Node listener on the configured port without verifying its command, working directory, or project health endpoint. A stale PID file is also trusted based only on whether that PID is alive.

After its short wait, the script deletes the PID file and reports success even if the process remains alive.

## Priority 2 Findings

### 7. Manual X credentials are mapped to the wrong UI state

Files: `src/server/index.ts` around lines 315-330 and `public/reader/sourceStatus.js` around lines 55-83.

With `X_USER_ID` and `X_USER_ACCESS_TOKEN` but no OAuth client id, the server returns `configured:false`, `manualCredentials:true`, and `xReady:true`. The UI handles `!configured` first, displays `X not configured`, and defaults to Offline before it can reach the manual-credential branch.

The user can switch Online manually, but the status and default source are misleading and contradict the documented behavior.

### 8. X usage receipts under-report failed and fallback requests

Files: `src/services/x/client.ts` and `src/services/x/enrichment.ts`.

Usage is emitted only after a full sequence succeeds. Earlier successful requests disappear from the receipt if a later page fails, and a failed `since_id` request is not counted before baseline fallback.

Confirmed reproductions:

- Two actual timeline requests followed by a failure produced zero usage lines.
- A failed cursor request plus a successful baseline request produced `requestCount: 1` for two actual requests.

This weakens the product promise that each provider call is observable per action.

### 9. Online run commit is not transactional

File: `src/services/pipeline/commitRefreshRun.ts`.

The commit order is: save run, update Seen Ledger, update Timeline Cursor. If a later step fails, the job is reported as failed even though part of the state has already changed.

Possible results include a saved replay source with stale Seen/Cursor state, or posts marked seen even though the UI reported that the Pulse failed.

Current tests cover failure of the first save only, not failure of the later mutations.

### 10. Progress and authentication errors are misleading or invisible

Files: `public/reader/status.js`, `public/app.js`, and `public/styles.css`.

- Progress calculation resets within each pipeline stage, producing sequences such as `100% -> 10% -> 100% -> 10%`.
- OAuth callback errors are written to a visually clipped status node and are later cleared when the latest run renders.
- Initial latest-run loading does not check `response.ok`; storage or server errors can leave an unexplained blank timeline.

### 11. Media viewer keyboard behavior does not match modal semantics

Files: `public/index.html` and `public/app.js`.

The viewer declares `aria-modal="true"`, but background controls remain focusable and Tab is not trapped. Global left/right handlers also intercept arrow keys while focus is on native video controls, preventing normal seeking or unexpectedly changing gallery items.

### 12. Shared CI does not type-check or load the main application entry points

Files: `package.json`, `tsconfig.json`, and `.github/workflows/ci.yml`.

TypeScript is not installed and there is no type-check command, despite strict compiler settings in `tsconfig.json`. CI runs unit tests and then repeats them under coverage, but does not execute API/UI smoke.

The reported 79.21% line coverage only includes files loaded by unit tests. Important files such as `src/server/index.ts`, `src/server/env.ts`, and `public/app.js` do not appear at all, so the percentage does not describe the whole application.

### 13. External requests and smoke polling lack complete timeout protection

X timeline, OAuth, and media proxy requests do not have explicit end-to-end timeouts. API smoke job polling and the composite refactor baseline also lack an overall deadline.

A stalled request can leave the only refresh job running indefinitely and prevent subsequent Pulse attempts until the server is restarted.

## Current Validation State

- `npm run env:check`: passed.
- `npm run test:unit`: 235/235 passed.
- `npm run test:coverage`: passed; line 79.21%, branch 76.43%, functions 83.99%.
- `npm run test:smoke-api`: passed using saved X-derived replay data.
- `npm run test:smoke-ui`: passed with seven Reader cards.
- `npm run x-display:test-replay-rendering`: passed across five saved live X-derived runs.
- `npm run x-display:check-sample-types`: all required rendering buckets had coverage.
- Historical strict 225-sample display baseline: passed.
- Current default display comparison: two samples blocked by missing or invalid local evidence.
- Git working tree was clean before this review report was added.

No Fresh Online Pulse was run because it would call X and OpenAI. The newest saved live run was dated 2026-06-14, so current provider behavior has not been freshly validated.

## Local Data State

The local inventory reported 2.46 GB under `.data`, including approximately 2.36 GB of generated display evidence. There is documentation for manual retention decisions but no bounded owner-facing cleanup workflow, so repeated regression and visual-review runs can continue growing disk usage.

## Suggested Fix Order

1. Close SSRF and restrict local credential/data permissions.
2. Serialize and atomically persist caches and product-state JSON.
3. Make Online commit and failed-job recovery consistent.
4. Correct dotenv precedence and server process identity checks.
5. Fix X authentication/source state and usage accounting.
6. Add type-check/server-entry CI and reliable timeouts.
7. Repair progress, OAuth error visibility, and media-viewer accessibility.
8. Add a bounded evidence-retention workflow.
