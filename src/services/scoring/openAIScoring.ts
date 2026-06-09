import { SCORING_WEIGHTS, normalizeWeights } from "../../config/scoring.ts";
import { readerDisplayPost } from "../../domain/postDisplay.ts";
import type { RefreshProgress, ScoreDimension, TimelinePost, UsageRecord, WeightedScore } from "../../domain/tweet.ts";
import type { OpenAICacheRepository } from "../openai/cache.ts";
import { openAICacheKey } from "../openai/cache.ts";
import { analyzeCompleteIds, chunkItems, createOpenAIUsageRecord, formatIncompleteIdsError } from "../openai/operationHelpers.ts";
import { callOpenAIJson } from "../openai/responses.ts";
import { engagementSignalDimension } from "./engagement.ts";

export const SCORING_PROMPT_VERSION = "scoring-v2";

export type OpenAIScoringOptions = {
  apiKey?: string;
  model?: string;
  now?: Date;
  batchSize?: number;
  cache?: OpenAICacheRepository;
  onProgress?: (progress: Partial<RefreshProgress>) => void;
  onUsage?: (usage: UsageRecord) => void;
};

type ScoredPostPayload = {
  id: string;
  model?: string;
  immediateValue: number;
  immediateValueReason: string;
  informationDensity: number;
  informationDensityReason: string;
};

type ScoringPayload = {
  scores: ScoredPostPayload[];
};

const SCORING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["scores"],
  properties: {
    scores: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "immediateValue", "immediateValueReason", "informationDensity", "informationDensityReason"],
        properties: {
          id: { type: "string" },
          immediateValue: { type: "number", minimum: 0, maximum: 10 },
          immediateValueReason: { type: "string" },
          informationDensity: { type: "number", minimum: 0, maximum: 10 },
          informationDensityReason: { type: "string" },
        },
      },
    },
  },
};

function clamp(score: number): number {
  return Math.max(0, Math.min(10, Number(score.toFixed(1))));
}

function buildScoringPrompt(posts: TimelinePost[]): string {
  return JSON.stringify(
    {
      task: "Score X posts for a personal high-signal reader. Score every post independently before comparing them. Return JSON only. If the timeline item is a repost/retweet, score the reposted source post as the reader-facing content, not the RT wrapper text.",
      reasonLanguage: "Write immediateValueReason and informationDensityReason in natural Simplified Chinese. Each reason should be 1-2 compact sentences, concrete rather than generic: name the evidence in the post and explain why it matters. Keep names, product terms, numbers, and URLs unchanged.",
      dimensions: {
        immediateValue: "0-10. How worth reading this is right now for a smart generalist who follows high-signal accounts. Reward timeliness, consequence, decision relevance, novelty, and author/context signal. Penalize empty takes, pure dunking, vague claims, or low consequence.",
        informationDensity: "0-10. How much meaningful signal is packed into the post. Reward specific claims, causal structure, numbers, evidence, links, or compressed insight. Penalize fluff, repetition, slogans, and context-free reactions.",
      },
      posts: posts.map((post) => {
        const source = readerDisplayPost(post);

        return {
          id: post.id,
          timelineContext:
            post.referencedPostType === "retweeted" && post.referencedPost
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
          referencedPostType: post.referencedPostType === "retweeted" ? undefined : post.referencedPostType,
          referencedPost:
            post.referencedPost && post.referencedPostType !== "retweeted"
              ? {
                  author: {
                    name: post.referencedPost.author.name,
                    username: post.referencedPost.author.username,
                  },
                  text: post.referencedPost.text,
                  createdAt: post.referencedPost.createdAt,
                  language: post.referencedPost.language,
                }
              : undefined,
        };
      }),
    },
    null,
    2,
  );
}

