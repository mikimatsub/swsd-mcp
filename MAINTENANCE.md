# Maintenance and release runbook

Maintenance needs a complete PR inventory, fresh dependency metadata, and
checks on the final combined code. Green checks from an older commit do not
prove that today's advisory databases are clean.

## Triage and update

1. Start in an isolated checkout; preserve existing worktrees and local changes.
   Read repository guidance and inspect all open PR heads and check results.
2. Review drafts, source changes, runtime updates, and major upgrades explicitly.
   Keep administrator deployment and untested clean-machine installation work
   in draft, with concrete remaining prerequisites. Never change credentials,
   broaden permissions, disable checks, or require interactive elevation.
3. Query upstream publication dates, dependencies, peers, release notes, and
   immutable action/image digests. Retain the inherited three-day minimum age
   for ordinary updates. A newer incompatible major is a migration task.
4. Resolve overlapping lock updates together. Document every replaced PR and
   the final versions/digests. Close obsolete PRs only after the replacement
   has passed all checks and merged.
5. Use a draft PR for new maintenance work. Require final-head lint, server
   and UI types, coverage thresholds, root/docs builds, vulnerability audits,
   Docker smoke tests, CodeQL, OSV, gitleaks, and connected deployment checks.
   Do not treat skipped publishing jobs on PRs as package publication.

## Local verification

```sh
npm ci --strict-peer-deps
npm audit --audit-level=low
npm audit signatures
npm run lint
npm run typecheck
npm run test:coverage
npm run build
cd docs-site
npm ci --strict-peer-deps
npm audit --audit-level=low
npm audit signatures
npm run build
```

The docs prebuild tests exercise Astro's remote-image code against the private
no-cache adapter. Revisit its narrow interface when updating Astro. The adapter
and tests are excluded from the published MCP server package.

With an existing SWSD token already in the process environment, run
`node scripts/smoke-readonly.mjs` from the repository root after building. It
uses disabled write mode, checks all five profiles, reads a minimal incident
sample and knowledge metadata, and reads all seven widget resources. It emits
counts and check names, never token values, JWT claims, or tenant records.

## Publish and verify

1. Update package and lock versions, `SERVER_VERSION`, `server.json`, and
   `CHANGELOG.md`; regenerate Copilot connectors with `npm run generate:swagger`.
   Verify the packed package includes the CLI and all seven self-contained UI
   bundles and excludes source, test, plugin, and credential files.
2. Merge the green release PR using the current expected head. Wait for CI and
   Security on the resulting main commit, including successful GHCR publication.
3. Tag that verified main commit `vX.Y.Z`. The existing release workflow uses
   OIDC to publish npm provenance and MCP Registry metadata. Do not move tags.
4. Wait for the tag run to complete. Verify the npm version, integrity and
   provenance commit; MCP Registry's canonical exact-version record; and the
   GHCR image revision against the release commit. Smoke test the published
   package. Create the GitHub release with the full changes, verification, PR
   dispositions, and deferred work. Inspect its tag and assets afterward.
5. To recover a partial publish, dispatch **Publish release artifacts** from
   main with the bare version (for example `2.3.2`). It rebuilds that existing
   tag and skips already published immutable versions. Registry outages fail
   the run rather than being interpreted as missing versions.

## Scheduled work

Renovate proposes updates; CI and the weekly Security workflow verify changes
and newly disclosed advisories. Neither merges PRs nor creates releases.
A local desktop job must also be enabled, target the correct project, and run
while the app and machine are available. A paused job does no work, and a
Renovate-only manifest/lock prompt cannot complete runtime, Docker, source,
workflow, draft rollout, or release tasks. Inspect its actual prompt and status
when diagnosing missed work. Use the existing job's supported configuration
interface; do not create a duplicate schedule or expand its permissions.
