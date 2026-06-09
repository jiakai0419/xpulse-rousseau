import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type XRawTimelineSnapshot = {
  id: string;
  createdAt: string;
  endpoint: string;
  query: Record<string, string>;
  page: number;
  mode: "newer" | "baseline" | "lookup";
  status: number;
  rateLimit?: {
    limit?: number;
    remaining?: number;
    resetAt?: string;
  };
  payload: unknown;
};

export type XRawSnapshotRepository = {
  save(snapshot: XRawTimelineSnapshot): Promise<void>;
};

type XRawSnapshotStore = {
  snapshots: XRawTimelineSnapshot[];
};

export class FileXRawSnapshotRepository implements XRawSnapshotRepository {
  private readonly filePath: string;

  constructor(filePath = ".data/x-snapshots.json") {
    this.filePath = filePath;
  }

  async save(snapshot: XRawTimelineSnapshot): Promise<void> {
    const store = await this.readStore();
    store.snapshots.unshift(snapshot);
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, JSON.stringify({ snapshots: store.snapshots.slice(0, 50) }, null, 2), "utf8");
  }

  private async readStore(): Promise<XRawSnapshotStore> {
    try {
      const raw = await readFile(this.filePath, "utf8");
      return JSON.parse(raw) as XRawSnapshotStore;
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
        return { snapshots: [] };
      }

      throw error;
    }
  }
}
