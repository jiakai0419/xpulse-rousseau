# Current Project Audit — Codex Reviewer

- Date: 2026-07-12
- Reviewer: Codex primary audit
- Scope: product behavior, backend/domain logic, frontend state and accessibility, persistence, security, operations, tests, and repository safeguards
- Change policy: review only; no product code was changed as part of this audit
- Handoff purpose: independent reviewer input for a later fixer, to be compared and deduplicated against the other review file before implementation

## Executive Summary

The main application path runs and the existing regression suite is healthy, but the audit confirmed seven high-priority issues plus several operational and testing gaps. The first fixes should address link-preview SSRF, local secret permissions, nested quote scoring, partial Online commits, environment isolation, failed-job recovery, and unsafe server shutdown.

## High-Priority Findings

### 1. Link preview enrichment permits SSRF through redirects

File: `src/services/linkPreview/enrich.ts`, especially the initial host check around lines 78-94 and redirect handling around lines 258-305.

The first URL is checked for obvious local/private hosts, but redirect targets are not checked again. After a redirect, the code only stops for X-owned domains. Private IPv6 addresses, DNS resolution to private addresses, DNS rebinding, and hostname variants also remain insufficiently covered.

Impact:

- An attacker-controlled link in a selected post can make the local server issue GET requests to localhost or private-network services.
- HTML title or Open Graph metadata from the internal response can be copied into the preview cache, saved run, and Reader UI.

Reproduction completed during this audit: a public-looking URL redirected to `http://127.0.0.1:3000/private`; the code made the second request and stored the internal page title as preview metadata.

### 2. Local secrets and private timeline data have overly broad filesystem permissions

Files: `src/services/x/tokenStore.ts`, `src/services/storage/fileRunRepository.ts`, and `src/services/x/rawSnapshotStore.ts`.

The repositories call `writeFile` without setting restrictive modes, and `.data` is created without a private directory mode. The current machine was observed with:

- `.data`: `0755`
- `.env`: `0644`
- `.data/x-oauth.json`: `0644`
- `.data/runs.json`: `0644`
- `.data/x-snapshots.json`: `0644`

The user home and repository are traversable by the local `staff` group. As a result, another local account in that group can potentially read the OpenAI key, X access/refresh tokens, Following timeline data, raw X responses, and model outputs.

Recommended direction: make sensitive directories `0700`, sensitive files `0600`, repair existing permissions, and have `env:check` warn or fail on unsafe modes.

### 3. Scoring drops quoted-post context inside retweets

File: `src/services/scoring/openAIScoring.ts`, especially the prompt mapping around lines 72-105.

The scorer correctly selects the retweeted source as the reader-facing post, but referenced-post inclusion is still decided from the outer timeline wrapper. When a retweet source is itself a quote tweet, the outer `retweeted` condition clears `referencedPostType` and omits the nested quoted post from the OpenAI prompt.

Impact:

- Short source text such as “Exactly this” can be scored without the quoted content that gives it meaning.
- The ranking and Chinese explanation can disagree with what the Reader visibly presents.
- X lookup enrichment may fetch the nested quote successfully, only for the scoring prompt to discard it.

Real saved data contains 105 such trace inputs and 18 selected posts, so this is not merely a synthetic edge case.

### 4. Online run commit is not transactional

Files: `src/services/pipeline/commitRefreshRun.ts` and `src/server/refreshJobs.ts`.

The commit sequence is:

1. Save the completed run.
2. Update the Seen Ledger.
3. Update the Timeline Cursor.

If step 2 or 3 fails, the job is marked failed even though part of the state is already committed.

Failure modes:

- Seen write fails: the run is already latest/replayable, the cursor is stale, and a retry can show the same posts again.
- Cursor write fails: the run is saved and posts are marked seen, but the UI reports failure; a retry may exclude posts the user never saw as a successful result.

This conflicts with the stated rule that only a successful Online selected set should mutate Seen/Cursor state. Current tests only cover failure of the first `save` step, not failure of the later state mutations.

### 5. Empty environment variables are repopulated from the real `.env`

Files: `src/server/env.ts`, `scripts/smoke.mjs`, and `scripts/browser-smoke.mjs`.

`loadDotEnv` checks `if (!process.env[key])`. An explicitly supplied empty string is therefore treated as absent and replaced with the value from `.env`.

Reproduction completed during this audit:

```text
OPENAI_API_KEY='' before loadDotEnv -> configured after loadDotEnv
```

Both smoke scripts try to disable OpenAI by passing `OPENAI_API_KEY: ""`, but the server process still receives the real local key. The current replay path avoids provider calls for another reason, yet the intended credential isolation is not real and could permit accidental provider usage after a test regression.

The doctor uses different merge semantics, so it can report the key as missing while the server silently restores it.

### 6. Page refresh can hide failed jobs or let an old run overwrite a newly recovered result

