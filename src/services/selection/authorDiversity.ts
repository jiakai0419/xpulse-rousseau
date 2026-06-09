import type { TimelinePost, WeightedScore } from "../../domain/tweet.ts";
import { readerAuthorKey } from "../../domain/postDisplay.ts";

export type RankedPost = {
  post: TimelinePost;
  score: WeightedScore;
};

export type AuthorDiversityResult = {
  selected: RankedPost[];
  skipped: Array<{
    item: RankedPost;
    keptPostId: string;
    authorKey: string;
  }>;
};

export function selectTopByAuthorDiversity(ranked: RankedPost[], limit: number): AuthorDiversityResult {
  const selected: RankedPost[] = [];
  const skipped: AuthorDiversityResult["skipped"] = [];
  const keptByAuthor = new Map<string, RankedPost>();

  for (const item of ranked) {
    if (selected.length >= limit) {
      break;
    }

    const key = readerAuthorKey(item.post);
    const kept = keptByAuthor.get(key);

    if (kept) {
      skipped.push({
        item,
        keptPostId: kept.post.id,
        authorKey: key,
      });
      continue;
    }

    keptByAuthor.set(key, item);
    selected.push(item);
  }

  return { selected, skipped };
}
