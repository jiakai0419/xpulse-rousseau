# Product Brief

## Goal

Build a web program that helps the user quickly screen X.com content from their Following timeline and read the highest-value items with less friction.

## V1 Scope

- The user actively triggers a refresh.
- In Online mode, the system reads from the user's authenticated X home timeline, tries newer posts first, and falls back to recent paginated pages when needed.
- In Offline mode, the system replays the latest saved X-derived result without changing online state.
- The system removes obvious ads and exact/retweet duplicates.
- The system excludes posts that were already shown in previous Online selected sets.
- The system scores remaining posts with weighted dimensions.
- The system selects up to 7 posts by weighted score, with at most one final selected post per author.
- The UI presents selected posts in a familiar X-like card layout.
- Each selected post includes:
  - Original content.
  - Chinese translation.
  - Weighted score.
  - Per-dimension scores.

## Non-Goals For V1

- 24/7 automatic monitoring.
- Full X timeline replacement.
- GUI scraping.
- Personalized interest learning from long-term behavior.
- Perfect ad detection.
- Broad semantic deduplication across related topics.
- Expensive per-post deep analysis.
- Fictional sample/mock data as a user-facing or test data source.

## Product Principles

- Prefer API access over GUI simulation.
- Keep the user in control. The app should explain why it selected each post.
- Translate selected posts by default so the selected set is readable immediately.
- Show visible progress for slow AI work. Refresh should expose scoring/translation stages, model names, processed item counts, and token usage.
- Pulse runs as a recoverable background job. If the browser is refreshed while Pulse is running, the reader should reconnect to the running job instead of leaving the user guessing. A second Pulse click while a job is running should reattach to that job rather than starting another costly X/OpenAI refresh.
- Treat usage as secondary observability. The UI should expose enough cost and quota information for control, but keep it collapsed or visually quiet so it does not compete with the selected posts.
- Usage is per action, not global accumulation. One refresh is one receipt that aggregates its X fetch, scoring, and translation lines. Separate refreshes remain separate receipts.
- Preserve enough run evidence for future prompt and ranking work. A refresh should keep a structured trace of inputs, filtering, dedupe, scoring, selection, and translation, while keeping this trace out of the main reading UI.
- Preserve live X-derived evidence even when the user repeatedly replays locally. Replay history may roll over, but it must not evict the latest saved live X run because that run is the source of truth for offline reading and UI research.
- Ranking should be configurable over time.
- Live X refreshes must use OpenAI for scoring and selected-post translation. If X or OpenAI fails, the action fails visibly rather than silently substituting local output.
- Replay and automated verification should use saved X runs/traces. Replay must not call X or OpenAI, and it should preserve recorded scores, translations, and trace evidence.
- Previously displayed selected posts should not appear again in Online Pulse results. This is controlled by a local Seen Ledger, not by X pagination alone. Offline/replay ignores the Seen Ledger so saved results remain stable.
- Online Pulse should prefer freshness without becoming brittle. It uses a local timeline cursor and X `since_id` to ask for newer posts first, then falls back to normal recent timeline pagination if there are not enough candidates.
- OpenAI scoring and translation should be cached as OpenAI operation outputs, not as final ranking decisions. Cache keys include operation, requested model, prompt version, and a source-content fingerprint. They exclude latest engagement metrics, scoring weights, Top count, author diversity, and seen policy.
- Engagement metrics are fresh ranking inputs. Replies, reposts, likes, and views should be read from the latest X response and recalculated locally each Online Pulse rather than cached with OpenAI outputs.
- Store raw X timeline responses locally for UI fidelity research and future normalization work. If X returns media, URL entities, preview metadata, quoted posts, or video variants, keep the evidence rather than dropping it during normalization.
- Retweets should read like X retweets: display the reposted source post as the main content, keep the reposting account as quiet context, and use the source post's media, metrics, author, original link, scoring content, and translation content.
- The UI should be visually close to X's timeline density and structure, while avoiding X branding or anything that could imply the app is an official X product.
- Timeline visuals should align to X's stable reading constants where possible: 600px center column, 53px sticky header, 12px/16px post padding, 40px avatars with 12px content gap, 15px text on a 20px line, `#0f1419` primary text, `#536471` secondary text, `#eff3f4` dividers, `#f7f9f9` hover, and `#1d9bf0` for inline links.
- Product chrome should be English. Chinese text appears as translated post content, not as control labels.
- Signal scoring reasons are reader-facing explanation, not product chrome. Dimension labels and AI-generated score reasons should be shown in Chinese so the user can judge selection quality quickly.
- Typography should be macOS-first and restrained: prefer Apple system fonts/SF Pro with PingFang SC for Chinese, good smoothing, and no decorative or flashy type treatments.
- Color should be planned as a neutral reader palette: white surfaces, soft gray page/background states, graphite text, and one restrained steel accent. Bright X-like blue should not be used as a general-purpose highlight; reserve accent color for `Pulse`, progress, and compact signal indicators.
- Chinese translations should be visually distinct from the source post with a lightweight neutral-gray translation band, not hidden as plain continuation text, not blue-highlighted, and not framed as a nested card.
- Original post media, URL entities, URL preview metadata, and quoted posts are part of the source content. Preserve images/videos, link preview metadata, media URL keys, and referenced post content from X API when available. Render quoted posts as compact X-like quote cards instead of ordinary inline links. If a referenced post id is present but the timeline page did not include its body, use X tweet lookup enrichment before saving the run rather than leaving the Reader to guess. When X returns an external URL entity without preview metadata, Online Pulse may resolve ordinary web page metadata for final selected posts and cache that URL preview separately from OpenAI outputs. Render URL preview cards only for ordinary no-attached-media external previews. If the post has attached image/video media, the media is the primary rich object and additional external URLs stay inline. Older replay data that lacks structured link previews, resolved URL entities, media variants, or quoted-post data is a low-fidelity historical sample; do not add reader-side compatibility shims for each missing field. Run a fresh Online Pulse to replace it.
- Timeline media should follow X-like gallery geometry: one photo or video preserves its source aspect ratio up to practical timeline bounds, tall single media shrinks in width near X's timeline height cap instead of being forced into a full-width crop, two items render as a two-column 16:9 gallery, and three/four items choose an X-like gallery frame from the saved source shapes rather than defaulting to one fixed square. Use cropping inside multi-item gallery cells rather than letting tall source images stretch the timeline. Quoted-post media should follow X quote-card behavior: multi-media and single-video previews fill the quote card width, while single photos can still use the source-ratio width/height cap.
- Timeline media should be inspectable like X photo/video posts. Clicking a rendered media item should open a black, focused media viewer with the saved X media shown at full fit-to-screen size, close/keyboard controls, and gallery navigation when a post has multiple media items. Video media should autoplay muted inline when saved variants exist, use the local media proxy for `video.twimg.com` playback, and open in the viewer from the saved playable variant. Older replay entries without variants are not compatibility targets and should be replaced by a fresh Online Pulse.
- Timeline engagement metrics should visually follow X's lightweight action row. Show replies, reposts, likes, and views in a full-width five-column action row with restrained outline icons; keep quote counts in stored data rather than forcing them into the primary reading row.
- Signal belongs in the same full-width action row as engagement metrics, as a fifth low-key disclosure action after views. Its collapsed state should use a small signal icon, a 0-10 score, and a caret; it should not use progress bars or read like a separate scoring strip. Expanded Signal sub-scores should use the same numeric styling and right-edge alignment as the collapsed total score.
- The primary refresh action is named `Pulse`.
- `Pulse` should be treated as the product's bespoke primary action: stable dimensions, deliberate iconography, clear running feedback, a black-led graphite-to-midnight-blue gradient with only a restrained electric-blue edge, and smooth hover motion without sudden flashes.
- The top header should stay minimal and focused on `Pulse` plus its source control; avoid visible explanatory reader titles and persistent capture timestamps. Capture time remains available in run data/trace rather than occupying reader chrome. Source selection belongs next to `Pulse` as a very thin `Offline`/`Online` switch because it changes the input for that action, not as a standalone reader strip or sidebar settings block.
- `Offline` and `Online` are Pulse source states, not reader tabs. `Offline` uses local replay from saved X-derived runs; `Online` uses live X. When X is connected, page refresh should default the Pulse source to `Online`; the user can still switch to `Offline` for local replay. Present the selected source as a compact status switch beside `Pulse` rather than timeline navigation.
- `Offline` guarantees no new X API or OpenAI work and no Online-state mutation. It is not an air-gapped media archive: saved image/video URLs may still load from X CDNs in the Reader. Cheap UI smoke blocks those external requests so CDN availability cannot masquerade as a product regression.
- Connected X account status should live in the left sidebar in place of abstract branding, showing the account avatar and handle. The session bar should not repeat account identity; reconnect/disconnect controls are account maintenance actions and should not appear as persistent reading controls.
- Runtime status should be visually quiet and reader-oriented. Do not keep a persistent main-timeline status strip for completed runs; the first reading viewport should go straight from the top header into selected posts. Show visible progress or error copy only while Pulse is running or needs attention. Model metadata belongs under the left account area as secondary environment metadata and should show only the current model name when scoring and translation share one model. Selection count belongs in configuration, usage, or run trace data rather than persistent reader chrome.
- Run pipeline counts such as fetched, ads, duplicates, scored, and selected should not appear as a persistent reader strip. Keep them in stored run data or secondary details rather than occupying the first reading viewport.
- Scoring details should be available through a quiet `Signal` disclosure in the action row, rather than competing with the post text. Inside expanded Signal details, each scoring dimension should read as a small neutral label with a 0-10 score and Chinese reason text; avoid rail/progress-bar styling for both the total and sub-scores.
- Links back to the original X post should be treated as low-priority actions: compact, neutral, placed in the post header as an `Original` action, and available without reading like a primary call-to-action.
- The user-facing product should present live X data and local historical X-derived replay data. Purely constructed timelines should not be used as a source.
- Replay is for saved X-derived evidence, not long-term schema compatibility. When a UI surface depends on newly captured X fields, prefer a fresh Online Pulse over adding field-by-field compatibility logic for old replay entries.
- Feedback, prompt comparisons, and ranking experiments are deferred and should not be mixed into the Reader flow.

## Current Ranking Dimensions

The current ranking is a weighted blend of:

- 立即值得看, weight `0.4`: OpenAI judges how worth reading the post is right now.
- 信息密度, weight `0.4`: OpenAI judges how much meaningful signal is packed into the post.
- 互动信号, weight `0.2`: local deterministic score from the latest X replies, reposts, likes, and views.

In live mode, the configured OpenAI model scores the two quality dimensions. There is no local heuristic replacement for those quality dimensions. The engagement dimension is intentionally local because it depends on fresh X metrics, not model judgment.

After weighted ranking, the final selected set applies author diversity: at most one selected post per reader-facing author, keeping that author's highest-ranked post. For retweets, the reader-facing author is the reposted source author. Future dimensions may include novelty, credibility, personal relevance, source authority, or disagreement value.
