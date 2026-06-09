# Decision 0001: Start With Zero-Dependency TypeScript V1

## Status

Accepted.

## Context

The project is new and the local shell currently has Node.js but no package manager. The product also needs to remain understandable and controllable by a user who will not write code.

## Decision

Start with a dependency-free TypeScript project using Node's native TypeScript stripping and built-in HTTP server. Keep all domain logic framework-independent so the UI can later migrate to Next.js or React without rewriting scoring, filtering, X integration, or AI modules.

## Consequences

- The app can run immediately without installing dependencies.
- Tests can use built-in `node:test`.
- UI code is plain HTML/CSS/JS for now.
- Later framework migration should preserve the `src/domain` and `src/services` modules.
