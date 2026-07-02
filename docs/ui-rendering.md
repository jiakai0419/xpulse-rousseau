# UI Rendering Notes

This document records X-like rendering targets for the Reader. It is meant to keep UI work from becoming one-off fixes for individual posts.

## Fresh Data Over Compatibility

Some UI surfaces require structured X fields: media variants, URL entities, link preview images, and referenced posts. If an old replay lacks those fields, do not add field-by-field compatibility shims in the Reader. Run a fresh Online Pulse so replay has high-fidelity X-derived data.

Replay remains useful for local development, but old replay entries are not a permanent schema-compatibility target.

## URL And Media Rules

- Retweets render the reposted source post as the main content. The retweeting account appears only as a small repost context line.
- Nested quoted posts inside reposted source posts must be preserved. If the home timeline page includes only the quoted-post id, the X client should use tweet lookup to fetch the quoted body instead of leaving a naked status URL in the Reader.
- Ordinary URL entities remain inline unless the Reader intentionally renders another X-like object for that URL.
- Media URL entities such as `pic.x.com`, `/photo/`, `/video/`, and URL entities with `media_key` are hidden when the corresponding X media is rendered.
- Quoted status URLs are hidden when the quoted post is rendered as a quote card.
- External preview URLs stay visible as inline blue links when the URL appears before more body text, even when the same URL also renders a preview card. Preview-card URLs are hidden only when they act as a trailing rich-object link at the end of the body.
- External preview URLs render as X-like URL preview cards only when preview metadata exists and the post has no attached image/video media. Online Pulse can resolve missing ordinary web preview metadata for final selected posts when X only returns an expanded URL.
- When a post has attached photo or video media, keep additional external preview URLs inline and show the attached media. X detail pages commonly prioritize the attached media rather than adding a second URL preview card in the same post body.
- When a post has attached media and a quoted post, keep additional external preview URLs inline. X commonly prioritizes the attached media plus quote card in that layout, and forcing another preview card makes the Reader diverge from the original.
- URL preview cards use:
  - rounded media frame;
  - source aspect ratio approximated with a `1.91 / 1` preview ratio;
  - image cropped with `object-fit: cover`;
  - compact title overlay when image preview is available;
  - title/description text card when X only returns text preview metadata;
- A single photo or video uses the saved X media dimensions, preserving source aspect ratio within the timeline cap. Tall/vertical media should shrink in width when needed rather than being forced into a full-width crop.
- A single video autoplays muted inline when a playable X variant exists, and uses the local media proxy for `video.twimg.com` URLs so browser playback is not blocked by cross-origin 403 responses. Single-video frames use a black background with `object-fit: contain`, matching X's treatment of portrait videos inside wide media cards instead of cropping them like photos. The saved duration appears as a small bottom-left overlay.
- Two attached media items render as a two-column 16:9 gallery. Three and four attached media items choose an X-like gallery frame from the saved source shapes: all-landscape sets use a wide 16:9 frame, while mixed/tall sets can remain square. Quoted-post media follows X quote-card behavior: multi-media and single-video previews fill the quote card width, while single photos can still use the source-ratio width/height cap.

## Current Audit Notes

- 2026-06-07 Online Pulse audit (`run_1780783416820`): compared all 7 selected `Original` links in Chrome against the Reader. Single-photo posts preserved source aspect ratios well. The largest mismatch was quoted-post media: the Reader previously squeezed quote media with inner padding and rendered two-image galleries as a flatter 2:1 frame. Quote media now fills the quote card width and two-item galleries use an X-like 16:9 frame. The action row remains a five-column row: replies, reposts, likes, views, and Signal.
- 2026-06-07 video replay audit (`run_1780768716016`): verified saved X video variants render as muted autoplay inline video and open in the media viewer from a playable saved variant.
- 2026-06-07 broad X rendering audit: sampled 486 fresh home-timeline posts and opened 24 representative originals across videos, multi-image galleries, quote cards, quote cards with media, and URL previews. Important findings:
  - X videos choose a playable inline variant rather than the highest bitrate/original-size variant. For the Niels Rogge CVPR post, X used the 1722x1080 variant rather than the 3064x1920 variant.
  - Browser playback from `video.twimg.com` can return 403 from `localhost`; the Reader must play videos through the local `/api/media/proxy` endpoint.
  - X uses real media aspect ratios for single videos. Do not force all videos into 16:9.
  - A reposted source can itself quote another post. The X home timeline expansion may include the reposted source but not the source's quoted target, so the Reader needs X tweet lookup enrichment before saving the run.
  - When a post has attached media plus a quoted post, X can keep an external preview URL inline rather than rendering a separate preview card.
