# V1 Accepted Behavior

This document freezes the V1 behavior that refactors should preserve unless the user explicitly approves a product change.

## Reader Flow

- The primary action is `Pulse`.
- The default source after page load is Online when X is connected.
- Online Pulse calls X and OpenAI. If either provider fails, the action fails visibly.
- Offline Pulse replays the latest saved live X-derived run. It does not call the X API or OpenAI and does not mutate Seen Ledger, Timeline Cursor, Raw X Snapshots, or OpenAI Cache. Saved media can still load from X CDNs.
- Pulse jobs are recoverable while the server process is alive. A repeated Pulse click during a running job reattaches to that job instead of starting another costly run.

## Selection

- Online Pulse prefers newer X timeline pages with `since_id`, then falls back to recent paginated pages when needed.
- Ads, exact duplicates, retweet duplicates, and previously displayed selected identities are filtered before OpenAI scoring.
- OpenAI scores `立即值得看` and `信息密度`; local code scores `互动信号` from the latest X metrics.
- OpenAI operation outputs are cached by operation, model, prompt version, and source-content fingerprint.
- Engagement metrics, ranking weights, Top count, author diversity, and Seen policy are not part of the OpenAI cache key.
- Final selection returns up to 7 posts.
- Final selection keeps at most one reader-facing post per author after scoring, preserving that author's highest-ranked post.

## X-Like Rendering

- Retweets render the reposted source post as the main content; the reposting account is quiet context.
- Quoted posts render as X-like quote cards when quoted-post data exists.
- Attached X media is the primary rich object. Extra external URLs stay inline when attached media exists.
- External preview cards render only for ordinary external links with preview evidence and no attached media.
- Raw `t.co` text should not leak into the reader when X-derived display URLs or structured cards are available.
- Videos autoplay muted inline from saved X media variants through the local media proxy.
- Clicking media opens the local media viewer with fit-to-screen image/video display.
- The post action row contains replies, reposts, likes, views, and Signal.
- Signal uses a 0-10 total score and 0-10 sub-scores. Expanded score reasons are Chinese.
- Chinese translation is visible by default in a neutral translation band.

## Usage And Observability

- Usage is per action, not global accumulation.
- Refresh usage aggregates X timeline/lookup, OpenAI scoring, and OpenAI translation lines for that action.
- Usage remains secondary in the UI.
- Run traces preserve filtering, dedupe, seen, scoring, selection, translation, model, prompt, and usage evidence for later debugging.

## Test Baseline

Before refactoring UI or product flow, run:

```bash
npm run env:check
npm run test:unit
npm run test:smoke-api
npm run test:smoke-ui
npm run x-display:test-replay-rendering
```

For rendering-sensitive refactors, also run:

```bash
npm run x-display:collect-local-renderings
npm run x-display:collect-original-renderings
npm run x-display:validate-diff-rules
DISPLAY_ORACLE_REQUIRE_ALL=1 npm run x-display:compare-rendering-facts
npm run x-display:build-screenshot-review
```

Before declaring display fidelity stable after a larger refactor, run a deliberate fresh-data validation:

```bash
FRESH_PULSE_RUNS=3 npm run x-display:test-fresh-pulse-rendering
```
