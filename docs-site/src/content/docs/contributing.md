---
title: Contributing
description: How to file issues, propose features, and submit pull requests for swsd-mcp.
---

Contributions are welcome. This page covers what to expect when filing issues or pull requests.

## Reporting bugs

→ **[Open a bug report](https://github.com/mikimatsub/swsd-mcp/issues/new?template=bug_report.yml)** — uses a structured form

Include:

- **What you tried** — exact tool call, environment (stdio vs http), profile in use
- **What happened** — actual response or error, with sensitive data redacted
- **What you expected** — what behavior you were aiming for
- **Version** — `npm view swsd-mcp version` or commit SHA

For **security issues**, see [Security → Vulnerability reporting](/security/#vulnerability-reporting). Do not file public issues for vulnerabilities.

## Suggesting features

→ **[Open a feature request](https://github.com/mikimatsub/swsd-mcp/issues/new?template=feature_request.yml)**

Include:

- The use case (what workflow or task)
- The proposed tool/behavior
- Whether it requires new SWSD endpoints (and which)

## Pull requests

PRs are welcome. Before submitting:

1. **Open an issue first** for non-trivial changes so we can discuss the approach.
2. **Run the full local check:**
   ```bash
   npm install
   npm run typecheck
   npm run test:coverage
   npm run lint
   ```
3. **Add tests** for new behavior. The existing test suite is hermetic (no live API calls); follow that pattern.
4. **Smoke against your tenant** for changes touching SWSD interactions. Use the `[MCP-VAL]` prefix convention for any test data you create, and clean up after yourself.
5. **Commit messages** follow conventional-commit style — `feat:`, `fix:`, `ci:`, `docs:`, etc. — with a clear "why" in the body.
6. **Don't bump the package version** in your PR — releases are tagged separately.

### Pre-commit hooks

The repo uses `husky` + `lint-staged` to run `eslint --fix` on staged TS/JS files automatically before each commit. After cloning + `npm install`, hooks install themselves via the `prepare` script. No additional setup.

### What I look for in code review

- **Defensive parsing** for SWSD response shapes — assume fields can be missing or wrong-typed
- **Compact projections** for list tools — every leaked field is tokens consumed in the agent's context
- **Tight Zod schemas** with `.describe()` on every parameter
- **Errors that name the next action** — _"use `swsd_list_users` first"_ rather than just _"404"_
- **No new dependencies** without strong justification — each one expands the supply-chain surface

### What blocks a PR

- Hardcoded tenant data in tests or fixtures (use synthetic names like `Alice`, `Office One`, `example.com`)
- Logging of API tokens or response bodies
- New install scripts (`postinstall`, etc.)
- New dependencies that do not follow the repo's `package.json` plus lockfile convention
- Lockfile changes that look unrelated to your stated change

## Local development

```bash
git clone https://github.com/mikimatsub/swsd-mcp.git
cd swsd-mcp
npm install

npm run build         # compile TypeScript to dist/
npm test              # run unit tests (vitest)
npm run test:coverage # run tests and enforce the measured coverage baseline
npm run lint          # eslint
npm run typecheck     # tsc --noEmit

# Run against your own tenant
export SWSD_TOKEN="your-token"
export SWSD_BASE_URL="https://api.samanage.com"
npm run inspect:stdio
```

`npm run inspect:stdio` opens the MCP Inspector (Anthropic's web UI for testing MCP servers) connected to your local build over stdio. Useful for clicking through tool calls during development.

For HTTP-transport development:

```bash
SWSD_TRANSPORT=http npm run dev
# Server runs on http://localhost:3000
# /healthz returns {"ok":true}
# /mcp expects token via Authorization or X-SWSD-Token header
```

## Documentation contributions

The docs site (this site!) lives under [`docs-site/`](https://github.com/mikimatsub/swsd-mcp/tree/main/docs-site) — see [`docs-site/README.md`](https://github.com/mikimatsub/swsd-mcp/blob/main/docs-site/README.md) for dev/build commands.

Cloudflare Pages auto-deploys every push to `main`. PRs get preview URLs commented automatically.

## Code of conduct

We follow [Contributor Covenant 3.0](https://github.com/mikimatsub/swsd-mcp/blob/main/CODE_OF_CONDUCT.md). Reports go through [GitHub Security Advisories](https://github.com/mikimatsub/swsd-mcp/security/advisories/new) marked `[Code of Conduct]`.