- 2026-06-07 Online Pulse audit (`run_1780809953829`): compared 7 selected posts plus 13 broader fresh originals in Chrome, including selected quote/media posts and non-selected video/link-preview cases from the same live trace. Important findings:
  - X detail pages use a center article width near 600px and a media content width near 566px.
  - Single tall media uses a height cap around 510px and shrinks width to preserve the source ratio.
  - Video originals autoplay muted inline; Reader videos must also autoplay from saved X variants through `/api/media/proxy`.
  - External URL previews are shape-dependent: no-media external links render as preview cards; video posts keep the URL inline; media-plus-quote posts keep additional external links inline; some photo posts can still render both photo media and preview cards.
- 2026-06-07 Online Pulse verification (`run_1780815176593`): fetched a new live run after UI changes and compared all 7 selected originals. Important findings:
  - The selected set included quote cards, a quoted post with four landscape images, one square video, one square image, and one tall image.
  - X rendered the quoted four-landscape-image set as a wide two-by-two gallery, not a square gallery. The Reader now derives 3/4-media gallery aspect from saved source image ratios.
  - The square video autoplayed in X and in the Reader when scrolled into view; the Reader uses the saved X variant through the local media proxy.
  - Single square and tall images preserved the X-like source aspect treatment; tall images shrink in width under the timeline height cap.
- 2026-06-07 final Online Pulse verification (`run_1780817743965`): fetched another live run after the gallery change and compared all 7 selected originals. Important findings:
  - The selected set included quote cards with a single vertical video, quote cards with single photo media, and several ordinary photo posts.
  - X renders single videos inside quote cards as a wide 16:9 preview, even when the saved source video is vertical. The Reader now applies that quote-card video rule instead of using the raw vertical source ratio there.
  - X still preserves source-ratio treatment for single photos, including tall photos; quote-card single photos should not be forced full-width.
- 2026-06-07 external preview validation (`run_1780849359473`, `run_1780849556985`, plus an extra `run_1780850087568` check): fetched fresh Online Pulse runs after adding selected-post external preview enrichment and saved local/original screenshots under `.data/render-audit/link-preview-validation/`. The selected samples covered quote cards, videos, X status links, X article links, and media links, but did not include an ordinary external web URL preview case. X-owned URLs such as `x.com/i/article/...`, X status URLs, and `pic.x.com` media are intentionally kept out of external preview enrichment.
- 2026-06-11 Display Gap Inventory: added explicit `x-article-link` and `quote-x-article-link` rendering buckets. These links can render as rich X Article cards on the Original page even when the X API returns only a URL entity in the tweet or quoted-tweet text. Treat them as a named display-risk category before deciding whether to add more enrichment or accept a mismatch.
- 2026-06-13 Display Oracle baseline: strict full-inventory Oracle passed 200 real X-derived samples with mandatory local Reader screenshots/facts and cached Original X screenshots/facts. The fixes were category-level, not post-id-specific: no-media posts render at most one primary external preview card, quoted posts can render their own link preview cards, X Article links render as article cards only when evidence-backed preview metadata exists, and local inventory screenshots use system Chrome by default for video playback fidelity.
- 2026-06-07 broad display fidelity audit after the detail-width renderer change: the old one-pass audit compared 42 X-derived samples against their Original X pages across retweets, quote cards, quote media, quote videos, single videos, single photos, multi-media galleries, no-preview external links, preview links, and media-plus-link posts. All 42 passed after the Reader moved post bodies/media/footer to the X-detail-like 566px content width and stopped rendering extra preview cards for posts that already have attached media. That one-pass command has since been removed; use the reusable `x-display:*` evidence flow below.
- 2026-06-07 fresh Online Pulse validation: ran three consecutive Online Pulse refreshes (`run_1780862524976`, `run_1780864130028`, `run_1780864421128`) and audited each new run's selected set plus representative same-trace samples. One Grok reply required authenticated X to view the Original page in Chrome; unauthenticated X showed a login wall. After fixing the audit to target `article[data-testid="tweet"]` by the exact `status/{id}` link instead of taking the first article in a conversation, a final 42-sample audit passed across latest selected posts, retweets, quote cards, videos, photos, external links, media-plus-link posts, and X status links.
- Anthropic science blog post: X renders a large URL preview image with title overlay and source below. If X omits the preview fields, Online Pulse should resolve the external page metadata for the selected post before saving, and the Reader should render it as a preview card only when the post has no attached media.
- Nous Research release post: X shows the attached release image and keeps the release links inline. The Reader should preserve the media and inline links instead of creating extra preview cards or dropping links.

