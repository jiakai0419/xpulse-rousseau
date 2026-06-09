import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Author } from "../../domain/tweet.ts";

export type XStoredTokens = {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  scope?: string;
  expiresAt?: string;
  savedAt: string;
  user?: Author;
};

export type XTokenStore = {
  get(): Promise<XStoredTokens | undefined>;
  save(tokens: XStoredTokens): Promise<void>;
  clear(): Promise<void>;
};

export class FileXTokenStore implements XTokenStore {
  private readonly filePath: string;

  constructor(filePath = ".data/x-oauth.json") {
    this.filePath = filePath;
  }

  async get(): Promise<XStoredTokens | undefined> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw) as XStoredTokens;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return undefined;
      }

      throw error;
    }
  }

  async save(tokens: XStoredTokens): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify(tokens, null, 2), "utf8");
  }

  async clear(): Promise<void> {
    await rm(this.filePath, { force: true });
  }
}