function scoreFromPayload(post: TimelinePost, payload: ScoredPostPayload, model: string, now: Date): WeightedScore {
  const weights = normalizeWeights(SCORING_WEIGHTS);
  const raw: Record<string, { score: number; reason: string }> = {
    immediateValue: {
      score: clamp(payload.immediateValue),
      reason: payload.immediateValueReason,
    },
    informationDensity: {
      score: clamp(payload.informationDensity),
      reason: payload.informationDensityReason,
    },
  };

  const dimensions: ScoreDimension[] = weights.map((weight) => ({
    ...(weight.key === "engagementSignal"
      ? engagementSignalDimension(post, weight.weight)
      : {
          key: weight.key,
          label: weight.label,
          weight: weight.weight,
          score: raw[weight.key].score,
          reason: raw[weight.key].reason,
        }),
  }));

  return {
    total: Math.round(dimensions.reduce((sum, dimension) => sum + dimension.score * dimension.weight, 0) * 10),
    dimensions,
    model,
    generatedAt: now.toISOString(),
  };
}

async function requestScoringBatch(options: {
  posts: TimelinePost[];
  scoring: OpenAIScoringOptions;
  now: Date;
  label: string;
}): Promise<ScoredPostPayload[]> {
  const result = await callOpenAIJson<ScoringPayload>({
    apiKey: options.scoring.apiKey!,
    model: options.scoring.model!,
    system: "You are an expert information-quality evaluator. Return only valid JSON. Be selective and calibrated; most ordinary posts should not receive scores above 7.5. Write all score reasons in specific, evidence-based Simplified Chinese.",
    user: buildScoringPrompt(options.posts),
    schemaName: "x_post_scores",
    schema: SCORING_SCHEMA,
  });
  const itemIds = options.posts.map((post) => post.id);
  const responseModel = result.model ?? options.scoring.model!;
  const record = createOpenAIUsageRecord({
    operation: "scoring",
    label: options.label,
    model: responseModel,
    usage: result.usage,
    itemIds,
    now: options.now,
  });

  if (record) {
    options.scoring.onUsage?.(record);
  }

  return result.data.scores.map((score) => ({ ...score, model: responseModel }));
}

async function cacheScoringOutputs(
  cache: OpenAICacheRepository | undefined,
  posts: TimelinePost[],
  scores: ScoredPostPayload[],
  requestedModel: string,
  now: Date,
): Promise<void> {
  if (!cache) {
    return;
  }

  const postsById = new Map(posts.map((post) => [post.id, post]));

  for (const score of scores) {
    const post = postsById.get(score.id);

    if (!post) {
      continue;
    }

    const cacheKey = openAICacheKey({
      operation: "scoring",
      model: requestedModel,
      promptVersion: SCORING_PROMPT_VERSION,
      post,
    });
    await cache.set<ScoredPostPayload>({
      key: cacheKey.key,
      operation: "scoring",
      postId: post.id,
      model: requestedModel,
      promptVersion: SCORING_PROMPT_VERSION,
      contentFingerprint: cacheKey.contentFingerprint,
      output: score,
      createdAt: now.toISOString(),
    });
  }
}

