import type { ConfiguredOpenAIModels } from "../../config/openai.ts";
import { normalizeWeights, SCORING_WEIGHTS } from "../../config/scoring.ts";
import type { PostLink, PostTranslation, ReferencedPost, RefreshRun, SelectedPost, TimelinePost, TimelineSource, UsageRecord } from "../../domain/tweet.ts";
import { TRANSLATION_PROMPT_VERSION } from "../ai/translation.ts";
import { SCORING_PROMPT_VERSION } from "../scoring/openAIScoring.ts";
import type { RankedPost } from "../selection/authorDiversity.ts";
import { cloneTimelinePost, createRunTrace } from "../trace/runTrace.ts";
import type { CandidatePreparation } from "./candidates.ts";

export type AssembleRefreshRunOptions = {
  runId: string;
  createdAt: string;
  source: TimelineSource;
  fetchedPostCount: number;
  candidatePreparation: CandidatePreparation;
  ranked: RankedPost[];
  selected: RankedPost[];
  selectedPosts: SelectedPost[];
  translations: Map<string, PostTranslation>;
  usage: UsageRecord[];
  selectedPostCount: number;
  configuredModels: ConfiguredOpenAIModels;
  batches: {
    scoring: number;
    translation: number;
  };
};

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

function traceInputPostsWithSelectedEvidence(candidatePreparation: CandidatePreparation, selectedPosts: SelectedPost[]): TimelinePost[] {
  const selectedPostById = new Map(selectedPosts.map((item) => [item.post.id, item.post]));

  return candidatePreparation.inputPosts.map((post) => {
    const selectedPost = selectedPostById.get(post.id);
    const tracePost = cloneTimelinePost(post);

    if (selectedPost) {
      copyLinkPreviewEvidence(tracePost, selectedPost);
    }

    return tracePost;
  });
}

export function assembleRefreshRun(options: AssembleRefreshRunOptions): RefreshRun {
  const traceInputPosts = traceInputPostsWithSelectedEvidence(options.candidatePreparation, options.selectedPosts);

  return {
    id: options.runId,
    createdAt: options.createdAt,
    source: options.source,
    stats: {
      fetched: options.fetchedPostCount,
      adsExcluded: options.candidatePreparation.adFiltered.excluded.length,
      duplicatesExcluded: options.candidatePreparation.deduped.duplicates.length,
      seenExcluded: options.candidatePreparation.seenFiltered.excluded.length,
      scored: options.ranked.length,
      selected: options.selectedPosts.length,
    },
    selectedPosts: options.selectedPosts,
    usage: options.usage,
    trace: createRunTrace({
      runId: options.runId,
      createdAt: options.createdAt,
      source: options.source,
      config: {
        selectedPostCount: options.selectedPostCount,
        scoringWeights: normalizeWeights(SCORING_WEIGHTS).map((weight) => ({
          key: weight.key,
          label: weight.label,
          weight: weight.weight,
        })),
        configuredModels: options.configuredModels,
        batches: options.batches,
        promptVersions: {
          scoring: SCORING_PROMPT_VERSION,
          translation: TRANSLATION_PROMPT_VERSION,
        },
      },
      inputPosts: traceInputPosts,
      adDecisions: options.candidatePreparation.adDecisions,
      adExcluded: options.candidatePreparation.adFiltered.excluded,
      dedupe: options.candidatePreparation.deduped,
      seenExcluded: options.candidatePreparation.seenFiltered.excluded,
      ranked: options.ranked,
      selected: options.selected,
      translations: options.translations,
    }),
  };
}
