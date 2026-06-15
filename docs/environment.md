# Environment

## Current Baseline

This project now expects a real Homebrew Node.js toolchain:

```bash
/opt/homebrew/bin/node
/opt/homebrew/bin/npm
/opt/homebrew/bin/npx
```

GitHub CLI is also installed for repository operations:

```bash
/opt/homebrew/bin/gh
```

The Codex app also exposes an internal Node binary, but that binary did not include `npm` or `npx`. That was enough for zero-dependency code, but it would block future framework work, dependency installation, and browser testing. Homebrew Node was installed to make the environment explicit and maintainable.

## Standard Commands

```bash
npm run doctor
npm run dev
npm run smoke
npm run browser:smoke
npm test
npm run stop
```

`npm run dev` writes `.data/server.pid`. `npm run stop` uses that pid file to stop the server cleanly.

## Issues Already Encountered

### Missing npm/npx

Symptom:

```txt
npm: command not found
```

Cause: `node` was coming from `Codex.app`, not Homebrew.

Fix: install Homebrew Node.

```bash
/opt/homebrew/bin/brew install node
```

### Local Port Binding Requires Approval In Codex Sandbox

Symptom:

```txt
listen EPERM: operation not permitted 127.0.0.1:3000
```

Cause: Codex sandbox may require approval for local server binding. The project itself binds to `127.0.0.1`, which is the desired local-only behavior.

Fix: approve the dev server command in Codex, or run it directly in a normal local shell.

### Local curl May Require Approval In Codex Sandbox

Symptom:

```txt
curl http://127.0.0.1:3000/api/health
```

returns connection failure from the sandbox even while the app is running.

Cause: sandbox network boundaries. Use `npm run smoke` or approve the local HTTP check in Codex.

### Playwright Browser Binary Missing

Symptom:

```txt
Executable doesn't exist at .../ms-playwright/...
```

Cause: Playwright package was available from a bundled runtime, but browser binaries were not installed.

Fix:

```bash
npm install --save-dev playwright
npx playwright install chromium
```

This has been done for the current environment. `npm run browser:smoke` now verifies the page with Playwright Chromium and writes a screenshot to `.data/ui-smoke.png`.

### GitHub CLI Missing Or Logged Out

Symptom:

```txt
gh: command not found
```

or:

```txt
You are not logged into any GitHub hosts.
```

Purpose: `gh` lets agents and maintainers inspect GitHub state from the terminal: pull requests, issues, CI checks, repo metadata, releases, and authentication status.

Install:

```bash
/opt/homebrew/bin/brew install gh
```

Authenticate when GitHub actions are needed:

```bash
gh auth login
```

Current environment status: `gh` is installed and authenticated.

### System Chrome Headless May Be Unreliable From Sandbox

Symptom: launching `/Applications/Google Chrome.app/...` with Playwright headless may abort under automation.

Cause: local macOS/app sandbox interaction. Prefer project-managed Playwright browsers for automated UI tests. Use real Chrome only for manual visual checks.

### X/Google SSO May Reject Automated Audit Profiles

Symptom:

```txt
Couldn’t sign you in
This browser or app may not be secure.
We’ve temporarily limited your login. Please try again later.
```

Cause: Google SSO can block Playwright-controlled browser profiles even when the browser binary is system Chrome. X can also temporarily limit repeated login attempts from an automated browser profile.

Fix: do not try to bypass these protections or repeatedly retry login. In the current environment, `npm run display:audit:login` is treated as unavailable and fails fast by design. Keep local replay and regression checks as the automated baseline; use already-authenticated Chrome only for manual read-only Original inspection, not as the automated screenshot source of truth.

## Future Environment Risks

### X API Credentials

Real timeline mode will need:

```txt
X_CLIENT_ID
X_REDIRECT_URI
TIMELINE_SOURCE=x
X_TIMELINE_PAGE_SIZE=100
X_TIMELINE_TARGET_POSTS=100
X_TIMELINE_MAX_PAGES=3
```

Manual token configuration is still supported through `X_USER_ID` and `X_USER_ACCESS_TOKEN`, but the preferred local path is OAuth 2.0 PKCE. See `docs/integrations/x-oauth.md`.

Online Pulse keeps local X state under `.data/`:

- `.data/timeline-cursor.json` prefers newer X pages with `since_id`.
- `.data/seen-posts.json` prevents previously selected Online posts from appearing again.
- `.data/x-snapshots.json` stores recent raw X page responses for UI fidelity debugging.

### OpenAI Credentials

OpenAI-powered refresh needs:

```txt
OPENAI_API_KEY
OPENAI_MODEL=gpt-5
SELECTED_POST_COUNT=7
```

Without this, live X refresh fails visibly. Replay uses saved X-derived runs/traces rather than local AI fallbacks. The intended product behavior is GPT scoring and selected-post translation with `gpt-5` during refresh.

OpenAI operation outputs are cached in `.data/openai-cache.json` by operation, requested model, prompt version, and source-content fingerprint. This cache avoids repeated scoring/translation for the same content while still allowing engagement metrics and ranking rules to be recalculated each run.

External URL preview metadata for final selected posts is cached separately in `.data/link-preview-cache.json` by normalized target URL. It is reader evidence for X-like cards, not an OpenAI output, and it does not participate in scoring or translation cache keys.

Scoring and translation share `OPENAI_MODEL` by default. To lower OpenAI cost, use a cheaper shared model:

```txt
OPENAI_MODEL=gpt-5-nano
```

Scoring and translation are still separate AI operations in the architecture and usage records. Advanced operation-specific overrides remain available through `OPENAI_SCORING_MODEL` and `OPENAI_TRANSLATION_MODEL`, but the reader UI treats the shared model name as the primary environment signal.

### Dependency Growth

The app currently has no runtime dependencies. When adding dependencies:

- Keep domain modules framework-independent.
- Prefer adding dev dependencies only when they improve testing or tooling.
- Update this document and `docs/architecture.md`.
- Run `npm run doctor`, `npm test`, `npm run smoke`, and `npm run browser:smoke`.
