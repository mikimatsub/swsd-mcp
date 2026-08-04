# swsd-mcp — Security Posture

This document describes the security controls and practices in place for
this project. It exists for stakeholders, reviewers, and security-minded
users who want to understand what's been done — and how to verify it.

For **vulnerability reporting**, see [SECURITY.md](../SECURITY.md). This
document is the *posture*; SECURITY.md is the *process*.

---

## Executive Summary

`swsd-mcp` is an MCP (Model Context Protocol) server that proxies SolarWinds
Service Desk API calls on behalf of the calling user. Its security model is
built around four principles:

1. **Zero credentials at rest** — the server never persists or logs API
   tokens; they exist only in process memory for the lifetime of a single
   request.
2. **Defense in depth** — multiple independent controls (origin validation,
   rate limiting, request timeouts, hostname allowlisting) so any single
   bypass doesn't constitute compromise.
3. **Verifiable supply chain** — published artifacts are tied to a specific
   commit and CI workflow via SLSA provenance attestations; all build
   inputs (GitHub Actions, Docker base images, npm dependencies) are
   pinned to immutable identifiers.
4. **Transparent governance** — open source under MIT license with explicit
   disclosure process, code review requirements, and change-management
   tooling (Renovate, CODEOWNERS, branch protection).

For an organization considering adopting this tool: the realistic
attack surface is documented in this file, mitigations are mapped to
specific code locations, and every claim below can be independently
verified.

---

## Threat Model

### In scope

| Threat | Severity | Mitigation |
|---|---|---|
| Token logged or persisted by the server | High → Mitigated | No filesystem writes for tokens; HTTP body never logged; verifiable in [`src/transports/http.ts`](../src/transports/http.ts) |
| Token forwarded to an attacker-controlled URL (SSRF) | High → Mitigated | `SWSD_BASE_URL` validated at startup against `*.samanage.com` allowlist (see [`src/config/env.ts`](../src/config/env.ts) `isSamanageUrl`) |
| DoS via request flooding | Medium → Mitigated | Per-token+IP rate limiting on `/mcp` (default 100 req / 60 sec window) using `express-rate-limit`; standards-compliant `RateLimit-*` headers |
| DoS via hung outbound calls | Medium → Mitigated | 30-second per-request timeout via `AbortSignal.timeout` in [`src/swsd/client.ts`](../src/swsd/client.ts) |
| DoS or unintended file access via oversized MCP arguments | Medium → Mitigated | Zod validates bounded tool inputs before handlers run; attachments require exactly one bounded source, local paths must be regular files, and operators can confine resolved paths with `SWSD_ATTACHMENT_ROOT` |
| DNS rebinding attack | Medium → Mitigated | `Origin` header validation hook on `/mcp` requests |
| Compromised maintainer account → malicious release | High → Mitigated | npm OIDC trusted publishing (no long-lived `NPM_TOKEN` exists); hardware 2FA on npm + GitHub accounts; SLSA provenance attestations on every release |
| Compromised dependency (transitive supply chain) | Medium → Mitigated | All direct dependencies pinned to exact versions in `package-lock.json`; Renovate weekly updates; OSV-Scanner on PRs, `main`, and weekly; small dependency surface (7 direct production deps: `@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`, `dompurify`, `express`, `express-rate-limit`, `helmet`, `zod`) |
| Compromised GitHub Action | Medium → Mitigated | All actions in CI pinned to commit SHAs (not version tags); Renovate auto-PRs new SHAs |
| Compromised Docker base image | Medium → Mitigated | `node:24-alpine` pinned by SHA256 digest in `Dockerfile`; Renovate tracks new digests |
| Tenant data leakage in error responses | Medium → Mitigated | Error mapper in [`src/swsd/errors.ts`](../src/swsd/errors.ts) sanitizes upstream error bodies; never includes tokens; structured tool errors return only the field-level validation failures, not raw responses |

### Out of scope

| Concern | Why out of scope |
|---|---|
| SolarWinds Service Desk API vulnerabilities | Report directly to SolarWinds, not this project |
| User's deployment environment hardening | Each operator hosts their own instance; we provide a hardened container, but underlying infrastructure (Azure App Service, Kubernetes, etc.) is the operator's responsibility |
| User's MCP host security (Claude Desktop, Copilot Studio, etc.) | Upstream MCP host implementations are out of our control |
| User's token rotation discipline | Per-user responsibility; we never persist tokens, so a leaked token's blast radius is bounded by SWSD's own token lifecycle |
| Browser-based MITM via corporate TLS-intercepting proxies | Corporate IT decision; we use TLS 1.2+ which is standard |

---

## Architectural Security Properties

### Zero credentials at rest

The server has no concept of "its own" SWSD identity. Every API call is
made using the calling user's token, which arrives via:

