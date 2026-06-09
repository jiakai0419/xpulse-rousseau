import type { PostTranslation, RefreshProgress, TimelinePost, UsageRecord } from "../../domain/tweet.ts";
import type { OpenAICacheRepository } from "../openai/cache.ts";
import { openAICacheKey } from "../openai/cache.ts";
import { analyzeCompleteIds, chunkItems, createOpenAIUsageRecord, formatIncompleteIdsError } from "../openai/operationHelpers.ts";
import { callOpenAIJson } from "../openai/responses.ts";

export const TRANSLATION_PROMPT_VERSION = "translation-v2";

type TranslationOptions = {
  apiKey?: string;
  model?: string;
  now?: Date;
  batchSize?: number;
  cache?: OpenAICacheRepository;
  onProgress?: (progress: Partial<RefreshProgress>) => void;
  onUsage?: (usage: UsageRecord) => void;
};

type TranslationPayload = {
  translations: Array<{
    id: string;
    textZh: string;
  }>;
};

const TRANSLATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["translations"],
  properties: {
    translations: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "textZh"],
        properties: {
          id: { type: "string" },
          textZh: { type: "string" },
        },
      },
    },
  },
};

function buildTranslationPrompt(posts: TimelinePost[]): string {
  return JSON.stringify(
    {
      task: "Translate selected X posts into Chinese for a high-signal reader. Preserve meaning, claims, uncertainty, names, numbers, URLs, and the author's tone. Do not add analysis. If the timeline item is a repost/retweet, translate the reposted source post, not the RT wrapper text.",
      outputLanguage: "Chinese",
      posts: posts.map((post) => {
        const source = post.referencedPostType === "retweeted" && post.referencedPost ? post.referencedPost : post;

        return {
          id: post.id,
          timelineContext:
            post.referencedPostType === "retweeted"
              ? {
                  type: "reposted",
                  repostedBy: {
                    name: post.author.name,
                    username: post.author.username,
                  },
                }
              : undefined,
          author: {
            name: source.author.name,
            username: source.author.username,
          },
          createdAt: source.createdAt,
          language: source.language,
          text: source.text,
        };
      }),
    },
    null,
    2,
  );
}

async function requestTranslationBatch(options: {
  posts: TimelinePost[];
  translation: TranslationOptions;
  now: Date;
  label: string;
}): Promise<Array<{ id: string; textZh: string; model: string }>> {
  const result = await callOpenAIJson<TranslationPayload>({
    apiKey: options.translation.apiKey!,
    model: options.translation.model!,
    system: "You are a precise translator. Return only valid JSON. Translate into natural Chinese, preserve technical terms when needed, and do not summarize or explain.",
    user: buildTranslationPrompt(options.posts),
    schemaName: "x_post_translations",
    schema: TRANSLATION_SCHEMA,
  });
  const itemIds = options.posts.map((post) => post.id);
  const responseModel = result.model ?? options.translation.model!;
  const record = createOpenAIUsageRecord({
    operation: "translation",
    label: options.label,
    model: responseModel,
    usage: result.usage,
    itemIds,
    now: options.now,
  });

  if (record) {
    options.translation.onUsage?.(record);
  }

  return result.data.translations.map((translation) => ({
    ...translation,
    model: responseModel,
  }));
}

