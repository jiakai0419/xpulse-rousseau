# Usage Design

## Purpose

Usage records make external calls observable without turning cost and quota data into the main reading experience. The primary product surface remains the selected posts. Usage is secondary control information for cost awareness and future optimization.

## Core Abstraction

Usage has three layers:

- Receipt: one user action. Example: one `Pulse` click.
- Line: one internal external-call step inside that action. Examples: X timeline fetch, AI scoring, AI translation.
- Metric: provider-specific numbers on each line. Examples: OpenAI input/output/total tokens, X request count, X rate-limit state.

The user should mostly see receipts. Lines are visible only when expanding a receipt. Metrics are details inside each line.

## Line Shape

All external calls should produce `UsageRecord` objects when usage data is available. In the receipt model, a `UsageRecord` is a receipt line.

Required fields:

- `provider`: external provider, currently `openai` or `x`.
- `operation`: product operation, such as `scoring`, `translation`, or `x.timeline`.
- `label`: user-facing short label.
- `itemCount` and `itemIds`: which posts/items this call processed or returned.
- `createdAt`: when the usage was recorded.

Provider-specific fields:

- OpenAI: `model`, `inputTokens`, `outputTokens`, `totalTokens`, `cachedInputTokens`, `reasoningTokens`.
- X timeline/lookup: `method`, `endpoint`, `requestCount`, optional `failedRequestCount`, `rateLimit.limit`, `rateLimit.remaining`, `rateLimit.resetAt`. These request counts cover every attempted timeline/lookup request, including a failed `since_id` attempt before baseline fallback and requests made before a later page fails. On a failed Pulse, these lines remain attached to the failed refresh job alongside its visible error. OAuth maintenance and low-level OpenAI transport retries are not separate receipt lines today.

## Receipt Semantics

Usage is shown per user action, not as an ever-growing global total.

- Refresh receipt: one click on `Pulse` produces one receipt. The receipt aggregates the X timeline request, all scoring batches, and all translation batches used to process that refresh. If the refresh handled 100 posts, the usage for those internal calls is cumulative inside that one receipt.
- Separate actions remain separate. Two refreshes do not merge usage.

## Receipt Shape

`UsageReceipt` is the presentation-level object built from usage lines.

Required fields:

- `scope`: currently `refresh`.
- `title`: short user-facing label, such as `Usage`.
- `createdAt`: when the user action happened.
- `target`: optional run/post target, such as `runId` and `postId`.
- `totals`: summed metrics across the receipt lines.
- `lines`: the underlying `UsageRecord[]` lines.

Receipts are computed from stored lines. The stored source of truth remains provider-level usage lines so future code can rebuild receipts differently without data migration.

## UI Principles

- Usage is secondary. Show a compact collapsed summary by default.
- Progress may surface the active operation, model, item count, and the current receipt's accumulated token total while work is running.
- Detailed usage should be available on demand, grouped by provider, operation, and model or endpoint.
- Refresh usage belongs near the run-level status.
- Never let usage tables displace the selected posts as the main reading surface.
- Pipeline counts are diagnostic, not primary reading content. Do not show fetched/ad/duplicate/scored/selected counts as a persistent strip in the Reader.

## Configured Models

Model choice is explicit per AI operation. The app does not have a global mode that rewrites models behind the user's back. Usage records store the actual response model returned by the provider.
