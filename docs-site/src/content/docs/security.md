---
title: Security
description: Threat model, supply-chain hardening, and how to report vulnerabilities.
---

swsd-mcp's security model is built around four principles:

1. **Zero credentials at rest**: the MCP server does not save JSON Web Tokens to disk or log request bodies
2. **Defense in depth**: independent controls for URL validation, request handling, and write safety
3. **Verifiable supply chain**: npm publishing requests provenance attestations linking the package to its build
4. **Transparent governance**: open source, explicit disclosure process, code review, change-management tooling

For more detail on the controls and reporting process, see [`SECURITY-POSTURE.md`](https://github.com/mikimatsub/swsd-mcp/blob/main/docs/SECURITY-POSTURE.md). This page summarizes the controls.

## Vulnerability reporting

→ **[Open a private security advisory](https://github.com/mikimatsub/swsd-mcp/security/advisories/new)**

Do **not** open a public issue for vulnerabilities. Use the private advisory channel for the disclosure process.

Full process in [`SECURITY.md`](https://github.com/mikimatsub/swsd-mcp/blob/main/SECURITY.md).

## Architectural properties

### Zero credentials at rest

The server has no concept of "its own" SWSD identity. Every API call uses the calling user's token, which arrives via:

- `SWSD_TOKEN` env var (stdio transport, local agent use)
- `Authorization: Bearer <token>` header (Streamable HTTP)
- `X-SWSD-Token: <token>` header (alternate, for Copilot Studio)

HTTP uses a request-scoped token and SWSD client. Stdio keeps the configured token for the server process lifetime. The MCP server does not save either token to disk; SWSD requests use the configured HTTPS API URL.

The Windows companion deliberately saves the user's JSON Web Token in Windows Credential Manager and passes it to the local server at launch. Region, profile, and appearance are saved separately in `%LOCALAPPDATA%\swsd-mcp\settings.json`. Other MCP clients manage their own credential storage.

The server checks token format locally; SWSD validates credentials and account permissions when an upstream request is made. Local metadata tools do not verify SWSD access.

### SSRF defense

`SWSD_BASE_URL` must use HTTPS on `samanage.com` or a subdomain without embedded credentials. Other URLs are rejected at startup, restricting where the deployment can configure its upstream API.

### Rate limiting

`/mcp` requests are rate-limited per SHA256 hash of the token and normalized IP (IPv6 /56 bucket) using `express-rate-limit`. Conservative defaults shipped; tunable per deployment via `SWSD_RATE_LIMIT_MAX` and `SWSD_RATE_LIMIT_WINDOW_MS`. Standards-compliant `RateLimit-Policy` and `RateLimit` headers in responses (draft-7 spec) so well-behaved clients can self-regulate.

The token is hashed (never stored as a key) for memory safety. `/healthz` is deliberately exempted: health probes from orchestrators hit it constantly.

### Origin validation (DNS rebinding defense)

The `/mcp` endpoint validates the `Origin` header against an allowlist (`SWSD_ALLOWED_ORIGINS`). This is the documented mitigation for DNS rebinding attacks where a malicious website tricks a browser into sending requests to a localhost MCP server.

Empty allowlist = only loopback origins are accepted. Requests without an `Origin` header are unaffected.

`SWSD_ALLOWED_HOSTS` optionally restricts exact Host headers, including ports when present. This check applies to `/mcp` and does not change the listen address.

### Request timeouts

Each outbound fetch attempt has a configurable timeout (default 30 seconds). GET retries and backoff can make the whole tool call longer. Writes are never automatically retried.

### Logging discipline

- HTTP request bodies are never logged (they may contain tokens)
- Error responses can include upstream body content for debugging. The active token, credential-named fields, and recognizable credential text are redacted through the error and transport layers in [`src/swsd/errors.ts`](https://github.com/mikimatsub/swsd-mcp/blob/main/src/swsd/errors.ts)
- No telemetry, no analytics, no phone-home calls
- HTTP startup, warnings, and errors go to stderr. Stdio stdout is reserved for MCP messages

### Health endpoint information disclosure

`/healthz` returns `{"ok":true}` only and omits version information. Server metadata (name, version, profile, enabled tools) is available via `swsd_get_server_info` when that tool is selected. HTTP requires a syntactically valid token header to call it, but this local tool does not contact SWSD or authenticate the caller's SWSD account. Use `swsd_health_check` to verify upstream access.

## Supply chain

The npm release workflow requests provenance; container builds use pinned inputs and source metadata.

| Layer | Mitigation |
|---|---|
| **npm package** | OIDC trusted publishing with `--provenance`; inspect the published package's attestations and verify dependency signatures with `npm audit signatures` |
| **Direct dependencies** | Resolved versions and integrity hashes in `package-lock.json`; Renovate configuration; `npm audit` in CI; 11 direct production dependencies, including the split MCP client/core/server/node packages, MCP Apps, Hono's Node adapter, DOMPurify, Express, rate limiting, Helmet, and Zod |
| **GitHub Actions** | All pinned to commit SHAs (not version tags); Renovate auto-PRs new SHAs |
| **Docker base image** | `node:24-alpine` pinned by SHA256 digest in `Dockerfile`; Renovate tracks new digests |

Verify provenance for any installed version:

```bash
npm view swsd-mcp --json | jq .dist.attestations
npm audit signatures
```

## Continuous scanning

Pushes to `main` and PRs targeting `main` run three parallel security jobs:

| Tool | What it scans |
|---|---|
| **gitleaks** | Secret patterns across the diff (PR) or full history (push) |
| **CodeQL** | JavaScript/TypeScript static analysis with the security-extended query pack |
| **OSV-Scanner** | Dependency vulnerabilities against [Google's OSV database](https://osv.dev/) |

A weekly scheduled run catches newly disclosed CVEs against unchanged dependencies: the killer feature, since your code didn't change but the upstream world did.

[![Security](https://github.com/mikimatsub/swsd-mcp/actions/workflows/security.yml/badge.svg)](https://github.com/mikimatsub/swsd-mcp/actions/workflows/security.yml)

## Standards alignment

Reference frameworks we've drawn from. **We don't claim formal certification against any of these**: they're the languages we use to describe what we do, not audits we've passed.

| Framework | Where we align |
|---|---|
| [SLSA](https://slsa.dev) provenance | npm publishing requests provenance through GitHub Actions OIDC |
| [NIST SSDF](https://csrc.nist.gov/Projects/ssdf) | Dependency auditing, static analysis, provenance publishing, and a vulnerability-reporting policy |
| [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/) | V13 (API and Web Service): authentication, rate limiting, input validation, output encoding |
| [npm audit signatures](https://docs.npmjs.com/cli/v11/commands/npm-audit/#audit-signatures) | Verify installed dependency signatures and attestations with `npm audit signatures` |

## Threat model

### In scope (mitigated)

| Threat | Severity | Mitigation |
|---|---|---|
| Token logged or persisted by the server | High → Mitigated | MCP server has no credential-file writes; Windows companion uses Credential Manager; HTTP bodies are not logged |
| Token forwarded to attacker-controlled URL (SSRF) | High → Mitigated | HTTPS URL and `samanage.com` domain validation at startup |
| DoS via request flooding | Medium → Mitigated | Per-token+IP rate limiting on `/mcp`; standards-compliant headers |
| DoS via hung outbound calls | Medium → Mitigated | 30-second timeout per outbound fetch attempt |
| DNS rebinding | Medium → Mitigated | `Origin` header validation hook on `/mcp` |
| Compromised maintainer account → malicious release | High → Reduced | npm OIDC and provenance identify the publishing workflow; they do not prevent malicious authorized changes |
| Compromised dependency (transitive) | Medium → Mitigated | Pinned `package-lock.json`; Renovate; `npm audit` in CI; small surface |
| Compromised GitHub Action | Medium → Mitigated | All actions pinned to commit SHAs; Renovate auto-PRs |
| Compromised Docker base image | Medium → Mitigated | Pinned by SHA256 digest; Renovate tracks |
| Credential leakage in error responses | Medium → Reduced | Credential redaction; upstream errors can still contain tenant data |

### Out of scope

| Concern | Why out of scope |
|---|---|
| SolarWinds Service Desk API vulnerabilities | Report directly to SolarWinds, not this project |
| User's deployment environment hardening | Each operator hosts their own instance |
| User's MCP host security (Claude, Copilot Studio, etc.) | Upstream implementations out of our control |
| User's token rotation discipline | Per-user responsibility; the Windows companion stores the token in Credential Manager |
| Corporate TLS-intercepting proxies | Operator-managed trust and network configuration |

## How to verify

Every claim above includes a path to verification. The general approach:

1. **Source code claims**: clone the repo, navigate to the cited file, read the implementation. Runtime controls live under `src/`; Windows credential handling lives under `plugins/swsd/scripts/`.
2. **Dependency claims**: `cat package.json package-lock.json` shows dependency declarations and resolved versions; `cat .github/workflows/*.yml` shows pinned action SHAs.
3. **Provenance claims**: `npm view swsd-mcp --json | jq .dist.attestations` shows SLSA attestations; `npm audit signatures` verifies.
4. **CI claims**: workflow runs are public at [Actions tab](https://github.com/mikimatsub/swsd-mcp/actions); logs are inspectable.

The full posture doc (longer, more thorough, with code-line citations for every control) lives at [`docs/SECURITY-POSTURE.md`](https://github.com/mikimatsub/swsd-mcp/blob/main/docs/SECURITY-POSTURE.md).
