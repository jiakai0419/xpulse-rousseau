import { readFileSync } from "node:fs";

export function selectHistoricalDisplayInventoryRuns(runs = [], maxRuns = 20) {
  return runs
    .filter((run) => run.source === "x" && run.trace?.inputPosts?.length)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, maxRuns);
}

export function loadHistoricalDisplayInventoryRuns(filePath, maxRuns = 20) {
  try {
    const store = JSON.parse(readFileSync(filePath, "utf8"));
    return selectHistoricalDisplayInventoryRuns(store.runs ?? [], maxRuns);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}
