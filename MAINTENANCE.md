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

The MCP SDK v2 migration uses its separate `client`, `core`, and `server`
packages at 2.4.0, the Node HTTP adapter at 2.1.2, and MCP Apps at 2.0.4.
These packages are compatible peers and passed the three-day publication gate.
Keep `@hono/node-server` 2.1.6 as an exact public dependency. Its official tag,
npm provenance, HTTP/WebSocket hardening changes, Node engine and Hono peer were
reviewed after the three-day gate; npm package overrides do not propagate to
consumers.
Keep the SDK client/core/server versions aligned because they share the same
core schema graph. SDK 2.4 requires one server and stateless transport per HTTP
request; `src/transports/http.ts` already creates both inside the request handler.

Tool input and output registrations use complete Zod objects, preserving runtime
refinements. `node scripts/smoke-protocols.mjs` runs after the server build and
checks all four deployed legacy protocol versions over real HTTP and STDIO CLI
processes. It uses a fixture credential and disabled writes; no SWSD API calls.
HTTP continues to advertise the four legacy protocol versions in its existing
header allowlist. Adopting the 2026-07-28 HTTP binding requires its own review.

TypeScript 7.0.2 is incompatible with the current stable `typescript-eslint`
8.72.1 peer requirement `>=4.8.4 <6.1.0`. Retain TypeScript 6.0.3 until the
stable parser supports v7; do not force peers or suppress version checks.
Node.js 24.15+ remains the minimum supported runtime; Node 26 is also supported.
Node 25 is end of life and is not supported. Primary CI tests Node 24 and 26,
while Windows plugin and docs CI retain Node 24. Docker uses the digest-pinned
Node 26 Alpine image. Keep the Node 24 runtime types to preserve compatibility
with the minimum supported line. Windows setup accepts Node 24.15+ within
major 24 or Node 26+ and installs the current supported LTS through winget.

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
uses disabled write mode, checks all four built-in profiles, reads a minimal incident
sample and knowledge metadata, and reads all ten widget resources. It emits
counts and check names, never token values, JWT claims, or tenant records.

## Publish and verify

1. Update package and lock versions, `SERVER_VERSION`, `server.json`, and
   `CHANGELOG.md`; regenerate Copilot connectors with `npm run generate:swagger`.
   Verify the packed package includes the CLI and all ten self-contained UI
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
   the run rather than being interpreted as missing versions. Recovery sets
   `SWSD_OFFLINE=1` only for the tag's test step because npm can already expose
   the new server while the intentionally separate plugin-pin PR still names
   the previous version; all deterministic plugin checks still run, and normal
   PR, main, and initial tag tests retain the live latest-version assertion.

## Windows plugin releases

The plugin runtime recipe (`plugins/swsd/runtime`) installs the published
`swsd-mcp` package, so its pin can only name a version that is already on npm.
`tests/unit/pluginRuntimeVersion.test.ts` requires the recipe, its lock and
`$script:SwsdPackageVersion` in `Common.ps1` to agree on one exact pin that is
the latest `swsd-mcp` version on npm and is not ahead of the root version. The
registry check is skipped (with a warning) when npm is unreachable or
`SWSD_OFFLINE=1` is set; the offline checks still run.

1. In the release PR, bump the root version as usual. Windows candidate checks temporarily align the recipe and script with the packed root version, then restore their original bytes. Do not run them concurrently with tests that read the recipe. The runtime pin stays on
   the latest published version, so the test keeps passing.
2. After the tag's npm publish is verified, update `plugins/swsd/runtime/package.json`
   and `SwsdPackageVersion`, then regenerate the lock with
   `npm install --package-lock-only --ignore-scripts --prefix plugins/swsd/runtime`.
   Verify `npm ci --ignore-scripts --strict-peer-deps`, `npm audit` and
   `npm audit signatures` in that folder, and the Windows CI job.
3. Bump the plugin client version in `.codex-plugin/plugin.json`, `.mcp.json`
   and `SwsdClientVersion` together when plugin files change; the same test
   checks they agree.
4. Do not promote a plugin release without the clean-Windows-user acceptance
   gates in `plugins/swsd/ADMIN.md`.

## Scheduled work

Renovate proposes updates; CI and the weekly Security workflow verify changes
and newly disclosed advisories. Neither merges PRs nor creates releases.
A local desktop job must also be enabled, target the correct project, and run
while the app and machine are available. A paused job does no work, and a
Renovate-only manifest/lock prompt cannot complete runtime, Docker, source,
workflow, draft rollout, or release tasks. Inspect its actual prompt and status
when diagnosing missed work. Use the existing job's supported configuration
interface; do not create a duplicate schedule or expand its permissions.
## Automatic workspace promotion

The workspace currently follows `codex/windows-plugin-setup`, not `main`.
`Promote workspace plugin` closes that gap after a reviewed plugin release.
It runs after CI/Security on main, every six hours to retry the age gate, or
by manual dispatch. It never creates a release, merges a PR, or changes the
workspace's identity, sharing, authentication, or sync schedule.

Before merging a plugin release, complete the clean-Windows-user acceptance
in `plugins/swsd/ADMIN.md`. Copy
`.github/plugin-promotion.example.json` to `.github/plugin-promotion.json`
and record the actual results, UTC completion time, and a non-sensitive
evidence reference. Do not mark a check passed without performing it. Include
that record in the reviewed release PR. After the final plugin edits, obtain:

```sh
git rev-parse HEAD:plugins/swsd
git rev-parse HEAD:.agents/plugins/marketplace.json
```

Use those values for `pluginTree` and `marketplaceBlob`. For staged changes,
commit the plugin files first, then add the acceptance record in a second
commit. Any later plugin or marketplace edit invalidates the record.
Client and runtime versions are recorded separately. Changed plugin files
require a higher client version than the deployed plugin. No initial acceptance
has been fabricated: the example is deliberately incomplete.

Promotion requires all named CI and Security jobs to succeed on the exact
current main commit, including Windows checks, both Node versions, docs,
Docker, GHCR, CodeQL, OSV and gitleaks. It verifies the stable npm latest
runtime, lock integrity, release tag ancestry and npm `gitHead`, waits at
least three days after npm publication, and audits the published runtime
dependencies and signatures. Existing dependency-review and age requirements
still apply before merging; this workflow does not replace those reviews.
Missing checks, metadata, acceptance, registry outages or branch divergence
fail closed. An older successful run cannot override a newer failed run.

Only a fast-forward update is permitted. A concurrent branch change stops
the update; no force push, new token, repository secret, or app installation
is needed. The job uses GitHub's short-lived built-in token with contents
write and actions read permissions; checkout does not persist it. Branch
protection can reject promotion and is never bypassed. The promotion workflow
runs only trusted main commits, never pull-request artifacts or code.

Commits that leave the plugin tree and marketplace unchanged do nothing.
After promotion, OpenAI still performs its daily marketplace sync (or an
administrator can use Sync now). Verify the downloaded version, restart the
desktop app, and check health as described in the admin guide. The workflow
does not claim to verify delivery to the workspace or local desktop.

To diagnose a blocked update, inspect the promotion run's failed gate. Finish
the missing check or acceptance record through the normal reviewed PR flow,
then dispatch the workflow again or allow the next scheduled check. Never
force the deployment ref or weaken a check to clear the failure.
