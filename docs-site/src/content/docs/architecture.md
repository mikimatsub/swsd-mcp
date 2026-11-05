---
title: Architecture
description: How swsd-mcp connects MCP clients to the SolarWinds Service Desk API across stdio and Streamable HTTP transports.
---

swsd-mcp is a thin wrapper around the SWSD REST API, exposed via the Model Context Protocol. The whole system consists of three boxes (a client, the MCP server, and the upstream API) connected by two possible transports.

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

The middle box. Single Node.js process, TypeScript, 11 direct production dependencies (`@hono/node-server`, `@modelcontextprotocol/client`, `@modelcontextprotocol/core`, `@modelcontextprotocol/node`, `@modelcontextprotocol/server`, `@modelcontextprotocol/ext-apps`, `dompurify`, `express`, `express-rate-limit`, `helmet`, `zod`). Exposes [145 tools](/tools/) organized into [profiles](/configuration/#profiles).

The server itself has no SWSD identity: every API call is made using the *caller's* token. HTTP creates a server and SWSD client per request without a session store. Stdio keeps the configured token for the process lifetime. The MCP server has no credential store; the Windows companion saves the user's JSON Web Token in Windows Credential Manager and supplies it to the local process. See [Security → Zero credentials at rest](/security/#zero-credentials-at-rest).

### SWSD REST API

The upstream. `api.samanage.com` for US tenants, `apieu.samanage.com` for EU. Each request uses the supplied user's JSON Web Token at the configured regional API URL.

The `SWSD_BASE_URL` env var is validated at startup: HTTPS on `samanage.com` or a subdomain, without embedded credentials. This restricts the configured upstream API URL.

## Transport choice

The transport you pick depends entirely on the client's capability:

| If your client... | Use transport | Why |
|---|---|---|
| Spawns local subprocesses (Claude Desktop, Code, Cursor, Continue, Cline) | **stdio** | Simplest, no hosting, no inbound HTTP listener is needed |
| Can only call HTTP endpoints (Copilot Studio, custom integrations) | **Streamable HTTP** | Required because the client can't spawn the server itself |
| You want one shared instance for a team | **Streamable HTTP** | Many users, one deploy, each providing their own token per request |

Both transports register the same profile-selected tool handlers. Local attachment paths are accepted only in stdio mode; HTTP clients supply base64 content.

## Request lifecycle

What happens when an MCP client calls a tool like `swsd_list_incidents`:

1. **Client packages the call** as MCP JSON-RPC: `{ "method": "tools/call", "params": { "name": "swsd_list_incidents", "arguments": {...} } }`
2. **Transport delivers it**: stdin (stdio) or POST `/mcp` body (HTTP)
3. **Token resolution**: `SWSD_TOKEN` env var (stdio) or request header (HTTP)
4. **swsd-mcp validates** input via [Zod](https://zod.dev/) schemas (tight types, descriptive errors)
5. **Outbound request** to SWSD with the resolved token, 30-second timeout per fetch attempt, automatic GET retries on 429, 5xx, and network/timeout errors
6. **Response mapping**: list payloads are projected into compact summaries; detail tools retain the record fields, with credential redaction
7. **Structured MCP response** returned to the client, with both human-readable text and structured data

For HTTP transport specifically, additional steps run between (2) and (3): rate limiting by hashed token and normalized IP, `Origin` and optional `Host` validation, and protocol-version checks. Express trust-proxy settings determine the client IP.

## What's intentionally not in this picture

- **No record backing store.** swsd-mcp has no database or record cache. UI HTML is cached in memory, and custom profile selections are read once per server. Restarting reloads configuration.
- **No background job queue.** Tool handlers await SWSD requests and return results; no durable work queue is maintained.
- **One configured upstream URL.** Requests use the same `SWSD_BASE_URL` with each caller's token. A separate instance is needed for a different regional API URL.
- **No webhook ingress.** swsd-mcp is purely a request-response server. SWSD doesn't push events to it.

These are deliberate constraints: they keep the attack surface small, the operational story trivial, and the deployment requirements small.

## See also

- [Configuration](/configuration/): the env vars that tune transport, profiles, retry, and rate-limit behavior
- [Security](/security/): the threat model, supply-chain controls, and standards alignment
- [Deployment](/deployment/): Docker, Azure Container Apps, and Copilot Studio setup