File: `public/app.js`, especially job recovery around lines 500-534 and initialization around lines 609-613.

The recovery code handles `running` and `completed` jobs but ignores `failed`. A failed stored job has its ID cleared, and the latest-job fallback also ignores failed jobs. The previous successful run can remain visible without any failure message.

Initialization also starts `loadLatest()` and `loadRecoverablePulseJob()` concurrently. Both can call `renderRun()` without request-generation or run-identity protection. A request that read the old latest run before the job committed can return later and permanently overwrite the newly recovered result.

Impact:

- Provider or pipeline failure is not always visible.
- The user can mistake an old result for the result of the current Pulse.
- Progress can temporarily disappear while a job is still running.

### 7. `server:stop` can terminate an unrelated Node process

Files: `scripts/stop-server.mjs`, `scripts/dev-server.mjs`, and `scripts/doctor.mjs`.

When the PID file is absent, the stop script treats the only Node listener on the configured port as the project server. When a PID file exists, it only checks whether the PID is alive; it does not verify the command, working directory, listening port, or project health response before sending `SIGTERM`.

After waiting about two seconds, it deletes the PID file and prints `Stopped` even if the process remains alive. The start script similarly treats any live PID in the stale file as proof that this project is running.

The current `.data/server.pid` pointed to a dead PID 841 during the audit, confirming that stale PID state exists in normal use.

## Additional Confirmed Findings

### 8. Product-state JSON files are overwritten non-atomically

File: `src/services/storage/fileRunRepository.ts`; the same pattern appears in the other file repositories.

Each save directly rewrites the destination file. There is no same-directory temporary file, atomic rename, fsync, recovery journal, or validated backup. A process crash, forced termination, or disk-full event can leave partial JSON that every later read rejects.

The current `runs.json` is about 14.6 MB and is fully rewritten for every save, making this a material durability risk rather than a tiny-file theoretical concern.

### 9. Link Preview cache has a deterministic lost-update race

Files: `src/services/linkPreview/enrich.ts` and `src/services/linkPreview/cache.ts`.

Two nested `Promise.all` paths can call `cache.set` concurrently. Every `set` independently reads the whole cache, modifies its own copy, and rewrites the whole file without locking or serialization.

Reproduction completed during this audit: 20 concurrent writes to the real file cache left only one record. The current run can still carry its in-memory preview, but future runs refetch the link and the cache contract is defeated; overlapping writes can also corrupt JSON.

### 10. X authentication state can disagree with the source actually used

Files: `src/server/index.ts`, `src/services/pipeline/runRefresh.ts`, and `public/reader/sourceStatus.js`.

Two problems are present:

- With only `X_USER_ID` and `X_USER_ACCESS_TOKEN`, the server returns `configured:false`, `manualCredentials:true`, and `xReady:true`, but the UI handles `!configured` first. It displays “X not configured” and defaults to Offline.
- If manual credentials and OAuth credentials both exist, the Reader displays the OAuth user while live fetching unconditionally prefers the manual user ID/token. The sidebar can therefore name account B while Pulse reads account A’s Following timeline.

### 11. Quote-link classification can hide unrelated X status links

File: `public/reader/linkRules.js`, especially `isReferencedStatusLink` around lines 115-129.

For a quote tweet, the function first tries to match the actual referenced-post URL. If that does not match, it classifies any X status URL as the quote link. A quote tweet whose body also links to another X post can therefore have both links classified as the same quote object; the unrelated link is removed from visible text and the fallback link area.

### 12. Refresh jobs retain unbounded memory

File: `src/server/refreshJobs.ts`.

Every completed or failed job stays permanently in an in-memory `Map`. Completed jobs retain the full `RefreshRun`, including trace data; trace removal only happens while shaping an HTTP response. The disk repository caps history at 20 runs, but the job store has no count, age, or size retention policy, and `latest()` repeatedly sorts the full history.

### 13. Local generated evidence has grown without an enforced retention policy

The inventory produced during this audit reported:

- Total `.data` size: 2.45 GB
- Files: 6,021
- Generated evidence reports: 2.36 GB across 5,282 files
- Product state: about 32.7 MB

The largest generated areas were `display-visual-review`, `render-regression`, `display-gap-inventory`, and `render-audit`. Documentation describes manual retention categories, but no safe owner-facing pruning workflow prevents indefinite growth.

### 14. Replay UI and replay rendering tests are not network-independent

Files: `public/reader/mediaRules.js`, `src/server/index.ts`, and `scripts/browser-smoke.mjs`.

Replay does not call the X API or OpenAI, but rendered photos use saved `pbs.twimg.com` URLs and videos use the local proxy, which fetches `video.twimg.com`. UI smoke explicitly requires playable remote video.

Impact:

