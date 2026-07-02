import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";
import { arrayValue, evidencePostId } from "./display-evidence-core.mjs";

export const defaultOriginalEvidenceRoot = ".data/display-original-evidence";
export const defaultOriginalScreenshotAssetDir = ".data/display-original-evidence/original-screenshots";

function safePathPart(value) {
  return String(value ?? "unknown")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "unknown";
}

function pathInside(filePath, root) {
  const relativePath = relative(resolve(root), resolve(filePath));
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function walkFiles(root, predicate) {
  if (!existsSync(root)) {
    return [];
  }

  const files = [];
  const stack = [root];
  while (stack.length) {
    const directory = stack.pop();
    for (const name of readdirSync(directory)) {
      const filePath = join(directory, name);
      const stat = statSync(filePath);
      if (stat.isDirectory()) {
        stack.push(filePath);
      } else if (!predicate || predicate(filePath)) {
        files.push(filePath);
      }
    }
  }

  return files.sort();
}

export function stableOriginalScreenshotFileName(entry) {
  const postId = safePathPart(evidencePostId(entry));
  const currentName = safePathPart(basename(String(entry?.screenshot ?? "")));
  const extension = extname(currentName).toLowerCase() || ".png";

  if (currentName.includes(postId) && extension === ".png") {
    return currentName;
  }

  return `${postId}-original.png`;
}

export function findDurableOriginalScreenshots(postId, evidenceRoot = defaultOriginalEvidenceRoot) {
  const id = String(postId ?? "");
  if (!id) {
    return [];
  }

  return walkFiles(evidenceRoot, (filePath) => {
    const name = basename(filePath);
    return name.endsWith("-original.png") && name.includes(id);
  });
}

export function normalizeOriginalEvidenceScreenshotAssets(
  entries,
  {
    evidenceRoot = defaultOriginalEvidenceRoot,
    screenshotAssetDir = defaultOriginalScreenshotAssetDir,
    updatedAt = new Date().toISOString(),
  } = {},
) {
  mkdirSync(screenshotAssetDir, { recursive: true });
  const normalized = [];
  const report = {
    persistedExternalScreenshots: 0,
    repairedMissingScreenshots: 0,
    unresolvedMissingScreenshots: 0,
    ambiguousMissingScreenshots: 0,
  };

  for (const entry of arrayValue(entries)) {
    const screenshot = String(entry?.screenshot ?? "");

    if (screenshot && existsSync(screenshot)) {
      if (pathInside(screenshot, evidenceRoot)) {
        normalized.push(entry);
        continue;
      }

      const durablePath = join(screenshotAssetDir, stableOriginalScreenshotFileName(entry));
      copyFileSync(screenshot, durablePath);
      normalized.push({
        ...entry,
        screenshot: durablePath,
        screenshotPersistedAt: updatedAt,
        screenshotOriginalPath: screenshot,
      });
      report.persistedExternalScreenshots += 1;
      continue;
    }

    const postId = evidencePostId(entry);
    const candidates = findDurableOriginalScreenshots(postId, evidenceRoot);
    if (candidates.length === 1) {
      normalized.push({
        ...entry,
        screenshot: candidates[0],
        screenshotRepairedAt: updatedAt,
        screenshotOriginalPath: screenshot || entry?.screenshotOriginalPath,
      });
      report.repairedMissingScreenshots += 1;
      continue;
    }

    normalized.push(entry);
    if (candidates.length > 1) {
      report.ambiguousMissingScreenshots += 1;
    } else {
      report.unresolvedMissingScreenshots += 1;
    }
  }

  return {
    entries: normalized,
    report,
  };
}
