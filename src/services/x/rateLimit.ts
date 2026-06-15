import type { UsageRecord } from "../../domain/tweet.ts";

export function numberHeader(response: Response, name: string): number | undefined {
  const value = response.headers.get(name);

  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function rateLimitFromResponse(response: Response): UsageRecord["rateLimit"] {
  const reset = numberHeader(response, "x-rate-limit-reset");

  return {
    limit: numberHeader(response, "x-rate-limit-limit"),
    remaining: numberHeader(response, "x-rate-limit-remaining"),
    resetAt: reset ? new Date(reset * 1000).toISOString() : undefined,
  };
}
