import type { FilterDecision, TimelinePost } from "../../domain/tweet.ts";
import { decideAdFilter, filterAds } from "../filtering/adFilter.ts";
import { dedupeTimelinePosts, type DedupeResult } from "../filtering/dedupe.ts";
import { filterSeenPosts, type SeenPostRepository } from "../seen/seenLedger.ts";
import { cloneTimelinePost } from "../trace/runTrace.ts";

type AdFilterResult = ReturnType<typeof filterAds>;
type SeenFilterResult = ReturnType<typeof filterSeenPosts>;

export type CandidatePreparation = {
  inputPosts: TimelinePost[];
  adDecisions: Map<string, FilterDecision>;
  adFiltered: AdFilterResult;
  deduped: DedupeResult;
  seenFiltered: SeenFilterResult;
  candidates: TimelinePost[];
};

export async function prepareCandidatePosts(posts: TimelinePost[], seenRepository?: SeenPostRepository): Promise<CandidatePreparation> {
  const inputPosts = posts.map(cloneTimelinePost);
  const adDecisions = new Map(inputPosts.map((post) => [post.id, decideAdFilter(post)]));
  const adFiltered = filterAds(posts);
  const deduped = dedupeTimelinePosts(adFiltered.kept);
  const seenIdentities = await seenRepository?.identities();
  const seenFiltered = seenIdentities ? filterSeenPosts(deduped.posts, seenIdentities) : { kept: deduped.posts, excluded: [] };

  return {
    inputPosts,
    adDecisions,
    adFiltered,
    deduped,
    seenFiltered,
    candidates: seenFiltered.kept,
  };
}
