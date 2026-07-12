import { createHash } from "node:crypto";
import type { PostLinkPreview } from "../../domain/tweet.ts";
import { readPrivateJsonFile, updatePrivateJsonFile } from "../storage/privateJsonFile.ts";

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
    await updatePrivateJsonFile(this.filePath, () => ({ records: [] }), (store: LinkPreviewCacheStore) => {
      const records = [...store.records];
      const index = records.findIndex((item) => item.key === record.key);

      if (index === -1) {
        records.unshift(record);
      } else {
        records[index] = record;
      }

      return { records: records.slice(0, 5000) };
    });
  }

  private async readStore(): Promise<LinkPreviewCacheStore> {
    return readPrivateJsonFile(this.filePath, () => ({ records: [] }));
  }
}
