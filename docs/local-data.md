# Local Data

`.data/` is the project's private local state and evidence store. It is intentionally ignored by git because it can contain X timeline data, OAuth state, OpenAI cache entries, screenshots, browser state, and local investigation artifacts.

The application creates `.data/` with owner-only `0700` permissions and writes sensitive product-state JSON as `0600`. Saves use a shared same-directory temporary file, file sync, atomic rename, and directory sync so a crash cannot expose a half-written JSON document. `npm run env:check` reports known paths whose group/other permissions are too broad.

Advanced `*_PATH` overrides must point into a dedicated owner-only directory. The app creates missing directories as `0700`, but it will not change permissions on an existing custom/shared parent or follow a parent-directory symlink; it fails with an explanation instead. In particular, do not place state files directly in `/tmp` or the repository root—create a private subdirectory first.

The owner-facing rule is simple: do not treat `.data/` as disposable just because it is local. It contains both product state and the evidence that protects future refactors.

## Inventory

Use the read-only inventory before cleanup, refactors, or display-fidelity work:

```bash
npm run data:inventory
```

The command scans `.data/`, writes `.data/data-inventory/.../report.md` and `report.json`, and prints a short summary. It does not delete, archive, rewrite, or upload anything.

## Categories

| Category | Examples | Retention |
| --- | --- | --- |
| Product state | `.data/runs.json`, `.data/seen-posts.json`, `.data/timeline-cursor.json`, `.data/refresh-commit-journal.json`, `.data/server-state.lock`, `.data/x-oauth.json`, `.data/openai-cache.json`, `.data/link-preview-cache.json`, `.data/x-snapshots.json` | Keep. These files drive replay, online state, crash recovery, single-writer protection, provider caches, and evidence-backed rendering. |
| Canonical evidence | `.data/display-gap-inventory/display-gap-baseline-*`, `.data/display-original-evidence/original-evidence-store.json` | Keep until a newer accepted baseline explicitly replaces it. |
| Generated evidence report | `.data/display-oracle/`, `.data/display-visual-review/`, `.data/render-coverage/`, `.data/render-regression/`, `.data/render-audit/`, non-baseline display inventories, Original capture/cache reports | Keep current and important reports. Older reports can be archived or pruned only after a newer baseline is recorded. |
| Legacy browser profile | `.data/x-audit-browser-profile/` | Obsolete local-only state from the removed dedicated audit-profile login path. It may contain cookies or login state, so inspect before deleting. |
| Data inventory report | `.data/data-inventory/` | Safe to regenerate. Keep recent reports while making cleanup decisions. |
| Transient debug artifact | `.data/ui-smoke/`, `x-original-*.png`, `server.pid`, `debug-*`, `*.bak` | Short-lived diagnostics. Safe to delete only after confirming they are not part of an active investigation. |
| Unknown local data | Anything not classified | Inspect before deciding. Never delete automatically. |

## Important Files

- `.data/runs.json` is the main saved run store. Replay, API smoke, UI smoke, sample-type coverage, replay rendering checks, and product debugging depend on it.
- `.data/refresh-commit-journal.json` exists only during an unfinished Online state commit. Do not delete it manually: server startup uses it to restore Run, Seen, and Cursor state after an interrupted process.
- `.data/server-state.lock` prevents two local server processes from writing the same product state. A dead owner's lock is reclaimed safely at startup; do not delete a live owner's lock to force a second server.
- `.data/x-snapshots.json` keeps raw X provider responses. When the Reader appears to lack a field, inspect snapshots before adding UI compatibility logic.
- `.data/openai-cache.json` caches OpenAI scoring and translation results by operation/model/prompt/source fingerprint. It does not include interaction weighting.
- `.data/link-preview-cache.json` caches ordinary external preview metadata. It is separate from OpenAI cache.
- `.data/display-original-evidence/original-evidence-store.json` is the reusable Original X evidence cache for Display Oracle.
- `.data/display-original-evidence/original-screenshots/` stores Original screenshots that were imported from outside the durable evidence root. Evidence rows must not depend on `/private/tmp`, browser downloads, or other temporary screenshot locations.

## Cleanup Policy

Cleanup is deliberately preview-first. The supported command only recognizes timestamped children of known generated-report families; it never selects product state, named/canonical baselines, durable Original screenshots, manually named evidence, or unknown paths.

Preview the bounded plan (newest five per generated family by default):

```bash
npm run data:prune
npm run data:prune -- --verbose
```

After reviewing it, apply with an explicit confirmation phrase:

```bash
npm run data:prune -- --keep=5 --apply --confirm=prune-generated-evidence
```

This is an owner-run retention workflow, not automatic deletion after tests. Changing `--keep` changes only known timestamped report families.

Before deleting or archiving local data:

1. Run `npm run data:inventory`, then `npm run data:prune -- --verbose`.
2. Confirm whether the target is product state, canonical evidence, generated report, browser state, transient debug, or unknown.
3. If it is product state or canonical evidence, do not delete it unless there is a documented replacement.
4. If it is an old generated report, prefer keeping the latest accepted baseline and pruning older intermediate reports only after writing down the decision.
5. If it is unknown, inspect it first.

## Relationship To Tests

The testing strategy relies on real X-derived data rather than fabricated source modes. That means `.data/` is part of how we keep refactors honest:

- replay regression proves known real inputs still render correctly;
- sample-type coverage checks whether the local evidence pool is broad enough;
- display inventory and Original evidence capture build broad evidence maps;
- Display Oracle blocks when local or Original evidence is missing, blank, low-quality, or not targeted to the exact post;
- visual review sheets are automated screenshot comparison artifacts, not optional manual decoration.

If a test needs a missing X shape, collect more real data with Online Pulse or the display inventory tooling instead of inventing mock posts.

When importing Original X evidence, keep screenshots durable. `npm run x-display:collect-original-renderings` copies external screenshot paths into `.data/display-original-evidence/original-screenshots/` and can repair old missing screenshot paths only when there is exactly one durable screenshot match for the same post id. Rows that still point to missing screenshots are not trustworthy evidence and should be recaptured rather than accepted.
