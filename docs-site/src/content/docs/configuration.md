---
title: Configuration
description: Environment variables, profiles, and tool selection for swsd-mcp.
---

All configuration is via environment variables. Most users only need to set `SWSD_TOKEN` and `SWSD_BASE_URL`; see [Quick start](/quickstart/). This page is the full reference.

## Essential

| Variable | Default | Notes |
|---|---|---|
| `SWSD_TOKEN` | _(required for stdio)_ | Your SWSD admin token (JWT). For HTTP transport, pass per-request via the `Authorization` or `X-SWSD-Token` header instead. |
| `SWSD_BASE_URL` | `https://api.samanage.com` | EU tenant: `https://apieu.samanage.com`. SSRF defense: must be on the `samanage.com` domain: other URLs are rejected at startup. |
| `SWSD_PROFILE` | `agent` | Tool set: `triage`, `agent`, `knowledge`, `operations`, or `custom`. See [Profiles](#profiles) below. |
| `SWSD_TOOLS` | _(empty)_ | With `custom`, comma-separated tool names, trimmed and deduplicated; unioned with the file selection. |
| `SWSD_PROFILE_FILE` | _(empty)_ | With `custom`, a local JSON profile path, absolute or relative to the startup working directory. |

## Advanced (HTTP transport only)

These only apply when `SWSD_TRANSPORT=http`. They have no effect in stdio mode.

| Variable | Default | Notes |
|---|---|---|
| `SWSD_TRANSPORT` | `stdio` | Set to `http` for hosted/Copilot Studio deployments |
| `PORT` | `3000` | HTTP listen port |
| `SWSD_TRUST_PROXY` | `false` | Set to `1` behind Azure App Service / Nginx; `2` behind Cloudflare → App Service. Required for accurate `req.ip` (rate limiting depends on it). |
| `SWSD_ALLOWED_ORIGINS` | _(empty)_ | Comma-separated exact origins. Empty = only loopback origins are accepted; requests without an `Origin` header are unaffected. List browser-based client origins explicitly. |
| `SWSD_ALLOWED_HOSTS` | _(empty)_ | Comma-separated exact `Host` header values. Empty = no Host restriction. Does not change the listen address. |
| `SWSD_RATE_LIMIT_WINDOW_MS` | `60000` | Rate-limit window in milliseconds |
| `SWSD_RATE_LIMIT_MAX` | `100` | Max requests per window per `(token, IP)` pair (token is sha256-hashed for memory safety) |

## Reliability

| Variable | Default | Notes |
|---|---|---|
| `SWSD_RETRY_MAX_ATTEMPTS` | `3` | Auto-retry attempts for 5xx and network errors on read-only requests. Writes are never retried (would risk duplicate side effects). |
| `SWSD_REQUEST_TIMEOUT_MS` | `30000` | Per-request timeout for outbound SWSD calls. Hung connections waste worker resources; this caps the wait. |

## Other

| Variable | Default | Notes |
|---|---|---|
| `SWSD_API_VERSION` | `v2.1` | Override only if your tenant requires v1.1 (rare) |
| `SWSD_WRITE_MODE` | `live` | Write safety mode: `live` calls SWSD normally, `dry-run` returns the request payload without sending the write, and `disabled` rejects write tools. Read-only tools are unaffected. |
| `SWSD_ATTACHMENT_ROOT` | _(empty)_ | Optional real-path boundary for `swsd_upload_attachment` when using `file_path` in stdio mode. Symlinks are resolved before containment is checked. Empty preserves unrestricted local stdio file uploads. It has no effect on base64 or HTTP uploads. |
| `SWSD_ENABLE_EXTRAS` | _(empty)_ | Comma-separated extra tool names to enable on top of the profile. Unknown names cause a startup error (loud-fail by design). |

The complete annotated example is in [`.env.example`](https://github.com/mikimatsub/swsd-mcp/blob/main/.env.example) on GitHub.

## Profiles

Profiles control which tools are registered at startup. The choice is made once at startup and **cannot be changed mid-session**: restart the server to switch.

| Profile | Intent | Tool count |
|---|---|---|
| `triage` | Read-heavy first-line support workflow + commenting + read-only task/problem visibility | 21 |
| `agent` | Full ticket-handler workflow + KB lookups + custom-field introspection + service-catalog + tasks + problems + work logs/attachments (default) | 51 |
| `knowledge` | KB-author workflow + incident reads + custom-field introspection | 17 |
| `operations` | Agent workflow plus change/release, ITAM, CMDB, procurement, and risk context, plus every KB authoring tool | 145 |
| `custom` | Explicit selection from the tool list or a JSON profile file | Varies |

`operations` includes every tool, including KB authoring and guarded deletes. Existing `SWSD_PROFILE=full` configurations map to `operations` and emit one deprecation notice on stderr per process.

### When to pick which

- **`triage`**: first-line support agents who read tickets and post comments but don't reassign or close. Minimal write surface.
- **`agent`** (default): full incident-handling: create, update, assign, state-transition, link solutions, plus comment writes, KB lookups, work logs, and attachments. The most common choice.
- **`knowledge`**: KB authors who need full solution CRUD plus incident reads for context. No incident writes.
- **`operations`**: agents who also need ITSM lifecycle and operational context: changes, releases, assets, CMDB records, contracts, purchase orders, vendors, and risks. It includes all 145 tools, including KB authoring and guarded deletes.

### Adding individual tools to a profile

Use `SWSD_ENABLE_EXTRAS` to add specific tools on top of the chosen profile:

```bash
SWSD_PROFILE=triage
SWSD_ENABLE_EXTRAS=swsd_search_solutions,swsd_get_solution
```

This gives you the `triage` profile **plus** solution lookups: handy when first-line support needs to reference KB articles. Unknown tool names cause a startup error so typos don't silently expand or contract the registered set.

Delete tools require `operations` or explicit inclusion in a custom profile's CSV/file. `SWSD_ENABLE_EXTRAS` cannot add deletes to other profiles, or add an unselected delete to `custom`.

### Custom profiles

Choose `custom` when the built-in sets do not match the deployment. Supply either source, or both to union their tool names:

```bash
SWSD_PROFILE=custom
SWSD_TOOLS="swsd_get_server_info, swsd_list_incidents"
SWSD_PROFILE_FILE=./profiles/desk.json
```

```json
{
  "name": "Synthetic desk",
  "version": 1,
  "description": "Incident lookup and SLA review",
  "tools": ["swsd_get_incident", "swsd_sla_risk"]
}
```

CSV whitespace is trimmed and duplicate names collapse into one registration. Unknown names from either source are listed in a stderr warning and skipped. No tools are automatically added; an empty valid union fails startup, even if extras are set. `SWSD_TOOLS` and `SWSD_PROFILE_FILE` only select tools in `custom` mode.

The file is read once at startup as JSON, never imported or evaluated. Paths resolve relative to the startup working directory (absolute paths also work), symlinks are resolved, and only regular files of at most 256 KiB are accepted. Missing or unreadable files, malformed JSON, unsupported versions, and invalid fields fail startup before HTTP begins listening.

File rules are published in [`schemas/swsd-profile.schema.json`](https://github.com/mikimatsub/swsd-mcp/blob/main/schemas/swsd-profile.schema.json): required `name` (1–80 letters, digits, spaces, `_`, `.`, `-`, starting with a letter or digit), `version: 1`, optional `description` (up to 2,048 characters), and `tools` (up to 512 entries of 1–128 characters each). Extra properties are rejected. The combined CSV/file input also accepts at most 512 entries before deduplication. The schema validates the file shape; unknown tool names and the nonempty combined selection are checked at startup.

Prompts require all their playbook tools. Widgets require all tools they use: the catalog form requires `swsd_get_catalog_item` and `swsd_create_service_request`, so a lookup-only selection returns text and structured data without an unusable Submit form. The remaining widgets accompany their selected read tools. Restart to apply any environment or file change.

To include a delete tool, list its exact name in the custom CSV or file. The tool still requires its dry-run preview, `confirm: true`, and a matching `confirm_id` before deleting; `SWSD_WRITE_MODE` and tenant permissions remain in force.

## Verifying configuration at startup

**Stdio mode is intentionally silent on stdout**: the MCP transport multiplexes JSON-RPC over stdout, so the server cannot print human-readable banners there. To verify configuration in stdio mode, call the `swsd_get_server_info` tool from your MCP client; it returns the active profile, base URL, version, transport, and full tool list as a structured response.

**HTTP mode** prints a single startup line on stderr (no token leakage):

```
swsd-mcp 2.2.0 HTTP transport listening on :3000 (POST /mcp, GET /healthz; rate limit 100/60s, request timeout 30s)
```

In HTTP mode, hit `GET /healthz` for `{"ok":true}` (deliberately minimal: no version disclosure to anonymous callers) or call `swsd_get_server_info` through an authenticated MCP client for full configuration details.
