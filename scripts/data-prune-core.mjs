const GENERATED_FAMILIES = [
  { root: "data-inventory", prefix: "data-inventory-" },
  { root: "display-oracle", prefix: "display-oracle-" },
  { root: "display-visual-review", prefix: "visual-review-" },
  { root: "render-coverage", prefix: "render-coverage-" },
  { root: "render-regression", prefix: "replay-display-" },
  { root: "render-audit", prefix: "display-fidelity-" },
  { root: "ui-smoke", prefix: "ui-smoke-" },
  { root: "display-original-evidence", prefix: "cache-" },
  { root: "display-gap-inventory", prefix: "display-gap-" },
];

const ISO_REPORT_STAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)(?:$|[-.])/;

export function generatedEvidenceFamily(relativePath) {
  const normalized = relativePath.replaceAll("\\", "/").replace(/^\.\/?/, "");
  const [root, name, ...rest] = normalized.split("/");

  if (!root || !name || rest.length > 0 || /baseline/i.test(name)) {
    return undefined;
  }

  const family = GENERATED_FAMILIES.find((candidate) => candidate.root === root && name.startsWith(candidate.prefix));
  if (!family) {
    return undefined;
  }

  const suffix = name.slice(family.prefix.length);
  const stamp = suffix.match(ISO_REPORT_STAMP)?.[1];
  if (!stamp) {
    return undefined;
  }

  return {
    id: `${family.root}/${family.prefix}`,
    root,
    name,
    stamp,
  };
}

export function planGeneratedEvidencePrune(entries, options = {}) {
  const keep = Number.isInteger(options.keep) && options.keep >= 1 ? options.keep : 5;
  const grouped = new Map();
  const preserved = [];

  for (const entry of entries) {
    const family = generatedEvidenceFamily(entry.relativePath);
    if (!family) {
      preserved.push({ ...entry, reason: "product, canonical, unknown, or manually named evidence" });
      continue;
    }

    const items = grouped.get(family.id) ?? [];
    items.push({ ...entry, family });
    grouped.set(family.id, items);
  }

  const remove = [];
  const retain = [];

  for (const items of grouped.values()) {
    items.sort((left, right) => right.family.stamp.localeCompare(left.family.stamp));
    retain.push(...items.slice(0, keep).map((entry) => ({ ...entry, reason: `newest ${keep} in generated family` })));
    remove.push(...items.slice(keep).map((entry) => ({ ...entry, reason: `older than newest ${keep} in generated family` })));
  }

  remove.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  retain.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  return {
    keep,
    remove,
    retain,
    preserved,
    removableBytes: remove.reduce((total, entry) => total + (entry.bytes ?? 0), 0),
  };
}