## Planned Auditing Workflow

For future UI passes, compare selected posts and broader same-run samples against their `Original` links before changing CSS or rendering logic. Use:

```bash
npm run x-display:collect-local-renderings
npm run x-display:collect-original-renderings
npm run x-display:validate-diff-rules
DISPLAY_ORACLE_REQUIRE_ALL=1 npm run x-display:compare-rendering-facts
npm run x-display:build-screenshot-review
```

This flow writes reusable local and Original screenshots/facts, compares structured rendering facts, and builds a screenshot-review pack. Treat old replay rows that lack required X fields as obsolete samples; run fresh Online Pulse data instead of adding compatibility shims.

For rigorous evidence-led work, do not let the rendering rules prove themselves. Use the Display Oracle flow:

```bash
DISPLAY_INVENTORY_FRESH=1 DISPLAY_INVENTORY_FRESH_TARGET=100 npm run x-display:collect-local-renderings
npm run x-display:collect-original-renderings
npm run x-display:validate-diff-rules
npm run x-display:compare-rendering-facts
```

`x-display:collect-local-renderings` builds the broad real-data evidence map. `x-display:collect-original-renderings` lets Original X screenshots/facts be captured in batches and reused by post id. `x-display:validate-diff-rules` validates that rendering rules reference Inventory buckets/risks and explain known Oracle diffs. `x-display:compare-rendering-facts` is the structured comparison step: each checked row must have local screenshots/facts and Original screenshots/facts, with nonblank screenshot probes and screenshot-quality checks. It compares local Reader facts with Original X facts; it does not do screenshot pixel diff. If the evidence is missing, blank, low-quality, or not targeted to the exact Original article, the row is blocked rather than passed. Rendering rules explain diffs; screenshots and facts decide whether a diff exists.

To force every inventory sample to be covered by cached Original evidence before claiming fidelity:

```bash
DISPLAY_ORACLE_REQUIRE_ALL=1 npm run x-display:compare-rendering-facts
```

The intended standard is the whole inventory, not a handful of highlighted failures. If a new display issue appears, collect or refresh a broad inventory, fill Original evidence, and make the strict full-inventory Oracle pass again.

When auditing `Original` pages, never assume the first X `article[data-testid="tweet"]` is the target post. Replies and conversation pages can render parent posts above the target. Match the article containing the exact `/status/{postId}` link before screenshotting or extracting facts.

For broader display triage before fixing a single badcase, run:

```bash
DISPLAY_INVENTORY_FRESH=1 DISPLAY_INVENTORY_FRESH_TARGET=100 npm run x-display:collect-local-renderings
```

This inventory captures real X-derived samples and local Reader screenshots without calling OpenAI or changing the product reading state. Use it to see whether a mismatch belongs to a repeated rendering shape, such as X Article cards, videos, media-plus-link posts, or quote cards, before changing the Reader.
