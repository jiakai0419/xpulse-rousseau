import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { PostLinkPreview } from "../../domain/tweet.ts";

export type LinkPreviewCacheRecord = {
  key: string;
  targetUrl: string;
  finalUrl?: string;
  preview?: PostLinkPreview;
  status: "resolved" | "unavailable";
  createdAt: string;
};

export type LinkPreviewCacheRepository = {
  get(key: string): Promise<LinkPreviewCacheRecord | undefined>;
  set(record: LinkPreviewCacheRecord): Promise<void>;
};

type LinkPreviewCacheStore = {
  records: LinkPreviewCacheRecord[];
};

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function normalizedPreviewTargetUrl(rawUrl: string): string | undefined {
  try {
    const url = new URL(rawUrl);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return undefined;
    }

    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

export function linkPreviewCacheKey(rawUrl: string): string | undefined {
  const targetUrl = normalizedPreviewTargetUrl(rawUrl);

  if (!targetUrl) {
    return undefined;
  }

  return `link-preview:${sha256(targetUrl)}`;
}

export class FileLinkPreviewCacheRepository implements LinkPreviewCacheRepository {
  private readonly filePath: string;

  constructor(filePath = ".data/link-preview-cache.json") {
    this.filePath = filePath;
  }

  async get(key: string): Promise<LinkPreviewCacheRecord | undefined> {
    const store = await this.readStore();
    return store.records.find((record) => record.key === key);
  }

  async set(record: LinkPreviewCacheRecord): Promise<void> {
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

  private async readStore(): Promise<LinkPreviewCacheStore> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw) as LinkPreviewCacheStore;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return { records: [] };
      }

      throw error;
    }
  }
}
