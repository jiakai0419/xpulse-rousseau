import type { RefreshProgress, RefreshRun, TimelinePost, UsageRecord } from "../../domain/tweet.ts";
import { configuredOpenAIModels } from "../../config/openai.ts";
import { selectedPostCountFromEnv } from "../../config/selection.ts";
import { DEFAULT_X_REQUEST_TIMEOUT_MS } from "../http/fetchWithTimeout.ts";
import type { LinkPreviewCacheRepository } from "../linkPreview/cache.ts";
import type { OpenAICacheRepository } from "../openai/cache.ts";
import type { SeenPostRepository } from "../seen/seenLedger.ts";
import { fetchHomeTimeline } from "../x/client.ts";
import type { XRawSnapshotRepository, XRawTimelineSnapshot } from "../x/rawSnapshotStore.ts";
import { resolveFreshXCredentials } from "../x/sourceCredentials.ts";
import type { TimelineCursorRepository } from "../x/timelineCursor.ts";
import type { XTokenStore } from "../x/tokenStore.ts";
import { prepareCandidatePosts } from "./candidates.ts";
import { finalizeSelectedPosts } from "./finalization.ts";
import { createRefreshProgressReporter } from "./progress.ts";
import { assembleRefreshRun } from "./runAssembly.ts";
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
    requestTimeoutMs: positiveIntegerFromEnv(env, "X_REQUEST_TIMEOUT_MS", DEFAULT_X_REQUEST_TIMEOUT_MS),
    sinceId: cursor?.latestPostId,
    onRawSnapshot: (snapshot: XRawTimelineSnapshot) => options.xRawSnapshotRepository?.save(snapshot),
    onUsage: options.onUsage,
  };

  const credentials = await resolveFreshXCredentials(env, options.xTokenStore, options.now);

  if (!credentials) {
    throw new Error("X credentials are required for live refresh. Connect X or set X_USER_ID and X_USER_ACCESS_TOKEN.");
  }

  return {
    source: "x",
    posts: await fetchHomeTimeline({
      userId: credentials.userId,
      accessToken: credentials.accessToken,
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
  const progressReporter = createRefreshProgressReporter({
    onProgress: options.onProgress,
    onUsage: options.onUsage,
  });
  const { publishProgress, recordUsage } = progressReporter;

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
  const { selectedPosts, translations } = await finalizeSelectedPosts(top, {
    apiKey,
    model: translationModel,
    batchSize: translationBatchSize,
    cache: options.openAICache,
    linkPreviewCache: options.linkPreviewCache,
    now,
    onProgress: publishProgress,
    onUsage: recordUsage,
  });

  publishProgress({
    stage: "saving",
    label: "Saving results",
    detail: `Saving ${selectedPosts.length} selected posts and usage records`,
    processedItems: selectedPosts.length,
    totalItems: selectedPosts.length,
  });

  return assembleRefreshRun({
    runId,
    createdAt: now.toISOString(),
    source,
    fetchedPostCount: posts.length,
    candidatePreparation,
    ranked,
    selected: top,
    selectedPosts,
    usage: progressReporter.usageRecords(),
    translations,
    selectedPostCount,
    configuredModels,
    batches: {
      scoring: scoringBatchSize,
      translation: translationBatchSize,
    },
  });
}
