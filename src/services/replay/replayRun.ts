import type { RefreshRun, RunTrace, RunTraceDecision, SelectedPost, TimelinePost } from "../../domain/tweet.ts";
import { cloneTimelinePost } from "../trace/runTrace.ts";

function cloneSelectedPost(selectedPost: SelectedPost): SelectedPost {
  return {
    ...selectedPost,
    post: cloneTimelinePost(selectedPost.post),
    score: {
      ...selectedPost.score,
      dimensions: selectedPost.score.dimensions.map((dimension) => ({ ...dimension })),
    },
    translation: selectedPost.translation ? { ...selectedPost.translation } : undefined,
  };
}

function cloneTrace(trace: RunTrace | undefined, runId: string, createdAt: string): RunTrace | undefined {
  if (!trace) {
    return undefined;
  }

  return {
    ...trace,
    runId,
    createdAt,
    source: "replay",
    config: {
      ...trace.config,
      scoringWeights: trace.config.scoringWeights.map((weight) => ({ ...weight })),
      configuredModels: { ...trace.config.configuredModels },
      batches: { ...trace.config.batches },
      promptVersions: { ...trace.config.promptVersions },
    },
    inputPosts: trace.inputPosts.map((item) => ({
      fetchIndex: item.fetchIndex,
      post: cloneTimelinePost(item.post),
    })),
    decisions: trace.decisions.map((decision) => ({
      ...decision,
      adFilter: decision.adFilter ? { ...decision.adFilter, signals: [...decision.adFilter.signals] } : undefined,
      duplicate: decision.duplicate ? { ...decision.duplicate } : undefined,
      score: decision.score
        ? {
            rank: decision.score.rank,
            weightedScore: {
              ...decision.score.weightedScore,
              dimensions: decision.score.weightedScore.dimensions.map((dimension) => ({ ...dimension })),
            },
          }
        : undefined,
      selected: decision.selected ? { ...decision.selected } : undefined,
      translation: decision.translation ? { ...decision.translation } : undefined,
    })),
  };
}

function selectedPostsFromTrace(run: RefreshRun): SelectedPost[] | undefined {
  if (!run.trace) {
    return undefined;
  }

  const postsById = new Map<string, TimelinePost>(run.trace.inputPosts.map((item) => [item.post.id, item.post]));
  const storedSelectedById = new Map(run.selectedPosts.map((item) => [item.post.id, item]));
  const decisions = run.trace.decisions
    .filter((decision): decision is RunTraceDecision & { selected: { selected: true; rank?: number }; score: NonNullable<RunTraceDecision["score"]> } => Boolean(decision.selected?.selected && decision.score))
    .sort((left, right) => (left.selected.rank ?? left.score.rank) - (right.selected.rank ?? right.score.rank));

  const selectedPosts = decisions.flatMap((decision) => {
    const post = postsById.get(decision.postId);

    if (!post) {
      return [];
    }

    const stored = storedSelectedById.get(decision.postId);

    return [
      {
        post: cloneTimelinePost(post),
        score: {
          ...decision.score.weightedScore,
          dimensions: decision.score.weightedScore.dimensions.map((dimension) => ({ ...dimension })),
        },
        translation: stored?.translation ? { ...stored.translation } : undefined,
      },
    ];
  });

  return selectedPosts.length ? selectedPosts : undefined;
}

function statsFromTrace(trace: RunTrace | undefined, selectedCount: number): RefreshRun["stats"] | undefined {
  if (!trace) {
    return undefined;
  }

  const scored = trace.decisions.filter((decision) => decision.state === "selected" || decision.state === "scored_not_selected").length;

  return {
    fetched: trace.inputPosts.length,
    adsExcluded: trace.decisions.filter((decision) => decision.state === "ad_excluded").length,
    duplicatesExcluded: trace.decisions.filter((decision) => decision.state === "duplicate_excluded").length,
    seenExcluded: trace.decisions.filter((decision) => decision.state === "seen_excluded").length,
    scored,
    selected: selectedCount,
  };
}

export function createReplayRun(sourceRun: RefreshRun, now = new Date()): RefreshRun {
  const createdAt = now.toISOString();
  const replayId = `replay_${now.getTime()}`;
  const selectedPosts = selectedPostsFromTrace(sourceRun) ?? sourceRun.selectedPosts.map(cloneSelectedPost);

  return {
    id: replayId,
    createdAt,
    source: "replay",
    replayOf: {
      runId: sourceRun.id,
      createdAt: sourceRun.createdAt,
      source: sourceRun.source,
    },
    stats: statsFromTrace(sourceRun.trace, selectedPosts.length) ?? {
      ...sourceRun.stats,
      selected: selectedPosts.length,
    },
    selectedPosts,
    usage: [],
    trace: cloneTrace(sourceRun.trace, replayId, createdAt),
  };
}
