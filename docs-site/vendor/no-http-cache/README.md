# Static-build image cache policy

This private, dependency-free adapter replaces `http-cache-semantics` only in
the documentation build. Astro 7.3.5 calls `storable()` and `timeToLive()` in
`dist/assets/build/remote.js`; the adapter always returns `false` and `0`.
Remote images expire immediately and must be revalidated. No request headers,
response bodies, cache-control directives, or credentials are retained.

This removes the unpatched dependency affected by
[GHSA-ch52-4w7c-c8xp](https://github.com/advisories/GHSA-ch52-4w7c-c8xp).
It implements the narrow interface used by this static docs build, not a
general HTTP cache. Tests exercise Astro's real remote-image functions before
every docs build. Revisit the adapter when upgrading Astro or when an upstream
fixed package is available. It is not part of the published MCP server package.
