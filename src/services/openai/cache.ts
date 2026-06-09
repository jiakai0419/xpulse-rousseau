import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ReferencedPost, TimelinePost, UsageOperation } from "../../domain/tweet.ts";

export type OpenAICacheOperation = Extract<UsageOperation, "scoring" | "translation">;

export type OpenAICacheRecord<T = unknown> = {
  key: string;
  operation: OpenAICacheOperation;
  postId: string;
  model: string;
  promptVersion: string;
  contentFingerprint: string;
  output: T;
  createdAt: string;
};

export type OpenAICacheRepository = {
  get<T>(key: string): Promise<OpenAICacheRecord<T> | undefined>;
  set<T>(record: OpenAICacheRecord<T>): Promise<void>;
};

type OpenAICacheStore = {
  records: OpenAICacheRecord[];
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableReferencedPostInput(post: ReferencedPost): unknown {
  return {
    id: post.id,
    text: post.text,
    author: {
      id: post.author.id,
      name: post.author.name,
      username: post.author.username,
    },
    createdAt: post.createdAt,
    language: post.language,
    links: (post.links ?? []).map((link) => ({
      url: link.url,
      expandedUrl: link.expandedUrl,
      displayUrl: link.displayUrl,
      unwoundUrl: link.unwoundUrl,
      mediaKey: link.mediaKey,
    })),
    referencedPostId: post.referencedPostId,
    referencedPostType: post.referencedPostType,
    referencedPost: post.referencedPost ? stableReferencedPostInput(post.referencedPost) : undefined,
  };
}

function stablePostInput(post: TimelinePost): unknown {
  return {
    id: post.id,
    text: post.text,
    author: {
      id: post.author.id,
      name: post.author.name,
      username: post.author.username,
    },
    createdAt: post.createdAt,
    language: post.language,
    links: (post.links ?? []).map((link) => ({
      url: link.url,
      expandedUrl: link.expandedUrl,
      displayUrl: link.displayUrl,
      unwoundUrl: link.unwoundUrl,
      mediaKey: link.mediaKey,
    })),
    referencedPostId: post.referencedPostId,
    referencedPostType: post.referencedPostType,
    referencedPost: post.referencedPost ? stableReferencedPostInput(post.referencedPost) : undefined,
  };
}

export function contentFingerprint(post: TimelinePost): string {
  return sha256(JSON.stringify(stablePostInput(post)));
}

export function openAICacheKey(options: {
  operation: OpenAICacheOperation;
  model: string;
  promptVersion: string;
  post: TimelinePost;
}): { key: string; contentFingerprint: string } {
  const fingerprint = contentFingerprint(options.post);
  const key = sha256(JSON.stringify({
    operation: options.operation,
    model: options.model,
    promptVersion: options.promptVersion,
    contentFingerprint: fingerprint,
  }));

  return {
    key: `openai:${options.operation}:${key}`,
    contentFingerprint: fingerprint,
  };
}

export class FileOpenAICacheRepository implements OpenAICacheRepository {
  private readonly filePath: string;

  constructor(filePath = ".data/openai-cache.json") {
    this.filePath = filePath;
  }

  async get<T>(key: string): Promise<OpenAICacheRecord<T> | undefined> {
    const store = await this.readStore();
    return store.records.find((record) => record.key === key) as OpenAICacheRecord<T> | undefined;
  }

  async set<T>(record: OpenAICacheRecord<T>): Promise<void> {
    const store = await this.readStore();
    const index = store.records.findIndex((item) => item.key === record.key);

    if (index === -1) {
      store.records.unshift(record);
    } else {
      store.records[index] = record;
    }

    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify({ records: store.records.slice(0, 5000) }, null, 2), "utf8");
  }

  private async readStore(): Promise<OpenAICacheStore> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw) as OpenAICacheStore;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return { records: [] };
      }

      throw error;
    }
  }
}
