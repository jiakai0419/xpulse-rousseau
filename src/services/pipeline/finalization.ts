import type { PostTranslation, RefreshProgress, SelectedPost, UsageRecord } from "../../domain/tweet.ts";
import { translatePosts } from "../ai/translation.ts";
import type { LinkPreviewCacheRepository } from "../linkPreview/cache.ts";
import { enrichSelectedPostLinkPreviews } from "../linkPreview/enrich.ts";
import type { OpenAICacheRepository } from "../openai/cache.ts";
import type { RankedPost } from "../selection/authorDiversity.ts";

export type FinalizeSelectedPostsOptions = {
  apiKey: string;
  model: string;
  batchSize: number;
  cache?: OpenAICacheRepository;
  linkPreviewCache?: LinkPreviewCacheRepository;
  now: Date;
  onProgress?: (progress: Partial<RefreshProgress>) => void;
  onUsage?: (usage: UsageRecord) => void;
};

export type FinalizedSelectedPosts = {
  selectedPosts: SelectedPost[];
  translations: Map<string, PostTranslation>;
};

export async function finalizeSelectedPosts(top: RankedPost[], options: FinalizeSelectedPostsOptions): Promise<FinalizedSelectedPosts> {
  options.onProgress?.({
    stage: "translating",
    label: "Translating selected posts",
    detail: `Preparing to translate ${top.length} selected posts`,
    processedItems: 0,
    totalItems: top.length,
    model: options.model,
  });
  const translations = await translatePosts(top.map((item) => item.post), {
    apiKey: options.apiKey,
    model: options.model,
    batchSize: options.batchSize,
    cache: options.cache,
    now: options.now,
    onProgress: options.onProgress,
    onUsage: options.onUsage,
  });

  const selectedPosts = top.map((item) => ({
    ...item,
    translation: translations.get(item.post.id),
  }));

  if (options.linkPreviewCache) {
    options.onProgress?.({
      stage: "saving",
      label: "Resolving link previews",
      detail: `Resolving external preview cards for ${selectedPosts.length} selected posts`,
      processedItems: 0,
      totalItems: selectedPosts.length,
    });
    await enrichSelectedPostLinkPreviews(selectedPosts.map((item) => item.post), {
      cache: options.linkPreviewCache,
      now: options.now,
    });
  }

  return {
    selectedPosts,
    translations,
  };
}
