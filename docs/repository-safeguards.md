# Repository Safeguards

The repository contains two kinds of protection: safeguards checked into code, and GitHub account settings that only an authenticated repository owner can enable.

## Checked-In Gate

The `CI` workflow has read-only repository permissions, cancels obsolete runs on the same branch, and has a 15-minute job deadline. It runs:

```bash
npm ci
npm run env:check
npm run typecheck
npm run security:secrets
npm run test:server-entry
npm run test:unit
npm run test:coverage
```

This checks application types, common credential-shaped values, the real HTTP entry point with blank provider credentials, domain behavior, and coverage. `.github/dependabot.yml` also asks GitHub to open weekly npm dependency-update pull requests.

The local secret scanner is a preventive backstop for common key formats, not a replacement for GitHub Secret Scanning. If it finds a real key, remove it from the commit and rotate the credential; deleting only the visible line is not sufficient after publication.

## GitHub Owner Settings

These settings cannot be enforced by files in the repository. Enable them in GitHub after `gh auth status` confirms an authenticated owner session:

1. Protect `main` with a ruleset that requires a pull request and the `Unit and environment checks` status check.
2. Block force pushes and branch deletion on `main`.
3. Enable Secret Scanning and Push Protection.
4. Enable Dependabot security updates. This is separate from the weekly version-update file.
5. Keep direct bypass limited to an explicit emergency path; normal product changes should pass the same CI gate.

For a solo owner, requiring the pull request and status check is the important minimum. Requiring another person's approval is optional if it would make the repository impossible to maintain.

## Verification Boundary

An unauthenticated local `gh` installation can inspect only public context and cannot safely change repository settings. Future agents should check `gh auth status` before claiming these owner settings are active, and should not infer protection from the presence of a CI workflow alone.
