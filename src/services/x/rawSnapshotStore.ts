import { updatePrivateJsonFile } from "../storage/privateJsonFile.ts";

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
    await updatePrivateJsonFile(this.filePath, () => ({ snapshots: [] }), (store: XRawSnapshotStore) => ({
      snapshots: [snapshot, ...store.snapshots].slice(0, 50),
    }));
  }
}
