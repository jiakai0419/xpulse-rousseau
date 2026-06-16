import type { PostLink, ReferencedPost, RefreshProgress, RefreshRun, TimelinePost, UsageRecord } from "../../domain/tweet.ts";
import { configuredOpenAIModels } from "../../config/openai.ts";
import { normalizeWeights, SCORING_WEIGHTS } from "../../config/scoring.ts";
import { selectedPostCountFromEnv } from "../../config/selection.ts";
import { TRANSLATION_PROMPT_VERSION, translatePosts } from "../ai/translation.ts";
import { enrichSelectedPostLinkPreviews } from "../linkPreview/enrich.ts";
import type { LinkPreviewCacheRepository } from "../linkPreview/cache.ts";
import type { OpenAICacheRepository } from "../openai/cache.ts";
import { SCORING_PROMPT_VERSION } from "../scoring/openAIScoring.ts";
import type { SeenPostRepository } from "../seen/seenLedger.ts";
import { cloneTimelinePost, createRunTrace } from "../trace/runTrace.ts";
import { fetchHomeTimeline } from "../x/client.ts";
import { buildXOAuthConfig, getFreshStoredXTokens } from "../x/oauth.ts";
import type { XRawSnapshotRepository } from "../x/rawSnapshotStore.ts";
import type { TimelineCursorRepository } from "../x/timelineCursor.ts";
import type { XTokenStore } from "../x/tokenStore.ts";
import { prepareCandidatePosts } from "./candidates.ts";
import { scoreAndSelectPosts } from "./selection.ts";

export type RunRefreshOptions = {
  source?: "x";
  now?: Date;
  timelinePosts?: TimelinePost[];
  env?: Record<string, string | undefined>;
  xTokenStore?: XTokenStore;
  timelineCursor?: TimelineCursorRepository;
  seenRepository?: SeenPostRepository;
  openAICache?: OpenAICacheRepository;
  linkPreviewCache?: LinkPreviewCacheRepository;
  xRawSnapshotRepository?: XRawSnapshotRepository;
  onProgress?: (progress: RefreshProgress) => void;
  onUsage?: (usage: UsageRecord) => void;
};

function getEnv(options: RunRefreshOptions): Record<string, string | undefined> {
  return options.env ?? process.env;
}

function openAIKey(env: Record<string, string | undefined>): string | undefined {
  const key = env.OPENAI_API_KEY;
  return key?.startsWith("sk-") ? key : undefined;
}

