# Agent Rules

This is a long-running product project. The user will not write code, so every meaningful change must keep the project understandable to a non-coding owner.

## Working Principles

- Read `README.md`, `docs/product.md`, and `docs/architecture.md` before changing product behavior.
- Run `npm run env:check` before changing dependencies, browser tooling, API integration, or server startup behavior.
- Keep changes scoped. Do not perform broad rewrites unless the user asked for that specific work.
- Preserve the user-facing product idea: an X-like reader that filters the user's Following timeline and makes selected posts easier to read with Chinese translation.
- Do not hide product logic inside a single large prompt. Scoring dimensions, weights, and filtering rules should remain documented and testable.
- When changing scoring, filtering, X API behavior, OpenAI behavior, or UI structure, update the relevant docs in the same change.
- When changing prompts, update `docs/prompts/` and add or adjust tests/evals where possible.
- Add tests for new domain logic. For UI-only changes, run `npm run test:smoke-ui` when browser tooling is available.
- Prefer `npm run server:start`, `npm run server:stop`, and `npm run test:smoke-api` over ad hoc server commands.
- When GitHub context is needed, prefer `gh` over browser/manual guessing. Check `gh auth status` before assuming GitHub API access.
- Do not introduce mock/sample/test-fixture source modes. Replay and smoke verification should use saved X-derived runs/traces.

## Boundaries

- Avoid destructive Git commands.
- Do not commit secrets or real API tokens.
- Do not replace the project architecture without adding an architecture decision record under `docs/decisions/`.
- Do not remove explanatory docs just because the code seems self-evident. The docs are part of how the user controls the project.

## Current Technical Shape

- Runtime: Node.js with native TypeScript stripping.
- Web server: built-in `node:http`.
- UI: static HTML/CSS/JS in `public/`.
- Domain modules: TypeScript under `src/`.
- Tests: built-in `node:test`.
- Environment checks and server management live under `scripts/`.

This dependency-light shape is deliberate for the first milestone. A framework migration is allowed later, but the domain modules should remain framework-independent.
