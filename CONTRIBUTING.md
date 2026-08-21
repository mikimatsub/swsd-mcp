# Contributing to swsd-mcp

Contributions are welcome. This document covers what to expect when filing
issues or pull requests.

## Reporting bugs

Please file a GitHub issue with:

- **What you tried**: exact tool call, environment (stdio vs http), profile in use
- **What happened**: actual response or error, with sensitive data redacted
- **What you expected**: what behavior you were aiming for
- **Version**: `npm view swsd-mcp version` or commit SHA

For security issues, see [SECURITY.md](./SECURITY.md). Do not file public issues for vulnerabilities.

## Suggesting features

Open an issue describing:

- The use case (what workflow or task)
- The proposed tool/behavior
- Whether it requires new SWSD endpoints (and which)

## Pull requests

PRs are welcome. Before submitting:

1. **Open an issue first** for non-trivial changes so we can discuss the approach.
2. **Run the full test suite locally:**
   ```bash
   npm install
   npm run typecheck
   npm test
   npm run lint
   ```
3. **Add tests** for new behavior. The existing test suite is hermetic (no live API calls); follow that pattern.
4. **Smoke against your tenant** for changes touching SWSD interactions. Use the `[MCP-VAL]` prefix convention for any test data you create, and clean up after yourself.
5. **Commit messages** follow the conventional-commit style used in `git log`: `feat:`, `fix:`, `ci:`, `docs:`, etc., with a clear "why" in the body.
6. **Don't bump the package version** in your PR: releases are tagged separately.

### What I look for in code review

- Defensive parsing for SWSD response shapes (assume fields can be missing or wrong-typed)
- Compact projections for list tools (every leaked field is tokens in the agent's context)
- Tight Zod schemas with `.describe()` on every parameter
- Errors that name the next action ("use `swsd_list_users` first" rather than just "404")
- No new dependencies without strong justification (each one expands the supply-chain surface)

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
npm run build      # compile TypeScript to dist/
npm test           # run unit tests (vitest)
npm run lint       # eslint
npm run typecheck  # tsc --noEmit

# Run against your own tenant
export SWSD_TOKEN="your-token"
export SWSD_BASE_URL="https://api.samanage.com"
npm run inspect:stdio
```

## Code of conduct

Be kind, be patient, be specific. We're all just trying to make a tool that helps.
