import type { RefreshRun, TimelinePost } from "../../domain/tweet.ts";
import { readPrivateJsonFile, writePrivateJsonFile } from "../storage/privateJsonFile.ts";

export type TimelineCursor = {
  latestPostId?: string;
  updatedAt?: string;
  runId?: string;
};

export type TimelineCursorRepository = {
  get(): Promise<TimelineCursor>;
  updateFromRun(run: RefreshRun): Promise<void>;
};

export function newestPostId(posts: TimelinePost[]): string | undefined {
  return posts
    .map((post) => post.id)
    .filter(Boolean)
    .sort((left, right) => {
      try {
        const leftId = BigInt(left);
        const rightId = BigInt(right);
        return rightId > leftId ? 1 : rightId < leftId ? -1 : 0;
      } catch {
        const byLength = right.length - left.length;
        return byLength === 0 ? right.localeCompare(left) : byLength;
      }
    })[0];
}

export class FileTimelineCursorRepository implements TimelineCursorRepository {
  private readonly filePath: string;

  constructor(filePath = ".data/timeline-cursor.json") {
    this.filePath = filePath;
  }

  async get(): Promise<TimelineCursor> {
    return readPrivateJsonFile(this.filePath, () => ({}));
  }

  async updateFromRun(run: RefreshRun): Promise<void> {
    const latestPostId = newestPostId(run.trace?.inputPosts.map((item) => item.post) ?? run.selectedPosts.map((item) => item.post));

    if (!latestPostId) {
      return;
    }

    await writePrivateJsonFile(this.filePath, {
      latestPostId,
      updatedAt: run.createdAt,
      runId: run.id,
    });
  }

  async checkpoint(): Promise<TimelineCursor> {
    return this.get();
  }

  async restore(checkpoint: TimelineCursor): Promise<void> {
    await writePrivateJsonFile(this.filePath, checkpoint);
  }
}
