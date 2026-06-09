import type { ScoreDimensionKey } from "../domain/tweet.ts";

export type ScoreWeight = {
  key: ScoreDimensionKey;
  label: string;
  weight: number;
};

export const SCORING_WEIGHTS: ScoreWeight[] = [
  {
    key: "immediateValue",
    label: "立即值得看",
    weight: 0.4,
  },
  {
    key: "informationDensity",
    label: "信息密度",
    weight: 0.4,
  },
  {
    key: "engagementSignal",
    label: "互动信号",
    weight: 0.2,
  },
];

export function normalizeWeights(weights: ScoreWeight[] = SCORING_WEIGHTS): ScoreWeight[] {
  const total = weights.reduce((sum, item) => sum + item.weight, 0);

  if (total <= 0) {
    throw new Error("At least one scoring weight must be positive.");
  }

  return weights.map((item) => ({
    ...item,
    weight: item.weight / total,
  }));
}
