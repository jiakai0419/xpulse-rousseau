import type { FilterDecision, PostLink, PostMedia, PostTranslation, ReferencedPost, RunTrace, TimelinePost, TimelineSource, WeightedScore } from "../../domain/tweet.ts";
import type { DedupeResult } from "../filtering/dedupe.ts";

export type RankedPost = {
  post: TimelinePost;
  score: WeightedScore;
};

export type RunTraceConfig = RunTrace["config"];

function clonePostMedia(media: PostMedia): PostMedia {
  return {
    ...media,
    variants: media.variants?.map((variant) => ({ ...variant })),
  };
}

function clonePostLink(link: PostLink): PostLink {
  return {
    ...link,
    preview: link.preview
      ? {
          ...link.preview,
          images: link.preview.images?.map((image) => ({ ...image })),
        }
      : undefined,
  };
}

function cloneReferencedPost(post: ReferencedPost): ReferencedPost {
  return {
    ...post,
    author: { ...post.author },
    metrics: { ...post.metrics },
    links: post.links?.map(clonePostLink),
    media: post.media?.map(clonePostMedia),
    referencedPost: post.referencedPost ? cloneReferencedPost(post.referencedPost) : undefined,
  };
}

export function cloneTimelinePost(post: TimelinePost): TimelinePost {
  const clone: TimelinePost = {
    ...post,
    author: { ...post.author },
    metrics: { ...post.metrics },
    seenBy: [...post.seenBy],
  };

  if (post.links) {
    clone.links = post.links.map(clonePostLink);
  }

  if (post.media) {
    clone.media = post.media.map(clonePostMedia);
  }

  if (post.referencedPost) {
    clone.referencedPost = cloneReferencedPost(post.referencedPost);
  }

  return clone;
}

export function createRunTrace(options: {
  runId: string;
  createdAt: string;
  source: TimelineSource;
  config: RunTraceConfig;
  inputPosts: TimelinePost[];
  adDecisions: Map<string, FilterDecision>;
  adExcluded: Array<{ post: TimelinePost; decision: FilterDecision }>;
  dedupe: DedupeResult;
  seenExcluded?: Array<{ post: TimelinePost; identity: string }>;
  ranked: RankedPost[];
  selected: RankedPost[];
  translations: Map<string, PostTranslation>;
}): RunTrace {
  const fetchIndexById = new Map(options.inputPosts.map((post, index) => [post.id, index]));
  const adById = new Map(options.adExcluded.map((item) => [item.post.id, item.decision]));
  const duplicateById = new Map(options.dedupe.duplicates.map((duplicate) => [duplicate.duplicateId, duplicate]));
  const seenById = new Map((options.seenExcluded ?? []).map((item) => [item.post.id, item]));
  const rankedById = new Map(options.ranked.map((item, index) => [item.post.id, { rank: index + 1, score: item.score }]));
  const selectedById = new Map(options.selected.map((item, index) => [item.post.id, index + 1]));

  return {
    version: "run-trace-v1",
    runId: options.runId,
    createdAt: options.createdAt,
    source: options.source,
    pipelineVersion: "reader-refresh-v1",
    config: options.config,
    inputPosts: options.inputPosts.map((post, index) => ({
      post: cloneTimelinePost(post),
      fetchIndex: index,
    })),
    decisions: options.inputPosts.map((post, index) => {
      const adDecision = options.adDecisions.get(post.id) ?? adById.get(post.id);

      if (adDecision?.excluded) {
        return {
          postId: post.id,
          fetchIndex: index,
          state: "ad_excluded",
          adFilter: adDecision,
          duplicate: { excluded: false },
          selected: { selected: false },
          translation: { generated: false },
        };
      }

      const duplicate = duplicateById.get(post.id);

      if (duplicate) {
        return {
          postId: post.id,
          fetchIndex: index,
          state: "duplicate_excluded",
          adFilter: adDecision,
          duplicate: {
            excluded: true,
            keptId: duplicate.keptId,
            reason: duplicate.reason,
          },
          selected: { selected: false },
          translation: { generated: false },
        };
      }

      const seen = seenById.get(post.id);

      if (seen) {
        return {
          postId: post.id,
          fetchIndex: index,
          state: "seen_excluded",
          adFilter: adDecision ?? {
            excluded: false,
            signals: [],
          },
          duplicate: { excluded: false },
          selected: { selected: false },
          translation: { generated: false },
        };
      }

      const rank = rankedById.get(post.id);
      const selectedRank = selectedById.get(post.id);
      const translation = options.translations.get(post.id);

      return {
        postId: post.id,
        fetchIndex: fetchIndexById.get(post.id) ?? index,
        state: selectedRank ? "selected" : "scored_not_selected",
        adFilter: adDecision ?? {
          excluded: false,
          signals: [],
        },
        duplicate: { excluded: false },
        score: rank
          ? {
              rank: rank.rank,
              weightedScore: rank.score,
            }
          : undefined,
        selected: {
          selected: Boolean(selectedRank),
          rank: selectedRank,
        },
        translation: {
          generated: Boolean(translation),
          model: translation?.model,
          generatedAt: translation?.generatedAt,
        },
      };
    }),
  };
}
