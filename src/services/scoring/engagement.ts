import type { ScoreDimension, TimelinePost } from "../../domain/tweet.ts";
import { readerMetrics } from "../../domain/postDisplay.ts";

function metric(value: number | undefined): number {
  return Number.isFinite(value) && value && value > 0 ? value : 0;
}

function compactNumber(value: number): string {
  return new Intl.NumberFormat("zh-CN", {
    notation: value >= 10000 ? "compact" : "standard",
    maximumFractionDigits: 1,
  }).format(value);
}

export function engagementSignalScore(post: TimelinePost): number {
  const metrics = readerMetrics(post);
  const replies = Math.log1p(metric(metrics.replies));
  const reposts = Math.log1p(metric(metrics.reposts));
  const likes = Math.log1p(metric(metrics.likes));
  const impressions = Math.log1p(metric(metrics.impressions));
  const raw = replies * 1.2 + reposts * 1.8 + likes * 1.4 + impressions * 0.35;
  const score = 10 * (1 - Math.exp(-raw / 15));

  return Math.max(0, Math.min(10, Number(score.toFixed(1))));
}

export function engagementSignalDimension(post: TimelinePost, weight: number): ScoreDimension {
  const metrics = readerMetrics(post);
  const replies = metric(metrics.replies);
  const reposts = metric(metrics.reposts);
  const likes = metric(metrics.likes);
  const impressions = metric(metrics.impressions);

  return {
    key: "engagementSignal",
    label: "互动信号",
    weight,
    score: engagementSignalScore(post),
    reason: `基于最新互动量：${compactNumber(replies)} 评论、${compactNumber(reposts)} 转发、${compactNumber(likes)} 点赞、${compactNumber(impressions)} 阅读。采用对数压缩，避免单个大号指标碾压内容分。`,
  };
}
