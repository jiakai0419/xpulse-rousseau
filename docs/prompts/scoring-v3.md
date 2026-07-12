# Scoring Prompt V3

## Purpose

Score timeline posts so the reader can select a small number of high-value items.

V3 keeps the V2 dimensions and calibration, while correcting the reader-facing reference contract. If a timeline item is a repost/retweet, OpenAI scores the reposted source post rather than the `RT @...` wrapper. Referenced-post context is then taken recursively from that source. A source post such as “Exactly this” therefore carries the quoted post that gives it meaning. The reposting account remains quiet timeline context.

The version changed so cache entries produced by the earlier incomplete retweet payload are not reused for affected posts.

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

Reasons must be natural Simplified Chinese, one or two compact sentences, and cite concrete evidence. Names, product terms, numbers, and URLs stay unchanged.

OpenAI does not receive engagement metrics. The local pipeline adds `互动信号` from the latest X replies, reposts, likes, and views after OpenAI returns. For reposts, that signal uses the source post's metrics.

## Current Weights

```json
{
  "immediateValue": 0.4,
  "informationDensity": 0.4,
  "engagementSignal": 0.2
}
```

## Completeness And Cache Rules

The configured OpenAI model must return exactly one score for every input id. Unknown or duplicate ids invalidate a batch. One same-model repair request may fill only missing ids; an incomplete repair fails the refresh.

Scoring cache keys include operation `scoring`, requested model, prompt version `scoring-v3`, and the source-content fingerprint. They exclude engagement metrics, weights, selected count, Seen policy, and author diversity.
