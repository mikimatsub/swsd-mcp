---
title: Architecture
description: How swsd-mcp connects MCP clients to the SolarWinds Service Desk API across two transports, with zero credentials at rest.
---

swsd-mcp is a thin, stateless wrapper around SolarWinds Service Desk's REST API, exposed via the Model Context Protocol. The whole system consists of three boxes (a client, the MCP server, and the upstream API) connected by two possible transports.

## Request flow

```d2
direction: down

local: "Local MCP clients\n(Claude Desktop, Code, Cursor, Continue)" {
  shape: rectangle
}

hosted: "Hosted MCP clients\n(Microsoft Copilot Studio)" {
  shape: rectangle
}

mcp: "swsd-mcp\n(zero credentials at rest)" {
  shape: rectangle
  style.bold: true
}

api: "SWSD REST API\n(api.samanage.com)" {
  shape: cylinder
}

local -> mcp: "stdio transport\nnpx subprocess\ntoken in env var"
hosted -> mcp: "Streamable HTTP\nAuthorization header\ntoken per request"
mcp -> api: "HTTPS\nforwards user's token\n(never persisted, never logged)"
```

## The three boxes

### MCP clients

Two categories, distinguished by where the swsd-mcp process actually runs:

- **Local clients**: Claude Desktop, Claude Code, Cursor, Continue, Cline. Each spawns swsd-mcp as a child process via `npx swsd-mcp`. Communication is over stdio (stdin/stdout JSON-RPC). The user's SWSD token is provided via the `SWSD_TOKEN` environment variable in the MCP config.

- **Hosted clients**: Microsoft Copilot Studio, custom HTTP clients. These can't spawn local processes, so swsd-mcp runs as a long-lived HTTP server somewhere accessible (the [Deployment](/deployment/) guide covers Azure Container Apps). Each request includes the user's token in the `Authorization: Bearer <token>` or `X-SWSD-Token: <token>` header.

### swsd-mcp

The middle box. Single Node.js process, TypeScript, seven direct production dependencies (`@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`, `dompurify`, `express`, `express-rate-limit`, `helmet`, `zod`). Exposes [66 tools](/tools/) organized into [profiles](/configuration/#profiles).

The server itself has no SWSD identity: every API call is made using the *caller's* token. The token exists in process memory only for the lifetime of a single request. There's no token cache, no session store, no persistence layer. See [Security → Zero credentials at rest](/security/#zero-credentials-at-rest).

### SWSD REST API

The upstream. `api.samanage.com` for US tenants, `apieu.samanage.com` for EU. Shared endpoint: tenant identity rides in the JWT, not in the URL. Custom domains like `support.yourcompany.com` are vanity CNAMEs for the SWSD web UI only; the API endpoint is the regional one.

The `SWSD_BASE_URL` env var is validated at startup against `*.samanage.com`. SSRF defense: if an attacker ever influences the env var, they can't redirect tokens to a server they control.

## Transport choice

The transport you pick depends entirely on the client's capability:

| If your client... | Use transport | Why |
|---|---|---|
| Spawns local subprocesses (Claude Desktop, Code, Cursor, Continue, Cline) | **stdio** | Simplest, no hosting, each user's token stays local |
| Can only call HTTP endpoints (Copilot Studio, custom integrations) | **Streamable HTTP** | Required because the client can't spawn the server itself |
| You want one shared instance for a team | **Streamable HTTP** | Many users, one deploy, each providing their own token per request |

Both transports run the same tool handlers and produce identical results: the wire protocol is the only difference.

## Request lifecycle

What happens when an MCP client calls a tool like `swsd_list_incidents`:

1. **Client packages the call** as MCP JSON-RPC: `{ "method": "tools/call", "params": { "name": "swsd_list_incidents", "arguments": {...} } }`
2. **Transport delivers it**: stdin (stdio) or POST `/mcp` body (HTTP)
3. **swsd-mcp validates** input via [Zod](https://zod.dev/) schemas (tight types, descriptive errors)
4. **Token resolution**: `SWSD_TOKEN` env var (stdio) or request header (HTTP)
5. **Outbound request** to SWSD with the resolved token, 30-second timeout, automatic retry on 5xx for read-only calls
6. **Response mapping**: SWSD's full payload is projected into a compact, agent-friendly shape (every field that lands in the agent's context is tokens spent)
7. **Structured MCP response** returned to the client, with both human-readable text and structured data

For HTTP transport specifically, additional steps run between (2) and (3): rate-limit check (per-`(token, IP)` hashed key), `Origin` header validation against allowlist, and Express trust-proxy resolution for accurate `req.ip`.

## What's intentionally not in this picture

- **No backing store.** swsd-mcp has no database, no Redis, no file cache. Restarting the process loses nothing because there's nothing to lose.
- **No queueing.** Every tool call is synchronous request → SWSD → response. Long-running operations are SWSD's problem, not ours.
- **No multi-tenant routing.** The server is single-tenant: your `SWSD_BASE_URL` is the one tenant it talks to. Multi-tenancy happens by running multiple instances, not by routing within one.
- **No webhook ingress.** swsd-mcp is purely a request-response server. SWSD doesn't push events to it.

These are deliberate constraints: they keep the attack surface small, the operational story trivial, and the deployment cost near-zero.

## See also

- [Configuration](/configuration/): the env vars that tune transport, profiles, retry, and rate-limit behavior
- [Security](/security/): the threat model, supply-chain controls, and standards alignment
- [Deployment](/deployment/): Docker, Azure Container Apps, and Copilot Studio setup