export async function translatePosts(posts: TimelinePost[], options: TranslationOptions = {}): Promise<Map<string, PostTranslation>> {
  const now = options.now ?? new Date();

  if (posts.length === 0) {
    return new Map();
  }

  if (!options.apiKey || !options.model) {
    throw new Error("OpenAI API key and translation model are required for live X translation. No local fallback was used.");
  }

  try {
    const translations = new Map<string, PostTranslation>();
    const uncachedPosts: TimelinePost[] = [];

    for (const post of posts) {
      if (!options.cache) {
        uncachedPosts.push(post);
        continue;
      }

      const cacheKey = openAICacheKey({
        operation: "translation",
        model: options.model,
        promptVersion: TRANSLATION_PROMPT_VERSION,
        post,
      });
      const cached = await options.cache.get<PostTranslation>(cacheKey.key);

      if (cached) {
        translations.set(post.id, cached.output);
      } else {
        uncachedPosts.push(post);
      }
    }

    if (translations.size) {
      options.onProgress?.({
        stage: "translating",
        label: "Translation cache",
        detail: `Reused cached OpenAI translations for ${translations.size} / ${posts.length} posts`,
        processedItems: translations.size,
        totalItems: posts.length,
        model: options.model,
      });
    }

    const parsedBatchSize = Math.floor(options.batchSize ?? 10);
    const batchSize = Number.isFinite(parsedBatchSize) ? Math.max(1, Math.min(25, parsedBatchSize)) : 10;
    const chunks = chunkItems(uncachedPosts, batchSize);
    let processed = 0;

    for (const chunk of chunks) {
      options.onProgress?.({
        stage: "translating",
        label: "Translating selected posts",
        detail: `Translating ${processed + 1}-${processed + chunk.length} / ${uncachedPosts.length} uncached posts with ${options.model}`,
        processedItems: processed,
        totalItems: uncachedPosts.length,
        model: options.model,
      });
      const itemIds = chunk.map((post) => post.id);
      const batchTranslations = await requestTranslationBatch({
        posts: chunk,
        translation: options,
        now,
        label: "Translation",
      });
      const completeness = analyzeCompleteIds({
        expectedIds: itemIds,
        returnedIds: batchTranslations.map((translation) => translation.id),
      });
      let completeTranslations = batchTranslations;

      if (!completeness.complete) {
        const canRepair =
          completeness.missingIds.length > 0 &&
          completeness.unexpectedIds.length === 0 &&
          completeness.duplicateIds.length === 0;

        if (!canRepair) {
          throw new Error(formatIncompleteIdsError("OpenAI translation", completeness));
        }

        const missingPosts = chunk.filter((post) => completeness.missingIds.includes(post.id));
        options.onProgress?.({
          stage: "translating",
          label: "Translation repair",
          detail: `Retrying ${missingPosts.length} missing translation${missingPosts.length === 1 ? "" : "s"} with ${options.model}`,
          processedItems: processed,
          totalItems: uncachedPosts.length,
          model: options.model,
        });
        const repairTranslations = await requestTranslationBatch({
          posts: missingPosts,
          translation: options,
          now,
          label: "Translation repair",
        });
        const repairCompleteness = analyzeCompleteIds({
          expectedIds: completeness.missingIds,
          returnedIds: repairTranslations.map((translation) => translation.id),
        });

        if (!repairCompleteness.complete) {
          throw new Error(formatIncompleteIdsError("OpenAI translation repair", repairCompleteness));
        }

        completeTranslations = [...batchTranslations, ...repairTranslations];
      }

      for (const item of completeTranslations) {
        const translation = {
          textZh: item.textZh,
          model: item.model,
          generatedAt: now.toISOString(),
        };
        translations.set(item.id, translation);

        if (options.cache) {
          const post = chunk.find((candidate) => candidate.id === item.id);

          if (post) {
            const cacheKey = openAICacheKey({
              operation: "translation",
              model: options.model,
              promptVersion: TRANSLATION_PROMPT_VERSION,
              post,
            });
            await options.cache.set<PostTranslation>({
              key: cacheKey.key,
              operation: "translation",
              postId: post.id,
              model: options.model,
              promptVersion: TRANSLATION_PROMPT_VERSION,
              contentFingerprint: cacheKey.contentFingerprint,
              output: translation,
              createdAt: now.toISOString(),
            });
          }
        }
      }

      processed += chunk.length;
      options.onProgress?.({
        stage: "translating",
        label: "Translating selected posts",
        detail: `Translated ${processed} / ${uncachedPosts.length} uncached posts`,
        processedItems: processed,
        totalItems: uncachedPosts.length,
        model: options.model,
      });
    }

    return translations;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown OpenAI translation error.";
    options.onProgress?.({
      stage: "failed",
      label: "Translation failed",
      detail: `OpenAI translation did not complete, so the selected set was not saved. Error: ${message}`,
      processedItems: 0,
      totalItems: posts.length,
      model: options.model,
    });
    throw new Error(`OpenAI translation failed and no local fallback was used. ${message}`);
  }
}