- `SWSD_TOKEN` environment variable (stdio transport only — for local
  agent use)
- `Authorization: Bearer <token>` HTTP header (Streamable HTTP transport)
- `X-SWSD-Token: <token>` HTTP header (alternate for Copilot Studio
  custom connectors)

**The token is never written to disk, never logged, and never sent
anywhere other than the configured SWSD base URL.** Verify by:

```bash
grep -rn "SWSD_TOKEN\|Bearer" src/ --include="*.ts" | grep -v "process.env\|header"
# (no matches — token references are only in env loading and header building)
```

### Stateless HTTP transport

Each `/mcp` request creates a fresh MCP server instance with the
request's token bound to it; the server is closed when the response
finishes. No session state, no in-memory token cache, no cross-request
data persistence. See [`src/transports/http.ts`](../src/transports/http.ts).

### Defensive parsing of upstream responses

All SWSD responses are parsed defensively — fields can be missing,
wrong-typed, or unexpected without crashing the tool. See the mapper
helpers in [`src/swsd/mappers/`](../src/swsd/mappers/).

### Bounded tool inputs and attachment paths

The MCP SDK validates every call against its Zod input schema before invoking
the tool handler. Shared limits bound free-text queries, tenant labels,
long-form content, filter arrays, relationship IDs, custom fields, and service
request variables. Date fields accept real ISO dates or RFC 3339 datetimes;
relative incident windows accept only `Nh`, `Nd`, or `Nw` values from 1–365.
A registry-wide regression test converts every registered tool input to JSON
Schema and fails if any non-enum string or array lacks an explicit maximum.

Attachment uploads apply additional controls in
[`src/schemas/attachment.ts`](../src/schemas/attachment.ts) and
[`src/tools/attachments/uploadAttachment.ts`](../src/tools/attachments/uploadAttachment.ts):

- exactly one of `content_base64` or `file_path`
- canonical base64 and a decoded/file size no larger than SWSD's 25 MB limit
- display-only filenames with no path separators or control characters
- `file_path` only on local stdio transport and only for regular files
- optional `SWSD_ATTACHMENT_ROOT` containment after resolving real paths, so
  symlink traversal cannot escape the configured directory

HTTP JSON requests remain subject to the stricter 4 MB transport body limit.

### Process execution surface

Production source under `src/` does not import `node:child_process` and does not
call `exec`, `execFile`, `spawn`, or `fork`. The repository does contain fixed
maintainer-facing npm scripts for compiling, testing, generating artifacts, and
launching the MCP Inspector, and the installed `swsd-mcp` binary is normally
launched by an MCP host over stdio. Those are expected package/tooling
capabilities, not a runtime primitive that turns MCP arguments into shell
commands.

### Compact projections

List tools return only the fields agents actually need (typically 7-10
per item) rather than the full SWSD response (often 30+ fields per
incident). This reduces accidental exposure of fields the agent
shouldn't see and minimizes context window cost.

---

## Supply Chain Security

### Dependency pinning

| Layer | Pinning strategy | Verification |
|---|---|---|
| Direct npm dependencies | Declared in `package.json`; exact resolved versions pinned in `package-lock.json` | `cat package.json package-lock.json \| jq` |
| Transitive npm dependencies | Locked via `package-lock.json` | Committed to repo |
| GitHub Actions | Commit SHAs, not version tags | `grep -E 'uses:.+@[a-f0-9]{40}' .github/workflows/` |
| Docker base image | SHA256 digest, not version tag | `head -10 Dockerfile` |

### npm publishing — OIDC trusted publishing

The npm publish workflow in [`.github/workflows/publish-npm.yml`](../.github/workflows/publish-npm.yml)
uses **OIDC trusted publishing** — no long-lived `NPM_TOKEN` secret
exists in the repository. Each publish derives a short-lived (minutes)
token from the GitHub Actions OIDC identity, scoped to the specific
workflow + commit + repo.

This means:

- An attacker who gains read access to repository secrets gets nothing
  publish-related.
- An attacker who compromises the maintainer's npm browser session
  cannot push a release without also gaining control of the GitHub
  Actions environment for this specific repo.
- Publish provenance is cryptographically tied to a specific commit
  and workflow run.

### SLSA build provenance attestations

