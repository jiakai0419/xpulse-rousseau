# Ranking Design

This document records the current ranking behavior so future changes stay deliberate instead of hidden in UI code or prompt text.

## Author Diversity Cap

Goal: the final selected set should not be dominated by one author.

Current behavior:

- Score all candidate posts normally.
- Sort by weighted score.
- Build the final selected set by taking at most one post per author.
- If an author has multiple high-scoring posts, keep that author's best post and leave the rest eligible only for trace/evaluation, not the final selected set.
- Preserve excluded same-author posts as scored-but-not-selected decisions in run trace.

Open design questions:

- Whether retweets should count by retweeter, original author, or both.
- Whether a quoted post should count against the quote author, quoted author, or visible author only.
- Whether there should be an override for exceptionally important same-author posts.

## Engagement-Aware Signal

Goal: interaction volume should inform ranking without turning the reader into a popularity feed.

Current inputs:

- Replies.
- Reposts.
- Likes.
- Views.

Current approach:

- Add `互动信号` as a first-class scoring dimension.
- Normalize latest X metrics with a log-like saturating formula so views do not dominate raw counts.
- Weight replies, reposts, likes, and views differently, with reposts and replies carrying more signal than passive views.
- Keep the weight explicit in config and trace.
- Keep AI quality dimensions separate from engagement so the user can see whether a post was selected for substance, momentum, or both.
- Recalculate engagement each Online Pulse from fresh X metrics. Do not cache it with OpenAI output.

Current weights:

```json
{
  "immediateValue": 0.4,
  "informationDensity": 0.4,
  "engagementSignal": 0.2
}
```

Non-goals:

- Do not implement this as a hidden tie-breaker in the UI.
- Do not let engagement replace the model's quality judgment.
- Do not tune it from one or two examples without saved-run evaluation.
