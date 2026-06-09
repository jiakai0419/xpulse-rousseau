import type { FilterDecision, TimelinePost } from "../../domain/tweet.ts";

const STRONG_AD_PATTERNS = [
  /\bsponsored\b/i,
  /\bpaid partnership\b/i,
  /\bad\b/i,
  /\baffiliate\b/i,
  /\breferral\b/i,
  /\buse code\b/i,
  /\bpromo code\b/i,
  /\bcoupon\b/i,
  /\bblack friday\b/i,
  /\blimited time offer\b/i,
  /推广/,
  /广告/,
  /赞助/,
  /优惠码/,
  /返利/,
  /限时优惠/,
];

const COMMERCIAL_SIGNALS = [
  /\b\d{1,3}%\s*off\b/i,
  /\bfree trial\b/i,
  /\bsale\b/i,
  /\bbuy now\b/i,
  /\bsign up\b/i,
  /\bsubscribe\b/i,
  /\bwaitlist\b/i,
  /立减/,
  /折扣/,
  /报名/,
  /课程/,
  /私信/,
  /购买/,
];

export function decideAdFilter(post: TimelinePost): FilterDecision {
  const text = post.text;
  const signals: string[] = [];

  for (const pattern of STRONG_AD_PATTERNS) {
    if (pattern.test(text)) {
      signals.push(`strong:${pattern.source}`);
    }
  }

  for (const pattern of COMMERCIAL_SIGNALS) {
    if (pattern.test(text)) {
      signals.push(`commercial:${pattern.source}`);
    }
  }

  const hasUrl = /https?:\/\//i.test(text);
  const excluded = signals.some((signal) => signal.startsWith("strong:")) || (hasUrl && signals.length >= 2);

  return {
    excluded,
    reason: excluded ? "obvious commercial promotion" : undefined,
    signals,
  };
}

export function filterAds(posts: TimelinePost[]): { kept: TimelinePost[]; excluded: Array<{ post: TimelinePost; decision: FilterDecision }> } {
  const kept: TimelinePost[] = [];
  const excluded: Array<{ post: TimelinePost; decision: FilterDecision }> = [];

  for (const post of posts) {
    const decision = decideAdFilter(post);

    if (decision.excluded) {
      excluded.push({ post, decision });
    } else {
      kept.push(post);
    }
  }

  return { kept, excluded };
}