Every `npm publish` runs with the `--provenance` flag, generating a
[SLSA](https://slsa.dev) build attestation. This is a signed statement
that the published package bytes were produced by:

- A specific GitHub Actions workflow file
- A specific commit SHA
- A specific runner environment

Users can verify provenance:

```bash
npm view swsd-mcp --json | jq '.dist.attestations'
# Returns the SLSA attestation URL and verification details

npm audit signatures --package=swsd-mcp
# Verifies the signature locally
```

The npm registry web UI also displays a "Published with provenance"
badge on packages with attestations.

### Reproducible builds

The build is deterministic — same source + same lockfile produces
byte-identical published tarball:

```bash
git checkout vX.Y.Z
npm ci
npm run build
npm pack --dry-run
# Compare output to what was actually published
```

### Renovate automation

[`renovate.json`](../renovate.json) extends the central
[`mikimatsub/.github` Renovate config](https://github.com/mikimatsub/.github/blob/main/renovate-config.json),
which builds on the upstream `config:best-practices` preset:

- npm dependencies (production + dev), pinned exact for devDeps
- GitHub Actions auto-PRs for new commit SHAs
- Docker base image digest tracking
- Weekly lock-file refresh (picks up transitive security fixes)
- **3-day minimum-release-age** on npm packages — supply-chain attack
  defense; recently published versions wait before being proposed
- Abandonment detection — flags dependencies that have stopped
  receiving updates upstream

Security-flagged updates bypass the minimum-release-age and get
individual PRs for faster review and merge.

### Dependency vulnerability scanning

OSV-Scanner runs on pull requests, pushes to `main`, and a weekly schedule so
newly disclosed vulnerabilities are detected even when the source tree has not
changed. The `prepublishOnly` script also runs lint, typecheck, tests, and a
build before any publish. Combined with Renovate's CVE-aware PRs, this gives
multiple opportunities to catch vulnerable dependencies before they reach
users.

---

## Repository Security

### Branch protection

The `main` branch is protected:

- Direct pushes blocked; changes require pull request
- Required status checks: `test` + `docker` jobs from CI must pass
- Force pushes disabled
- Branch deletion disabled

Verify at: `https://github.com/mikimatsub/swsd-mcp/settings/branches`

### CODEOWNERS

[`CODEOWNERS`](../CODEOWNERS) auto-requests maintainer review on PRs
touching:

- All paths (default)
- `.github/` (CI/CD configs)
- `Dockerfile` and `.dockerignore`
- `package.json` and `package-lock.json` (supply-chain-sensitive)
- `eslint.config.js`, `tsconfig.json` (build configuration)
- `SECURITY.md` and `CODEOWNERS` itself

### Workflow permissions

CI workflows declare minimum required permissions:

- `contents: read` on the test/docker jobs (just need to clone)
- `contents: read` + `packages: write` on the GHCR publish job
- `contents: read` + `id-token: write` on the npm publish workflow
  (OIDC token minting only)

No workflow has `write` permission on repository contents — bots
can't push commits or modify code.

### No `pull_request_target` triggers

CI uses only the `pull_request` event for PR validation, never
`pull_request_target`. This means PRs from forks run with no access
to repository secrets — the documented mitigation for "fork PR
secret exfiltration" attacks.

### 2FA on maintainer accounts

Hardware 2FA (WebAuthn / FIDO2) enabled on:

- GitHub account (maintainer)
- npm account (maintainer)

Phishing-resistant by design — an attacker with the password cannot
authenticate without physical possession of the security key.

---

## Build & Release Pipeline Security

### CI workflow gates

Every push to `main` and every PR runs:

1. Install dependencies (`npm ci` against locked versions)
2. Lint (`eslint .`)
3. Typecheck (`tsc --noEmit`)
4. Unit tests with V8 coverage regression gates (`npm run test:coverage` — 72%
   statements, 66% branches, 80% functions, and 76% lines minimum)
5. Docker build (multi-stage, Alpine base)
6. Container smoke test (boot, `/healthz` 200, `/mcp` 401-on-no-auth)
7. (On push to main only) Image push to the public `ghcr.io/mikimatsub/swsd-mcp` package

See [`.github/workflows/ci.yml`](../.github/workflows/ci.yml).

### Pre-publish gate

The `prepublishOnly` script in `package.json` runs the full quality
gate (lint + typecheck + test + build) before any `npm publish`,
even manual ones. Catches accidental broken-build releases.

### Tag-triggered publishing and recovery

Normal publishing only runs on git tag pushes matching `v*`. Tags are
immutable in git and require maintainer access to push, adding another gate
against accidental publishes.

Maintainers can also manually resume a partially completed release by supplying
its existing version to the same workflow. The workflow requires that version
to match `package.json`, `server.json`, and every registry package entry, and it
skips npm or MCP Registry artifacts that already exist. This supports recovery
without moving a release tag or republishing an immutable artifact.

### Container hardening

The published Docker image:

- Runs as the non-root `node` user (UID 1000)
- Multi-stage build excludes dev dependencies and source from runtime
- Minimum Alpine base (~140 MB; total image ~256 MB)
- HEALTHCHECK directive for orchestrator integration
- OCI image labels for source/license/description metadata
- No shell scripts, no `curl`/`wget` (Node's built-in `fetch` for
  the HEALTHCHECK)

See [`Dockerfile`](../Dockerfile).

---

## Operational Security Considerations

### Rate limiting

`/mcp` requests are rate-limited per `sha256(token + IP)`:

- Conservative defaults shipped out of the box; tunable per deployment
  via `SWSD_RATE_LIMIT_MAX` and `SWSD_RATE_LIMIT_WINDOW_MS`
- Uses [express-rate-limit](https://github.com/express-rate-limit/express-rate-limit)
- Standards-compliant `RateLimit-Policy` and `RateLimit` headers in
  responses (draft-7 spec) so well-behaved clients can self-regulate
- `/healthz` deliberately exempted — health probes from orchestrators
  hit it constantly

The token is hashed (never stored as a key) for memory safety.

### Request timeouts

All outbound SWSD calls have a configurable timeout (default 30 sec)
via `AbortSignal.timeout`. Prevents hung connections from exhausting
worker resources.

### Trust proxy configuration

When deployed behind a reverse proxy (Azure App Service, Nginx,
Cloudflare, etc.), the `SWSD_TRUST_PROXY` env var configures
Express's trust-proxy setting so `req.ip` reflects the real client.
Without this, rate limiting would treat all users as one IP.

### Origin validation

The `/mcp` endpoint validates the `Origin` header against an
allowlist (`SWSD_ALLOWED_ORIGINS` env var). This is the documented
mitigation for DNS rebinding attacks where a malicious website
tricks a browser into sending requests to a localhost MCP server.

Empty allowlist = no Origin restriction (acceptable behind a
trusted reverse proxy).

### Logging discipline

- HTTP request bodies are never logged (they may contain tokens)
- Error responses include the SWSD response body for actionable
  debugging, but errors are mapped through the sanitization layer
  in [`src/swsd/errors.ts`](../src/swsd/errors.ts)
- No telemetry, no analytics, no phone-home calls
- Server startup log line is the only stdout output by default

### Health endpoint information disclosure

`/healthz` returns `{"ok":true}` only — deliberately omits version
information to avoid leaking stack details to attackers. Server
metadata (name, version, profile, enabled tools) is available via
the `swsd_get_server_info` MCP tool, which is behind the
authenticated MCP transport.

---

## Vulnerability Disclosure Process

See [SECURITY.md](../SECURITY.md) for the full process. Summary:

- Reports go through GitHub Security Advisories (private, no email
  exposure)
- Acknowledgment SLA: 72 hours
- Initial assessment SLA: 7 days
- Patch SLA: 30 days for high-severity issues
- Coordinated disclosure: fix-then-publicize
- Reporters credited in release notes (unless they prefer anonymity)

---

## Standards & Frameworks Alignment

| Framework | Where we align |
|---|---|
| [SLSA](https://slsa.dev) Build Level 3 | npm publish via OIDC + signed provenance attestations + reproducible builds |
| [NIST SSDF](https://csrc.nist.gov/Projects/ssdf) (Secure Software Development Framework) | PW.4 (review code), PW.7 (review and analyze software design), PW.8 (reuse vetted software), PS.2 (provenance), RV.1 (vulnerability disclosure) |
| [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) | V13 (API and Web Service): authentication, rate limiting, input validation, output encoding |
| [npm package signing](https://docs.npmjs.com/about-package-signatures) | All releases signed; users verify with `npm audit signatures` |

We don't claim formal certification against any of these — they're
reference frameworks we've drawn from, not audits we've passed.

---

## How to Verify the Claims in This Document

Every claim above includes a path to verification. The general approach:

1. **For source code claims**: clone the repo, navigate to the cited
   file, read the implementation. The TypeScript source under `src/` is
   about 9,400 lines not counting tests.
2. **For dependency claims**: `cat package.json package-lock.json`
   shows exact pinned versions; `cat .github/workflows/*.yml` shows
   pinned action SHAs.
3. **For published artifact claims**: `npm view swsd-mcp` shows the
   published metadata; `npm audit signatures` verifies provenance.
4. **For CI claims**: navigate to the Actions tab on GitHub, view any
   recent run's logs.
5. **For container claims**: `docker pull ghcr.io/mikimatsub/swsd-mcp:latest`,
   then `docker inspect` to see configured user, healthcheck, labels.

If any claim in this document fails to verify, please file a GitHub
issue (or a Security Advisory if it's a security claim). We treat
documentation accuracy as a security property in itself.

---

## Document Maintenance

This document is part of the source tree (`docs/SECURITY-POSTURE.md`)
and updated as the security posture evolves. Significant changes are
reflected in `CHANGELOG.md` and called out in release notes.

Last reviewed: see `git log -1 docs/SECURITY-POSTURE.md`.
