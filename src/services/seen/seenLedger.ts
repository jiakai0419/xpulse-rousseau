import type { RefreshRun, TimelinePost } from "../../domain/tweet.ts";
import { readPrivateJsonFile, updatePrivateJsonFile, writePrivateJsonFile } from "../storage/privateJsonFile.ts";

export type SeenPostRecord = {
  identity: string;
  postId: string;
  canonicalPostId: string;
  authorId: string;
  authorUsername: string;
  firstShownAt: string;
  lastShownAt: string;
  runIds: string[];
};

export type SeenPostRepository = {
  identities(): Promise<Set<string>>;
  markRunShown(run: RefreshRun): Promise<void>;
};

export type SeenPostRepositoryCheckpoint = {
  records: SeenPostRecord[];
};

export function seenIdentityForPost(post: TimelinePost): string {
  const canonicalPostId = post.referencedPostType === "retweeted" && post.referencedPostId ? post.referencedPostId : post.id;
  return `post:${canonicalPostId}`;
}

export function filterSeenPosts(posts: TimelinePost[], seenIdentities: Set<string>): {
  kept: TimelinePost[];
  excluded: Array<{ post: TimelinePost; identity: string }>;
} {
  const kept: TimelinePost[] = [];
  const excluded: Array<{ post: TimelinePost; identity: string }> = [];

  for (const post of posts) {
    const identity = seenIdentityForPost(post);

    if (seenIdentities.has(identity)) {
      excluded.push({ post, identity });
    } else {
      kept.push(post);
    }
  }

  return { kept, excluded };
}

export class FileSeenPostRepository implements SeenPostRepository {
  private readonly filePath: string;

  constructor(filePath = ".data/seen-posts.json") {
    this.filePath = filePath;
  }

  async identities(): Promise<Set<string>> {
    const store = await this.readStore();
    return new Set(store.records.map((record) => record.identity));
  }

  async markRunShown(run: RefreshRun): Promise<void> {
    await updatePrivateJsonFile(this.filePath, () => ({ records: [] }), (store: SeenPostRepositoryCheckpoint) => {
      const recordsByIdentity = new Map(
        store.records.map((record) => [record.identity, { ...record, runIds: [...record.runIds] }]),
      );

      for (const item of run.selectedPosts) {
        const post = item.post;
        const identity = seenIdentityForPost(post);
        const canonicalPostId = identity.replace(/^post:/, "");
        const current = recordsByIdentity.get(identity);

        if (current) {
          current.lastShownAt = run.createdAt;
          current.runIds = Array.from(new Set([run.id, ...current.runIds]));
        } else {
          recordsByIdentity.set(identity, {
            identity,
            postId: post.id,
            canonicalPostId,
            authorId: post.author.id,
            authorUsername: post.author.username,
            firstShownAt: run.createdAt,
            lastShownAt: run.createdAt,
            runIds: [run.id],
          });
        }
      }

      return { records: Array.from(recordsByIdentity.values()) };
    });
  }

  async checkpoint(): Promise<SeenPostRepositoryCheckpoint> {
    return this.readStore();
  }

  async restore(checkpoint: SeenPostRepositoryCheckpoint): Promise<void> {
    await writePrivateJsonFile(this.filePath, checkpoint);
  }

  private async readStore(): Promise<SeenPostRepositoryCheckpoint> {
    return readPrivateJsonFile(this.filePath, () => ({ records: [] }));
  }
}
