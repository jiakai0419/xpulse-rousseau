# 0002 Live And Replay, No Silent Fallback

## Status

Accepted.

## Context

The product is meant to help the user read filtered X Following content. Earlier V1 code kept local mock/sample data and local AI fallbacks before credentials were ready. That made the system harder to reason about: a refresh could look successful while mixing real provider output with locally generated substitutes.

The user also wants replay to work without writing code. Saved run traces already preserve enough evidence to reproduce a previous X-derived run.

## Decision

The app has two data paths:

- `x`: live authenticated X timeline plus OpenAI scoring and translation.
- `replay`: local replay from saved X-derived runs/traces under `.data/`.

There is no silent fallback in the live path. If X or OpenAI fails, the action fails visibly. Scoring and translation require complete structured responses for every input id.

Replay does not call X or OpenAI. It reuses recorded posts, scores, translations, and trace evidence from a saved live X run. Its per-action usage is empty because no provider request happened during replay.

The project should not introduce a separate mock/sample/test-fixture source. Automated smoke checks use replay from saved live X runs. Unit tests may stub provider responses, but they should not add another product source mode.

## Consequences

- Replay requires at least one saved live X run before replay can work.
- `.data/` remains private local state and is ignored by git.
- Replaying a run can be changed by editing saved local run/trace data.
- Tests and smoke checks are more honest about product behavior, but a fresh machine may need one live X refresh before replay smoke can run.
