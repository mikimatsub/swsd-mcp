---
title: Security
description: Threat model, supply-chain hardening, and how to report vulnerabilities.
---

swsd-mcp's security model is built around four principles:

1. **Zero credentials at rest** — the server never persists or logs API tokens
2. **Defense in depth** — multiple independent controls so any single bypass isn't compromise
3. **Verifiable supply chain** — published artifacts tied to specific commits via SLSA provenance attestations
4. **Transparent governance** — open source, explicit disclosure process, code review, change-management tooling

For deep compliance-grade details (every claim mapped to source-code verification), see [`SECURITY-POSTURE.md`](https://github.com/mikimatsub/swsd-mcp/blob/main/docs/SECURITY-POSTURE.md). This page is the user-facing summary.

## Vulnerability reporting

→ **[Open a private security advisory](https://github.com/mikimatsub/swsd-mcp/security/advisories/new)**

Do **not** open a public issue for vulnerabilities. The advisory channel is private and only visible to the maintainer.

| | |
|---|---|
| Acknowledgment SLA | 72 hours |
| Initial assessment SLA | 7 days |
| Patch SLA (high-severity) | 30 days |
| Disclosure model | Coordinated (fix-then-publicize) |
| Reporter credit | Yes, in release notes (unless anonymity requested) |

Full process in [`SECURITY.md`](https://github.com/mikimatsub/swsd-mcp/blob/main/SECURITY.md).

## Architectural properties

### Zero credentials at rest

The server has no concept of "its own" SWSD identity. Every API call uses the calling user's token, which arrives via:

- `SWSD_TOKEN` env var (stdio transport, local agent use)
- `Authorization: Bearer <token>` header (Streamable HTTP)
- `X-SWSD-Token: <token>` header (alternate, for Copilot Studio)

Tokens exist only in process memory for the lifetime of a single request. They are never written to disk, never logged, and never sent anywhere except the configured SWSD API host (validated against `*.samanage.com`).

### SSRF defense

`SWSD_BASE_URL` is validated at startup against the `samanage.com` domain. Other URLs are rejected. This prevents an attacker who manages to influence the env var (e.g., via a misconfigured deployment) from redirecting forwarded tokens to a server they control.

### Rate limiting

`/mcp` requests are rate-limited per `sha256(token + IP)` using `express-rate-limit`. Conservative defaults shipped; tunable per deployment via `SWSD_RATE_LIMIT_MAX` and `SWSD_RATE_LIMIT_WINDOW_MS`. Standards-compliant `RateLimit-Policy` and `RateLimit` headers in responses (draft-7 spec) so well-behaved clients can self-regulate.

The token is hashed (never stored as a key) for memory safety. `/healthz` is deliberately exempted — health probes from orchestrators hit it constantly.

### Origin validation (DNS rebinding defense)

The `/mcp` endpoint validates the `Origin` header against an allowlist (`SWSD_ALLOWED_ORIGINS`). This is the documented mitigation for DNS rebinding attacks where a malicious website tricks a browser into sending requests to a localhost MCP server.

Empty allowlist = no Origin restriction (acceptable behind a trusted reverse proxy that filters).

### Request timeouts

All outbound SWSD calls have a configurable timeout (default 30 seconds) via `AbortSignal.timeout`. Prevents hung connections from exhausting worker resources.

### Logging discipline

- HTTP request bodies are never logged (they may contain tokens)
- Error responses include the SWSD response body for actionable debugging, but errors are mapped through a sanitization layer in [`src/swsd/errors.ts`](https://github.com/mikimatsub/swsd-mcp/blob/main/src/swsd/errors.ts)
- No telemetry, no analytics, no phone-home calls
- Server startup log line is the only stdout output by default

### Health endpoint information disclosure

`/healthz` returns `{"ok":true}` only — deliberately omits version information to avoid leaking stack details to anonymous callers. Server metadata (name, version, profile, enabled tools) is available via the `swsd_get_server_info` MCP tool, which is behind the authenticated MCP transport.

## Supply chain

Every published artifact is cryptographically tied to a specific source commit and CI workflow.

| Layer | Mitigation |
|---|---|
| **npm package** | OIDC trusted publishing (no long-lived `NPM_TOKEN` exists); SLSA provenance attestations on every release; verifiable with `npm audit signatures` |
| **Direct dependencies** | All pinned to exact versions in `package-lock.json`; Renovate weekly updates; `npm audit` in CI; small surface (7 direct production deps: `@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`, `dompurify`, `express`, `express-rate-limit`, `helmet`, `zod`) |
| **GitHub Actions** | All pinned to commit SHAs (not version tags); Renovate auto-PRs new SHAs |
| **Docker base image** | `node:24-alpine` pinned by SHA256 digest in `Dockerfile`; Renovate tracks new digests |

Verify provenance for any installed version:

```bash
npm view swsd-mcp --json | jq .dist.attestations
npm audit signatures
```

## Continuous scanning

Every push and PR runs three security workflows in parallel:

| Tool | What it scans |
|---|---|
| **gitleaks** | Secret patterns across the diff (PR) or full history (push) |
| **CodeQL** | JavaScript/TypeScript static analysis with the security-extended query pack |
| **OSV-Scanner** | Dependency vulnerabilities against [Google's OSV database](https://osv.dev/) |

A weekly scheduled run catches newly disclosed CVEs against unchanged dependencies — the killer feature, since your code didn't change but the upstream world did.

[![Security](https://github.com/mikimatsub/swsd-mcp/actions/workflows/security.yml/badge.svg)](https://github.com/mikimatsub/swsd-mcp/actions/workflows/security.yml)

## Standards alignment

Reference frameworks we've drawn from. **We don't claim formal certification against any of these** — they're the languages we use to describe what we do, not audits we've passed.

| Framework | Where we align |
|---|---|
| [SLSA](https://slsa.dev) Build Level 3 | npm publish via OIDC + signed provenance attestations + reproducible builds |
| [NIST SSDF](https://csrc.nist.gov/Projects/ssdf) | PW.4 (review code), PW.7 (review and analyze software design), PW.8 (reuse vetted software), PS.2 (provenance), RV.1 (vulnerability disclosure) |
| [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) | V13 (API and Web Service): authentication, rate limiting, input validation, output encoding |
| [npm audit signatures](https://docs.npmjs.com/cli/v11/commands/npm-audit/#audit-signatures) | All releases signed; users verify with `npm audit signatures` |

## Threat model

### In scope (mitigated)

| Threat | Severity | Mitigation |
|---|---|---|
| Token logged or persisted by the server | High → Mitigated | No filesystem writes for tokens; HTTP body never logged |
| Token forwarded to attacker-controlled URL (SSRF) | High → Mitigated | `SWSD_BASE_URL` validated against `*.samanage.com` allowlist at startup |
| DoS via request flooding | Medium → Mitigated | Per-token+IP rate limiting on `/mcp`; standards-compliant headers |
| DoS via hung outbound calls | Medium → Mitigated | 30-second per-request timeout via `AbortSignal.timeout` |
| DNS rebinding | Medium → Mitigated | `Origin` header validation hook on `/mcp` |
| Compromised maintainer account → malicious release | High → Mitigated | npm OIDC; SLSA provenance |
| Compromised dependency (transitive) | Medium → Mitigated | Pinned `package-lock.json`; Renovate; `npm audit` in CI; small surface |
| Compromised GitHub Action | Medium → Mitigated | All actions pinned to commit SHAs; Renovate auto-PRs |
| Compromised Docker base image | Medium → Mitigated | Pinned by SHA256 digest; Renovate tracks |
| Tenant data leakage in error responses | Medium → Mitigated | Error mapper sanitizes upstream bodies |

### Out of scope

| Concern | Why out of scope |
|---|---|
| SolarWinds Service Desk API vulnerabilities | Report directly to SolarWinds, not this project |
| User's deployment environment hardening | Each operator hosts their own instance |
| User's MCP host security (Claude, Copilot Studio, etc.) | Upstream implementations out of our control |
| User's token rotation discipline | Per-user responsibility; we never persist tokens |
| Corporate TLS-intercepting proxies | IT decision; we use TLS 1.2+ which is standard |

## How to verify

Every claim above includes a path to verification. The general approach:

1. **Source code claims** — clone the repo, navigate to the cited file, read the implementation. The TypeScript source under `src/` is about 9,400 lines not counting tests.
2. **Dependency claims** — `cat package.json package-lock.json` shows exact pinned versions; `cat .github/workflows/*.yml` shows pinned action SHAs.
3. **Provenance claims** — `npm view swsd-mcp --json | jq .dist.attestations` shows SLSA attestations; `npm audit signatures` verifies.
4. **CI claims** — workflow runs are public at [Actions tab](https://github.com/mikimatsub/swsd-mcp/actions); logs are inspectable.

The full posture doc (longer, more thorough, with code-line citations for every control) lives at [`docs/SECURITY-POSTURE.md`](https://github.com/mikimatsub/swsd-mcp/blob/main/docs/SECURITY-POSTURE.md).
