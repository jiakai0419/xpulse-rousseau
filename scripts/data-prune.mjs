import { existsSync, lstatSync, readdirSync, rmSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { planGeneratedEvidencePrune } from "./data-prune-core.mjs";

const root = resolve(process.env.DATA_ROOT || ".data");
const apply = process.argv.includes("--apply");
const verbose = process.argv.includes("--verbose");
const confirmation = process.argv.find((argument) => argument.startsWith("--confirm="))?.slice("--confirm=".length);
const keepArgument = process.argv.find((argument) => argument.startsWith("--keep="))?.slice("--keep=".length);
const keep = keepArgument === undefined ? 5 : Number(keepArgument);

if (!Number.isInteger(keep) || keep < 1) {
  throw new Error("--keep must be an integer of at least 1.");
}

function directoryBytes(directory) {
  let total = 0;

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      total += directoryBytes(path);
    } else if (entry.isFile()) {
      total += lstatSync(path).size;
    }
  }

  return total;
}

function discoverCandidates() {
  const entries = [];

  if (!existsSync(root)) {
    return entries;
  }

  for (const rootEntry of readdirSync(root, { withFileTypes: true })) {
    if (!rootEntry.isDirectory()) {
      continue;
    }

    const familyRoot = join(root, rootEntry.name);
    for (const child of readdirSync(familyRoot, { withFileTypes: true })) {
      if (!child.isDirectory() && !child.isFile()) {
        continue;
      }

      const path = join(familyRoot, child.name);
      entries.push({
        path,
        relativePath: relative(root, path),
        bytes: child.isDirectory() ? directoryBytes(path) : lstatSync(path).size,
      });
    }
  }

  return entries;
}

function formatBytes(bytes) {
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unit = units[0];

  for (let index = 1; index < units.length && value >= 1024; index += 1) {
    value /= 1024;
    unit = units[index];
  }

  return `${value.toFixed(value >= 10 || unit === "B" ? 0 : 1)} ${unit}`;
}

const plan = planGeneratedEvidencePrune(discoverCandidates(), { keep });

console.log(`${apply ? "APPLY" : "DRY RUN"}: keep the newest ${plan.keep} timestamped reports in each known generated-evidence family.`);
console.log(`Eligible for removal: ${plan.remove.length} generated paths (${formatBytes(plan.removableBytes)}).`);

const displayedEntries = verbose ? plan.remove : plan.remove.slice(0, 40);
for (const entry of displayedEntries) {
  console.log(`  ${apply ? "remove" : "would remove"} ${entry.relativePath} (${formatBytes(entry.bytes)})`);
}

if (displayedEntries.length < plan.remove.length) {
  console.log(`  ... ${plan.remove.length - displayedEntries.length} more; rerun with --verbose to inspect every path.`);
}

if (!plan.remove.length) {
  console.log("Nothing to prune. Product state, canonical baselines, durable Original screenshots, and unknown paths were untouched.");
  process.exit(0);
}

if (!apply) {
  console.log("No files changed. Review the list, then rerun with --apply --confirm=prune-generated-evidence.");
  process.exit(0);
}

if (confirmation !== "prune-generated-evidence") {
  throw new Error("Refusing to delete without --confirm=prune-generated-evidence.");
}

for (const entry of plan.remove) {
  const resolvedPath = resolve(entry.path);
  if (!resolvedPath.startsWith(`${root}${sep}`) || resolvedPath === root) {
    throw new Error(`Refusing to remove a path outside the data root: ${resolvedPath}`);
  }

  rmSync(resolvedPath, { recursive: true, force: false });
}

console.log(`Removed ${plan.remove.length} generated report paths (${formatBytes(plan.removableBytes)} planned).`);
