export type TimelineSource = "replay" | "x";

export type ReferencedPostType = "retweeted" | "quoted" | "replied_to";

export type Author = {
  id: string;
  name: string;
  username: string;
  profileImageUrl?: string;
};

export type PostMetrics = {
  replies?: number;
  reposts?: number;
  likes?: number;
  quotes?: number;
  impressions?: number;
};

export type PostLinkPreviewImage = {
  url: string;
  width?: number;
  height?: number;
};

export type PostLinkPreview = {
  title?: string;
  description?: string;
  images?: PostLinkPreviewImage[];
};

export type PostLink = {
  url: string;
  expandedUrl?: string;
  displayUrl?: string;
  unwoundUrl?: string;
  mediaKey?: string;
  preview?: PostLinkPreview;
};

export type PostMediaVariant = {
  bitRate?: number;
  contentType?: string;
  url: string;
};

export type PostMedia = {
  mediaKey: string;
  type: "photo" | "video" | "animated_gif";
  url?: string;
  previewImageUrl?: string;
  durationMs?: number;
  width?: number;
  height?: number;
  altText?: string;
  variants?: PostMediaVariant[];
};

export type ReferencedPost = {
  id: string;
  text: string;
  author: Author;
  createdAt: string;
  url: string;
  metrics: PostMetrics;
  links?: PostLink[];
  media?: PostMedia[];
  language?: string;
  referencedPostId?: string;
  referencedPostType?: ReferencedPostType;
  referencedPost?: ReferencedPost;
};

export type TimelinePost = {
  id: string;
  text: string;
  author: Author;
  createdAt: string;
  url: string;
  metrics: PostMetrics;
  links?: PostLink[];
  media?: PostMedia[];
  language?: string;
  referencedPostId?: string;
  referencedPostType?: ReferencedPostType;
  referencedPost?: ReferencedPost;
  seenBy: string[];
};

export type FilterDecision = {
  excluded: boolean;
  reason?: string;
  signals: string[];
};

export type ScoreDimensionKey = "immediateValue" | "informationDensity" | "engagementSignal";

export type ScoreDimension = {
  key: ScoreDimensionKey;
  label: string;
  weight: number;
  score: number;
  reason: string;
};

export type WeightedScore = {
  total: number;
  dimensions: ScoreDimension[];
  model?: string;
  generatedAt?: string;
};

export type PostTranslation = {
  textZh: string;
  model: string;
  generatedAt: string;
};

export type UsageProvider = "openai" | "x";
export type UsageOperation = "scoring" | "translation" | "x.timeline" | "x.lookup" | "x.me";

export type UsageRecord = {
  provider: UsageProvider;
  operation: UsageOperation;
  label: string;
  model?: string;
  method?: string;
  endpoint?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  itemCount: number;
  itemIds: string[];
  requestCount?: number;
  rateLimit?: {
    limit?: number;
    remaining?: number;
    resetAt?: string;
  };
  createdAt: string;
};

export type UsageReceiptScope = "refresh";

export type UsageTotals = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  reasoningTokens: number;
  openAIRequests: number;
  xRequests: number;
  itemCount: number;
};

export type UsageReceipt = {
  scope: UsageReceiptScope;
  title: string;
  createdAt: string;
  target?: {
    runId?: string;
    postId?: string;
  };
  totals: UsageTotals;
  lines: UsageRecord[];
};

export type RunTracePostSnapshot = {
  post: TimelinePost;
  fetchIndex: number;
};

export type RunTraceDecisionState = "selected" | "scored_not_selected" | "ad_excluded" | "duplicate_excluded" | "seen_excluded";

export type RunTraceDecision = {
  postId: string;
  fetchIndex: number;
  state: RunTraceDecisionState;
  adFilter?: FilterDecision;
  duplicate?: {
    excluded: boolean;
    keptId?: string;
    reason?: "retweet" | "exact_text";
  };
  score?: {
    rank: number;
    weightedScore: WeightedScore;
  };
  selected?: {
    selected: boolean;
    rank?: number;
  };
  translation?: {
    generated: boolean;
    model?: string;
    generatedAt?: string;
  };
};

export type RunTrace = {
  version: "run-trace-v1";
  runId: string;
  createdAt: string;
  source: TimelineSource;
  pipelineVersion: "reader-refresh-v1";
  config: {
    selectedPostCount: number;
    scoringWeights: Array<Pick<ScoreDimension, "key" | "label" | "weight">>;
    configuredModels: {
      scoring: string;
      translation: string;
    };
    batches: {
      scoring: number;
      translation: number;
    };
    promptVersions: {
      scoring: "scoring-v1" | "scoring-v2";
      translation: "translation-v1" | "translation-v2";
    };
  };
  inputPosts: RunTracePostSnapshot[];
  decisions: RunTraceDecision[];
};

export type RefreshProgressStage = "starting" | "loading" | "filtering" | "scoring" | "translating" | "saving" | "completed" | "failed";

export type RefreshProgress = {
  stage: RefreshProgressStage;
  label: string;
  detail: string;
  processedItems?: number;
  totalItems?: number;
  model?: string;
  usage: UsageRecord[];
  updatedAt: string;
};

export type SelectedPost = {
  post: TimelinePost;
  score: WeightedScore;
  translation?: PostTranslation;
};

export type RefreshRun = {
  id: string;
  createdAt: string;
  source: TimelineSource;
  replayOf?: {
    runId: string;
    createdAt: string;
    source: TimelineSource;
  };
  stats: {
    fetched: number;
    adsExcluded: number;
    duplicatesExcluded: number;
    seenExcluded?: number;
    scored: number;
    selected: number;
  };
  selectedPosts: SelectedPost[];
  usage: UsageRecord[];
  usageReceipt?: UsageReceipt;
  trace?: RunTrace;
};
