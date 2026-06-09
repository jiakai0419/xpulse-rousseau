# Run Trace Design

## Purpose

Run Trace is the evidence layer for the Reader. It records what happened during one refresh so future prompt and ranking work can read the run without asking the user to remember or manually review all 100 posts.

Run Trace does not ask for feedback, compare prompt variants, or add evaluation UI. It only preserves enough evidence for those tools to exist later.

## Principles

- Keep the main Reader UI clean. Trace data should not turn the reading surface into a labeling tool.
- Preserve inputs, decisions, and outputs. Do not save only the selected posts.
- Store trace data locally with the run under `.data/`; never commit it.
- Do not store secrets, OAuth tokens, OpenAI keys, or raw provider credentials.
- Keep the trace deterministic and structured enough for tests and future scripts.

## Shape

`RunTrace` is attached to each stored `RefreshRun` as `run.trace`.

Reader-facing run responses omit the full trace so the main UI does not download all fetched posts and decisions on every refresh. Trace data remains in the local run store and can be fetched explicitly from:

```txt
GET /api/runs/{runId}/trace
```

Core fields:

- `version`: currently `run-trace-v1`.
- `runId`, `createdAt`, `source`.
- `pipelineVersion`: currently `reader-refresh-v1`.
- `config`: selected count, scoring weights, configured models, batch sizes, and prompt versions.
- `inputPosts`: fetched posts in fetch order.
- `decisions`: one decision trace per fetched post.

Each decision records:

- `state`: `selected`, `scored_not_selected`, `ad_excluded`, `duplicate_excluded`, or `seen_excluded`.
- `adFilter`: whether ad filtering excluded it, plus signals when available.
- `duplicate`: whether dedupe removed it, the kept post id, and dedupe reason.
- `seen`: represented by `state: "seen_excluded"` when Online Pulse filtered a post because it was already shown in an earlier successful Online selected set.
- `score`: rank and weighted score when scored.
- `selected`: whether it entered the selected set and its selected rank.
- `translation`: whether translation was generated and by which model.

## Relationship To Usage

Usage receipts answer "what did this action cost or consume?"

Run Trace answers "why did this refresh produce this result?"

They are related but separate. A refresh trace can point to the selected posts and decisions, while the refresh usage receipt summarizes X/OpenAI calls for that same action.

## Relationship To Online State

Run Trace records what happened during one run. It is not the state authority for future runs.

- Seen Ledger controls whether a post is skipped before OpenAI on future Online runs.
- Timeline Cursor controls whether Online asks X for newer pages first.
- OpenAI Cache controls whether scoring or translation can reuse an earlier OpenAI operation output.
- Raw X Snapshots preserve provider evidence outside the normalized run trace.

## Relationship To Future Tools

Feedback, pairwise comparisons, and prompt experiments are intentionally deferred. Future tools should read `RunTrace` records instead of mixing those workflows into the Reader pipeline.
