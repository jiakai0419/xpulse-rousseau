# Online Pulse State

This document explains the local state that makes Online Pulse repeatable without making the Reader hard to reason about.

## State Stores

All stores live under `.data/` and are ignored by git.

- Run Store, `.data/runs.json`: saved reader runs, selected posts, translations, usage, and run trace.
- Seen Ledger, `.data/seen-posts.json`: identities of posts already shown in successful Online selected sets.
- Timeline Cursor, `.data/timeline-cursor.json`: newest post id seen by a successful Online timeline fetch.
- OpenAI Cache, `.data/openai-cache.json`: cached OpenAI operation outputs for scoring and translation.
- Raw X Snapshots, `.data/x-snapshots.json`: recent raw X timeline page responses and request metadata.

## Online Flow

1. Load the Timeline Cursor.
2. Ask X for newer home-timeline posts with `since_id` when a cursor exists.
3. If newer pages are missing or insufficient, fall back to normal recent home-timeline pagination.
4. Save each raw X timeline page as a Raw X Snapshot.
5. Normalize X data into `TimelinePost` records.
6. Remove ads and exact/retweet duplicates.
7. Filter posts that already exist in the Seen Ledger.
8. Read OpenAI Cache entries for scoring when the model, prompt version, and content fingerprint match.
9. Call OpenAI only for uncached quality scores.
10. Recalculate the local engagement signal from the latest X metrics.
11. Rank by weighted dimensions.
12. Apply author diversity after ranking: keep at most one final selected post per reader-facing author. Retweets count as the reposted source author.
13. Read OpenAI Cache entries for selected translations and call OpenAI only for uncached translations.
14. Save the run, then mark selected posts as seen and update the Timeline Cursor.

The Seen Ledger and Timeline Cursor are updated only after a successful Online run has been saved. A failed run should not make posts disappear from future results.

## Offline Flow

Offline is local replay. It does not call X or OpenAI, does not read or write the Seen Ledger, does not update the Timeline Cursor, and does not refresh OpenAI Cache entries. It simply replays saved X-derived run evidence.

This keeps Offline useful for UI development and comparison even when the same result has already been shown before.

## Seen Identity

The Seen Ledger stores a stable identity for each shown post.

- Normal post: `post:<post id>`.
- Retweet duplicate: `post:<original referenced post id>` when that canonical id is available.

Seen filtering happens before OpenAI calls so already-shown posts do not spend model tokens again.

## Freshness Cursor

The Timeline Cursor stores the newest X post id observed in a successful Online timeline fetch. X `since_id` is useful for asking for newer content, but it is not enough to enforce "do not show this again." The cursor and Seen Ledger are separate:

- Cursor: reduces repeated timeline fetching and prefers new input.
- Seen Ledger: prevents repeated selected output.

The cursor is best-effort. If `since_id` returns too little content or fails in a recoverable way, Online Pulse falls back to recent timeline pages so the action can still find candidates.

## OpenAI Cache Key

OpenAI Cache entries are keyed by:

- `operation`: `scoring` or `translation`.
- `model`: the requested OpenAI model for that operation.
- `promptVersion`: for example `scoring-v2` or `translation-v2`.
- `contentFingerprint`: a hash of source content that affects the OpenAI output.

The content fingerprint includes stable source text, author identity, created time, links, and referenced-post content. It intentionally excludes engagement metrics because those are recalculated locally every Online Pulse.

The cache key does not include scoring weights, selected count, author diversity, seen policy, or engagement formula. Those are ranking and selection rules applied after OpenAI returns quality outputs.

## Raw X Snapshots

X API v2 returns only requested fields, so the project asks for a broad reader-oriented profile of tweet fields, user fields, media fields, and expansions. Raw snapshots preserve what X actually returned before normalization.

This matters for UI fidelity. If a rendered post is missing media, a quoted post, a retweeted source image/video, a playable video variant, note-tweet full text, or URL preview evidence, the first question should be whether the latest raw X snapshot contains that data. If old replay data lacks the fields, run a fresh Online Pulse instead of adding field-by-field compatibility shims.
