<!--
Thanks for contributing! A few notes before you fill this in:

- Small, focused PRs are easier to review than big ones. If your change touches multiple
  unrelated areas, consider splitting it.
- See CONTRIBUTING.md for the full review criteria.
- Security-sensitive changes? Mention it explicitly so we can give them extra eyes.
-->

## What changed

<!-- One or two sentences describing the change. -->

## Why

<!-- The motivation: bug being fixed, use case being enabled, debt being paid down.
     Link to issues with "Closes #123" / "Fixes #456" if applicable. -->

## How to verify

<!-- A reviewer should be able to follow these steps to confirm the change works.
     Include commands, tool calls, expected outputs, etc. -->

- [ ] `npm run lint` passes
- [ ] `npm run typecheck` passes
- [ ] `npm test` passes
- [ ] (if touching tools) tested against a live SWSD tenant: describe what you ran
- [ ] (if touching the HTTP transport) Docker smoke test still passes
- [ ] (if changing public behavior) README / docs updated

## Anything reviewers should know

<!-- Tradeoffs, follow-ups deferred, surprising decisions, areas you're least sure about. -->