- “Offline” is a local data source mode, not fully offline reading.
- Replay rendering tests can fail because of X CDN latency or reachability.
- The README/testing wording “without calling X” is too broad; it should distinguish X API usage from X CDN media retrieval.

### 15. Accessibility semantics are noisy or incomplete

Files: `public/index.html`, `public/app.js`, and `public/reader/postQuote.js`.

Confirmed examples:

- The entire timeline section is an `aria-live` region while it contains a nested `role="status"`; per-second progress changes and full result replacement can cause repeated or extremely long announcements.
- The media viewer declares `aria-modal="true"` but does not make the background inert or trap Tab focus.
- Quote cards act as a focusable `role="link"` while containing nested media buttons and real links, producing ambiguous keyboard and screen-reader interaction.

### 16. Inline video behavior can waste bandwidth and lacks direct pause controls

Files: `public/reader/postMedia.js` and `public/app.js`.

Normal videos are emitted with `autoplay`, `loop`, and `preload="auto"` but without inline controls. Browser initialization calls `load()` for every rendered video before intersection observation decides which one should play. Saved data includes long videos, so this can preload offscreen media and loop long motion content without a direct inline pause mechanism.

### 17. Signal total scale is ambiguous for low current-format scores

File: `public/reader/actions.js`.

Current scoring stores totals on a 0-100 scale, while older fixtures and replay data sometimes use 0-10. `formatSignalScore` guesses the scale with `numeric > 10 ? numeric / 10 : numeric`. A current-format total of 10 should display as 1.0 but displays as 10.0; totals below 10 are similarly inflated by 10x.

No existing selected post in the current saved run pool had a total at or below 10, but the code path remains valid when a very low-signal candidate is selected.

## Repository and Shared-CI Safeguard Gaps

### 18. Shared CI does not type-check or execute the HTTP entry point

Files: `.github/workflows/ci.yml`, `package.json`, and `tsconfig.json`.

The repository declares strict TypeScript options but does not depend on TypeScript and has no `typecheck` script. CI runs the environment doctor, unit tests, and the same unit tests under coverage; it does not run API/UI smoke.

Coverage was 79.21% overall, but `src/server/index.ts` and `src/server/env.ts` were not loaded at all. HTTP routes, dotenv behavior, startup/shutdown scripts, and browser orchestration can therefore regress while shared CI remains green.

### 19. GitHub protections are not an effective merge or secret gate

Read-only GitHub API verification on 2026-07-12 found:

- The repository is public.
- `main` has no active branch protection.
- The only ruleset is disabled and does not require PRs or status checks.
- Secret scanning, push protection, and Dependabot security updates are disabled.

No tracked real secret was found during the audit, and recent CI was green, but a bad commit or accidental secret can currently be pushed directly to public `main` without a preventive gate.

### 20. Smoke infrastructure lacks strong instance and concurrency isolation

Files: `scripts/smoke.mjs`, `scripts/browser-smoke.mjs`, and `scripts/env-utils.mjs`.

API smoke uses a fixed port and fixed `.data/smoke-runs.json`, overwrites that file, and deletes it unconditionally. Parallel smoke runs can collide. Health checking accepts any successful HTTP response without verifying the expected instance or run store, and API job polling has no overall timeout.

## Verification Performed

- `npm run env:check`: passed under the normal configuration; port probing produced the expected sandbox warning.
- `npm run test:unit`: 235/235 passed.
- `npm run test:coverage`: 235/235 passed; overall line coverage 79.21%.
- `npm run test:smoke-api`: passed using saved X-derived replay data.
- `npm run test:smoke-ui`: passed with seven Reader cards.
- `npm run x-display:test-replay-rendering`: passed across five selected real X-derived runs.
- `npm run x-display:validate-diff-rules`: passed with six rules.
- `npm run x-display:check-sample-types`: scanned 18 live runs, 558 trace inputs, and 112 selected samples; all required render buckets had coverage.
- `npm audit`: zero known vulnerabilities.
- Git working tree remained clean during the review.

## Validation Boundary

No paid Fresh Online Pulse was run during this audit because it would call X and OpenAI. The newest saved Online run was dated 2026-06-14, so the live provider path and current external behavior have not been distribution-outside validated for roughly four weeks.

## Suggested Fix Order

1. Close SSRF and local credential-permission exposure.
2. Correct nested quote scoring and add a real-data-backed regression test/eval.
3. Make Online state commit recoverable and make failed-job recovery explicit in the UI.
4. Fix dotenv presence semantics and harden server PID identity checks.
5. Introduce one shared atomic/private JSON storage primitive, then serialize cache updates.
6. Resolve auth/source identity mismatches and quote-link content loss.
7. Add bounded job/evidence retention and clarify Offline/CDN behavior.
8. Add type-check/server-entry CI, then enable GitHub branch and secret protections.
9. Address accessibility and media loading controls.