export async function rankPostsWithOpenAI(posts: TimelinePost[], options: OpenAIScoringOptions = {}): Promise<Array<{ post: TimelinePost; score: WeightedScore }>> {
  if (!options.apiKey || !options.model) {
    throw new Error("OpenAI API key and scoring model are required for live X scoring. No local fallback was used.");
  }

  const now = options.now ?? new Date();
  const parsedBatchSize = Math.floor(options.batchSize ?? 20);
  const batchSize = Number.isFinite(parsedBatchSize) ? Math.max(1, Math.min(50, parsedBatchSize)) : 20;
  const payloadScores: ScoredPostPayload[] = [];
  const uncachedPosts: TimelinePost[] = [];
  let processed = 0;

  try {
    for (const post of posts) {
      if (!options.cache) {
        uncachedPosts.push(post);
        continue;
      }

      const cacheKey = openAICacheKey({
        operation: "scoring",
        model: options.model,
        promptVersion: SCORING_PROMPT_VERSION,
        post,
      });
      const cached = await options.cache.get<ScoredPostPayload>(cacheKey.key);

      if (cached) {
        payloadScores.push(cached.output);
      } else {
        uncachedPosts.push(post);
      }
    }

    if (payloadScores.length) {
      options.onProgress?.({
        stage: "scoring",
        label: "Scoring cache",
        detail: `Reused cached OpenAI scoring for ${payloadScores.length} / ${posts.length} posts`,
        processedItems: payloadScores.length,
        totalItems: posts.length,
        model: options.model,
      });
    }

    const chunks = chunkItems(uncachedPosts, batchSize);

    for (const chunk of chunks) {
      options.onProgress?.({
        stage: "scoring",
        label: "Scoring",
        detail: `Scoring ${processed + 1}-${processed + chunk.length} / ${uncachedPosts.length} uncached posts with ${options.model}`,
        processedItems: processed,
        totalItems: uncachedPosts.length,
        model: options.model,
      });
      const itemIds = chunk.map((post) => post.id);
      const batchScores = await requestScoringBatch({
        posts: chunk,
        scoring: options,
        now,
        label: "Scoring",
      });
      const completeness = analyzeCompleteIds({
        expectedIds: itemIds,
        returnedIds: batchScores.map((score) => score.id),
      });

      if (!completeness.complete) {
        const canRepair =
          completeness.missingIds.length > 0 &&
          completeness.unexpectedIds.length === 0 &&
          completeness.duplicateIds.length === 0;

        if (!canRepair) {
          throw new Error(formatIncompleteIdsError("OpenAI scoring", completeness));
        }

        const missingPosts = chunk.filter((post) => completeness.missingIds.includes(post.id));
        options.onProgress?.({
          stage: "scoring",
          label: "Scoring repair",
          detail: `Retrying ${missingPosts.length} missing scoring result${missingPosts.length === 1 ? "" : "s"} with ${options.model}`,
          processedItems: processed,
          totalItems: uncachedPosts.length,
          model: options.model,
        });
        const repairScores = await requestScoringBatch({
          posts: missingPosts,
          scoring: options,
          now,
          label: "Scoring repair",
        });
        const repairCompleteness = analyzeCompleteIds({
          expectedIds: completeness.missingIds,
          returnedIds: repairScores.map((score) => score.id),
        });

        if (!repairCompleteness.complete) {
          throw new Error(formatIncompleteIdsError("OpenAI scoring repair", repairCompleteness));
        }

        const completeScores = [...batchScores, ...repairScores];
        payloadScores.push(...completeScores);
        await cacheScoringOutputs(options.cache, chunk, completeScores, options.model, now);
      } else {
        payloadScores.push(...batchScores);
        await cacheScoringOutputs(options.cache, chunk, batchScores, options.model, now);
      }

      processed += chunk.length;
      options.onProgress?.({
        stage: "scoring",
        label: "Scoring",
        detail: `Scored ${processed} / ${uncachedPosts.length} uncached posts`,
        processedItems: processed,
        totalItems: uncachedPosts.length,
        model: options.model,
      });
    }

    const scoresById = new Map(payloadScores.map((score) => [score.id, score]));

    return posts
      .map((post) => {
        const score = scoresById.get(post.id);
        if (!score) {
          throw new Error(`OpenAI scoring validation missed post ${post.id}.`);
        }

        return {
          post,
          score: scoreFromPayload(post, score, score.model ?? options.model!, now),
        };
      })
      .sort((left, right) => {
        if (right.score.total !== left.score.total) {
          return right.score.total - left.score.total;
        }

        return Date.parse(right.post.createdAt) - Date.parse(left.post.createdAt);
      });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown OpenAI scoring error.";

    options.onProgress?.({
      stage: "failed",
      label: "Scoring failed",
      detail: `OpenAI scoring did not complete, so no selected set was generated. Error: ${message}`,
      processedItems: processed,
      totalItems: posts.length,
      model: options.model,
    });
    throw new Error(`OpenAI scoring failed and no local fallback was used. ${message}`);
  }
}
