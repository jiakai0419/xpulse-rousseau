import type { RefreshProgress, TimelinePost, UsageRecord } from "../../domain/tweet.ts";
import type { OpenAICacheRepository } from "../openai/cache.ts";
import { rankPostsWithOpenAI } from "../scoring/openAIScoring.ts";
import { selectTopByAuthorDiversity, type RankedPost } from "../selection/authorDiversity.ts";

export type ScoreAndSelectOptions = {
  apiKey: string;
  model: string;
  selectedPostCount: number;
  batchSize: number;
  cache?: OpenAICacheRepository;
  now: Date;
  onProgress?: (progress: Partial<RefreshProgress>) => void;
  onUsage?: (usage: UsageRecord) => void;
};

export type ScoreAndSelectResult = {
  ranked: RankedPost[];
  top: RankedPost[];
};

export async function scoreAndSelectPosts(posts: TimelinePost[], options: ScoreAndSelectOptions): Promise<ScoreAndSelectResult> {
  const ranked = await rankPostsWithOpenAI(posts, {
    apiKey: options.apiKey,
    model: options.model,
    batchSize: options.batchSize,
    cache: options.cache,
    now: options.now,
    onProgress: options.onProgress,
    onUsage: options.onUsage,
  });
  const selection = selectTopByAuthorDiversity(ranked, options.selectedPostCount);

  return {
    ranked,
    top: selection.selected,
  };
}
