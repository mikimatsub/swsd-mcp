# Security Policy

## Supported Versions

Only the latest published version of `swsd-mcp` receives security updates.
This project follows semantic versioning; security fixes will land in a patch
or minor release as appropriate.

| Version | Supported |
|---|---|
| Latest | Yes |
| Older | No |

## Reporting a Vulnerability

**Please do not file public GitHub issues for security vulnerabilities.**

Instead, use **[GitHub Security Advisories](https://github.com/mikimatsub/swsd-mcp/security/advisories/new)** to report privately. This routes the report directly to the maintainer, keeps it confidential until a fix is ready, and lets us coordinate disclosure.

### What to include

- A description of the vulnerability
- Steps to reproduce (or a proof of concept)
- The version of `swsd-mcp` you tested against
- Your assessment of impact (data exposure, RCE, DoS, etc.)
- Any suggested fix or mitigation

### What to expect

- **Acknowledgment**: within 72 hours
- **Initial assessment**: within 7 days
- **Fix and disclosure**: timeline depends on severity and complexity. We aim to ship a patch within 30 days for high-severity issues. We will keep you updated.

### Coordinated disclosure

We follow standard coordinated disclosure: we ask reporters not to publicly disclose the vulnerability until a patched release is available and downstream users have a reasonable window to upgrade. We will credit you in the release notes unless you prefer to remain anonymous.

## Threat Model: what this server is and isn't

For the comprehensive security posture (controls, supply-chain hardening,
standards alignment, verification methods), see [`docs/SECURITY-POSTURE.md`](./docs/SECURITY-POSTURE.md).



`swsd-mcp` is an MCP server that proxies SolarWinds Service Desk (SWSD / Samanage) API calls on behalf of the calling user. It is designed with a **zero-credentials-at-rest** architecture:

- The server **never persists or logs** SWSD API tokens.
- For stdio transport, the token is read from `SWSD_TOKEN` env var at startup and held in process memory only for the lifetime of the process.
- For HTTP transport, the token arrives per-request via the `Authorization` or `X-SWSD-Token` header and is forwarded to SWSD without being stored.
- The server makes outbound HTTPS calls **only** to the configured SWSD base URL (validated against the `samanage.com` domain at startup).

The realistic attack surface:

| Concern | Mitigated by |
|---|---|
| Token logging | Code-level discipline; verifiable via source audit (no body logging in HTTP transport, no token-bearing strings in error paths) |
| Token persistence | Stateless HTTP transport (no sessions); no filesystem writes for tokens |
| Outbound exfiltration | `SWSD_BASE_URL` is allowlist-validated at startup to require a `samanage.com` host |
| DDoS / abuse | Rate limiting on `/mcp` keyed by `sha256(token + IP)`, configurable via env |
| Compromised maintainer account | Hardware 2FA on npm + GitHub; OIDC trusted publishing (no long-lived tokens); SLSA provenance attestations on every release |
| Compromised dependency | Renovate auto-PRs for upstream updates with 3-day minimum-release-age cooldown; small dependency surface; npm audit in CI |

## Out of scope

Vulnerabilities in the upstream SolarWinds Service Desk API itself should be reported to SolarWinds, not here.

## Disclaimers

This project is **not affiliated with, endorsed by, or sponsored by SolarWinds Worldwide, LLC.** SolarWinds, Samanage, and Service Desk are trademarks of their respective owners.