function positiveIntegerFromEnv(env: Record<string, string | undefined>, key: string, fallback: number): number {
  const parsed = Number(env[key]);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

function linkIdentity(link: PostLink): string {
  return [link.url, link.expandedUrl, link.displayUrl, link.mediaKey].filter(Boolean).join("|");
}

function copyLinkPreviewEvidence(target: TimelinePost | ReferencedPost, source: TimelinePost | ReferencedPost): void {
  const sourceLinksByIdentity = new Map((source.links ?? []).map((link) => [linkIdentity(link), link]));

  for (const targetLink of target.links ?? []) {
    const sourceLink = sourceLinksByIdentity.get(linkIdentity(targetLink));

    if (!sourceLink?.preview) {
      continue;
    }

    targetLink.preview = {
      ...sourceLink.preview,
      images: sourceLink.preview.images?.map((image) => ({ ...image })),
    };

    if (sourceLink.unwoundUrl && !targetLink.unwoundUrl) {
      targetLink.unwoundUrl = sourceLink.unwoundUrl;
    }
  }

  if (target.referencedPost && source.referencedPost) {
    copyLinkPreviewEvidence(target.referencedPost, source.referencedPost);
  }
}

async function loadTimeline(options: RunRefreshOptions): Promise<{ source: "x"; posts: TimelinePost[] }> {
  if (options.timelinePosts) {
    return {
      source: "x",
      posts: options.timelinePosts,
    };
  }

  const env = getEnv(options);
  const cursor = await options.timelineCursor?.get();
  const fetchOptions = {
    maxResults: positiveIntegerFromEnv(env, "X_TIMELINE_PAGE_SIZE", 100),
    targetResults: positiveIntegerFromEnv(env, "X_TIMELINE_TARGET_POSTS", 100),
    maxPages: positiveIntegerFromEnv(env, "X_TIMELINE_MAX_PAGES", 3),
    sinceId: cursor?.latestPostId,
    onRawSnapshot: (snapshot) => options.xRawSnapshotRepository?.save(snapshot),
    onUsage: options.onUsage,
  };

  if (env.X_USER_ID && env.X_USER_ACCESS_TOKEN) {
    return {
      source: "x",
      posts: await fetchHomeTimeline({
        userId: env.X_USER_ID,
        accessToken: env.X_USER_ACCESS_TOKEN,
        ...fetchOptions,
      }),
    };
  }

  if (!options.xTokenStore) {
    throw new Error("X credentials are required for live refresh. Connect X or set X_USER_ID and X_USER_ACCESS_TOKEN.");
  }

  const tokens = await getFreshStoredXTokens(options.xTokenStore, buildXOAuthConfig(env));

  if (!tokens?.accessToken || !tokens.user?.id) {
    throw new Error("Stored X OAuth credentials are missing. Connect X before live refresh.");
  }

  return {
    source: "x",
    posts: await fetchHomeTimeline({
      userId: tokens.user.id,
      accessToken: tokens.accessToken,
      ...fetchOptions,
    }),
  };
}

export async function runRefresh(options: RunRefreshOptions = {}): Promise<RefreshRun> {
  const now = options.now ?? new Date();
  const env = getEnv(options);
  const apiKey = openAIKey(env);
  const configuredModels = configuredOpenAIModels(env);
  const scoringModel = configuredModels.scoring;
  const translationModel = configuredModels.translation;
  const scoringBatchSize = positiveIntegerFromEnv(env, "OPENAI_SCORING_BATCH_SIZE", 20);
  const translationBatchSize = positiveIntegerFromEnv(env, "OPENAI_TRANSLATION_BATCH_SIZE", 10);
  const selectedPostCount = selectedPostCountFromEnv(env);
  const usageRecords: UsageRecord[] = [];
  const publishProgress = (progress: Partial<RefreshProgress>): void => {
    options.onProgress?.({
      stage: progress.stage ?? "starting",
      label: progress.label ?? "Preparing Pulse",
      detail: progress.detail ?? "Preparing to start",
      processedItems: progress.processedItems,
      totalItems: progress.totalItems,
      model: progress.model,
      usage: [...usageRecords],
      updatedAt: new Date().toISOString(),
    });
  };
  const recordUsage = (usage: UsageRecord): void => {
    usageRecords.push(usage);
    options.onUsage?.(usage);
    const isOpenAI = usage.provider === "openai";
    publishProgress({
      stage: usage.operation === "scoring" ? "scoring" : usage.operation === "translation" ? "translating" : usage.provider === "x" ? "loading" : "saving",
      label: usage.label,
      detail: isOpenAI ? `${usage.model}: input ${usage.inputTokens}, output ${usage.outputTokens}, total ${usage.totalTokens}` : `${usage.method ?? "GET"} ${usage.endpoint ?? "X API"} · ${usage.itemCount} items`,
      model: usage.model,
    });
  };

  publishProgress({
    stage: "loading",
    label: "Loading timeline",
    detail: "Reading the selected source",
  });

  if (!apiKey) {
    publishProgress({
      stage: "failed",
      label: "AI not configured",
      detail: "Live X refresh requires OpenAI scoring and translation. OPENAI_API_KEY is missing, so no selected set was generated.",
      processedItems: 0,
      totalItems: selectedPostCount,
    });
    throw new Error("OPENAI_API_KEY is required for live X refresh. No local fallback was used.");
  }

  const { source, posts } = await loadTimeline({ ...options, now, onUsage: recordUsage });
  const runId = `run_${now.getTime()}`;
  publishProgress({
    stage: "filtering",
    label: "Filtering",
    detail: `Fetched ${posts.length} posts; removing obvious ads and duplicates`,
    processedItems: posts.length,
    totalItems: posts.length,
  });
  const candidatePreparation = await prepareCandidatePosts(posts, options.seenRepository);

  publishProgress({
    stage: "scoring",
    label: "Scoring",
    detail: `Preparing to score ${candidatePreparation.candidates.length} candidate posts`,
    processedItems: 0,
    totalItems: candidatePreparation.candidates.length,
    model: scoringModel,
  });
  const { ranked, top } = await scoreAndSelectPosts(candidatePreparation.candidates, {
    apiKey,
    model: scoringModel,
    selectedPostCount,
    batchSize: scoringBatchSize,
    cache: options.openAICache,
    now,
    onProgress: publishProgress,
    onUsage: recordUsage,
  });
  publishProgress({
    stage: "translating",
    label: "Translating selected posts",
    detail: `Preparing to translate ${top.length} selected posts`,
    processedItems: 0,
    totalItems: top.length,
    model: translationModel,
  });
  const translations = await translatePosts(top.map((item) => item.post), {
    apiKey,
    model: translationModel,
    batchSize: translationBatchSize,
    cache: options.openAICache,
    now,
    onProgress: publishProgress,
    onUsage: recordUsage,
  });

  const selectedPosts = top.map((item) => ({
    ...item,
    translation: translations.get(item.post.id),
  }));

  if (options.linkPreviewCache) {
    publishProgress({
      stage: "saving",
      label: "Resolving link previews",
      detail: `Resolving external preview cards for ${selectedPosts.length} selected posts`,
      processedItems: 0,
      totalItems: selectedPosts.length,
    });
    await enrichSelectedPostLinkPreviews(selectedPosts.map((item) => item.post), {
      cache: options.linkPreviewCache,
      now,
    });
  }

  const selectedPostById = new Map(selectedPosts.map((item) => [item.post.id, item.post]));
  const traceInputPosts = candidatePreparation.inputPosts.map((post) => {
    const selectedPost = selectedPostById.get(post.id);
    const tracePost = cloneTimelinePost(post);

    if (selectedPost) {
      copyLinkPreviewEvidence(tracePost, selectedPost);
    }

    return tracePost;
  });

  publishProgress({
    stage: "saving",
    label: "Saving results",
    detail: `Saving ${selectedPosts.length} selected posts and usage records`,
    processedItems: selectedPosts.length,
    totalItems: selectedPosts.length,
  });

  return {
    id: runId,
    createdAt: now.toISOString(),
    source,
    stats: {
      fetched: posts.length,
      adsExcluded: candidatePreparation.adFiltered.excluded.length,
      duplicatesExcluded: candidatePreparation.deduped.duplicates.length,
      seenExcluded: candidatePreparation.seenFiltered.excluded.length,
      scored: ranked.length,
      selected: selectedPosts.length,
    },
    selectedPosts,
    usage: usageRecords,
    trace: createRunTrace({
      runId,
      createdAt: now.toISOString(),
      source,
      config: {
        selectedPostCount,
        scoringWeights: normalizeWeights(SCORING_WEIGHTS).map((weight) => ({
          key: weight.key,
          label: weight.label,
          weight: weight.weight,
        })),
        configuredModels,
        batches: {
          scoring: scoringBatchSize,
          translation: translationBatchSize,
        },
        promptVersions: {
          scoring: SCORING_PROMPT_VERSION,
          translation: TRANSLATION_PROMPT_VERSION,
        },
      },
      inputPosts: traceInputPosts,
      adDecisions: candidatePreparation.adDecisions,
      adExcluded: candidatePreparation.adFiltered.excluded,
      dedupe: candidatePreparation.deduped,
      seenExcluded: candidatePreparation.seenFiltered.excluded,
      ranked,
      selected: top,
      translations,
    }),
  };
}
