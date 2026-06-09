import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RefreshRun, TimelinePost } from "../../domain/tweet.ts";

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
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw) as TimelineCursor;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return {};
      }

      throw error;
    }
  }

  async updateFromRun(run: RefreshRun): Promise<void> {
    const latestPostId = newestPostId(run.trace?.inputPosts.map((item) => item.post) ?? run.selectedPosts.map((item) => item.post));

    if (!latestPostId) {
      return;
    }

    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify({
      latestPostId,
      updatedAt: run.createdAt,
      runId: run.id,
    }, null, 2), "utf8");
  }
}
