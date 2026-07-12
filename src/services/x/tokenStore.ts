import type { Author } from "../../domain/tweet.ts";
import { readPrivateJsonFile, removePrivateJsonFile, writePrivateJsonFile } from "../storage/privateJsonFile.ts";

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
    return readPrivateJsonFile<XStoredTokens | undefined>(this.filePath, () => undefined);
  }

  async save(tokens: XStoredTokens): Promise<void> {
    await writePrivateJsonFile(this.filePath, tokens);
  }

  async clear(): Promise<void> {
    await removePrivateJsonFile(this.filePath);
  }
}
