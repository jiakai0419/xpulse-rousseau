# Scoring Prompt V2

> Historical specification. V3 supersedes this prompt because V2 omitted quote context nested inside a reposted source. Current Online Pulse uses [`scoring-v3`](scoring-v3.md).

## Purpose

Score timeline posts so the reader can select a small number of high-value items.

V2 aligns scoring with Reader rendering: if a timeline item is a repost/retweet, OpenAI scores the reposted source post as the reader-facing content, not the `RT @...` wrapper. The wrapper is provided only as timeline context.

## OpenAI Output Dimensions

```json
{
  "immediateValue": {
    "score": 0,
    "reason": "用简体中文说明为什么这条现在值得看。"
  },
  "informationDensity": {
    "score": 0,
    "reason": "用简体中文说明这条的信息密度来自哪里。"
  }
}
```

Scores use a 0 to 10 scale. The weighted total is stored as a normalized 0 to 100 value for ranking stability, while the Reader displays Signal on the same 0 to 10 scale as its dimensions.

The returned reasons must be natural Simplified Chinese. Each reason should be one or two compact sentences that name concrete evidence from the post and explain why it matters. Preserve names, product terms, numbers, and URLs.

OpenAI does not receive engagement metrics for scoring. The local pipeline adds the `互动信号` dimension from the latest X replies, reposts, likes, and views after OpenAI quality scoring returns. For reposts, that local engagement signal uses the reposted source post metrics, matching the Reader surface.

## Current Weights

```json
{
  "immediateValue": 0.4,
  "informationDensity": 0.4,
  "engagementSignal": 0.2
}
```

## Model

Candidate posts are scored by the configured OpenAI model, defaulting to shared `OPENAI_MODEL=gpt-5`, through structured JSON output.

Live X refreshes must not use local heuristic scoring. They require OpenAI scoring, and the model must return exactly one score object for every input post id in the batch. Unknown ids or duplicate ids invalidate the batch. If a batch only omits ids, the system may make one same-model repair request for the missing ids; the repair request is recorded as normal OpenAI usage. If repair is still incomplete, the refresh fails instead of generating a selected set with substituted local scores.

## OpenAI Cache

Scoring responses can be cached as OpenAI operation outputs. The cache key includes operation `scoring`, requested model, prompt version `scoring-v2`, and the post content fingerprint. It does not include engagement metrics, scoring weights, selected count, seen policy, or author diversity rules.
