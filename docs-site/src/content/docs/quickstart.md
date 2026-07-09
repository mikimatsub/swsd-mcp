---
title: Quick start
description: Install and configure swsd-mcp in any MCP client in under five minutes.
---

This guide gets swsd-mcp running locally via `npx`. For Microsoft Copilot Studio, see [Deployment → Copilot Studio](/deployment/#microsoft-copilot-studio) — it uses HTTP transport, which is a different setup.

## What you need

- An MCP client installed — any MCP-compatible client works ([client compatibility matrix](/compatibility/))
- Node.js 24.15.0 or newer (for `npx`; current LTS line, matches `package.json` engines)
- A SolarWinds Service Desk **admin token** — see below

## Generate an SWSD admin token

In the SWSD web UI, navigate:

1. **Setup → Users & Groups → Users**
2. Click your user to open the detail page
3. Click **Actions → Generate JSON Web Token**
4. Copy the token (it's a long JWT string)

:::caution[Service Desk administrator rights required]
Only users with a Service Desk administrator license can generate tokens. If you don't have admin rights, your administrator needs to generate one for you. The token inherits *your* permissions — when your role changes, the token's permissions change with it.
:::

## Add the MCP config

Every stdio-capable MCP client uses the same JSON shape. Add this block under `mcpServers` in your client's config file:

```json
{
  "mcpServers": {
    "swsd": {
      "command": "npx",
      "args": ["-y", "swsd-mcp"],
      "env": {
        "SWSD_TOKEN": "your-jwt-here",
        "SWSD_BASE_URL": "https://api.samanage.com"
      }
    }
  }
}
```

Replace `your-jwt-here` with the token from the previous step. **EU tenants** use `https://apieu.samanage.com` instead.

:::tip[Customize behavior]
Any variable from the [Configuration](/configuration/) page goes into this same `env` block. The most common one to add is `SWSD_PROFILE` to switch from the default `agent` profile (37 tools) to `triage` (14), `knowledge` (15), `operations` (64), or `full` (66):

```json
"env": {
  "SWSD_TOKEN": "your-jwt-here",
  "SWSD_BASE_URL": "https://api.samanage.com",
  "SWSD_PROFILE": "full"
}
```
:::

## Find the right config file

| Client | Config file path |
|---|---|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Desktop (Linux) | `~/.config/Claude/claude_desktop_config.json` |
| Claude Code | `~/.claude.json` (or use the [shortcut below](#claude-code-shortcut)) |
| Cursor | `~/.cursor/mcp.json` |
| Continue, Cline, other clients | check your client's docs — same JSON shape |

Create the file if it doesn't exist. Then **restart your client** so it picks up the new server.

## Claude Code shortcut

Skip editing the file manually. This single line pastes verbatim into any shell (bash, zsh, PowerShell, cmd):

```bash
claude mcp add swsd --env SWSD_TOKEN="your-jwt-here" --env SWSD_BASE_URL="https://api.samanage.com" -- npx -y swsd-mcp
```

This writes the same config block as above to `~/.claude.json`.

## Verify it works

In your MCP client, ask the agent:

> _"Use swsd to check if you can connect."_

The agent should call the `swsd_health_check` tool and report success. Once you see that, you're set up.

If something doesn't work, see [Configuration](/configuration/) for the full env-var reference and common troubleshooting.

## What you can do now

Try asking the agent things like:

- _"What tickets are assigned to me?"_ → calls `swsd_get_me` + `swsd_list_my_incidents` (the agent identifies you from the JWT, no manual email entry; renders the incident-list widget in MCP Apps-capable hosts)
- _"Show me incident 60310 with comments and audit trail."_ → calls `swsd_get_incident` + `swsd_list_incident_comments` + `swsd_get_record_audits`. Id-keyed tools accept either the internal id or the human-facing number visible in the SWSD UI.
- _"List incidents updated in the last 7 days."_ → uses `swsd_list_incidents` with `updated_within: "7d"` (also `"24h"`, `"1w"`, `"30d"`).
- _"What's blocking ticket 60310?"_ → calls `swsd_list_incident_tasks` (sub-tasks new in v2.1).
- _"Search the knowledge base for 'VPN troubleshooting'."_ → calls `swsd_search_solutions`.
- _"What services can I request through the catalog?"_ → calls `swsd_list_catalog_items`.
- _"Submit a Software Request for Adobe Acrobat Pro."_ → calls `swsd_get_catalog_item` to read the form schema; in MCP Apps-capable hosts the catalog-item-form widget submits via `swsd_create_service_request` directly.
- _"What custom fields are available on incidents?"_ → calls `swsd_describe_custom_fields` (with a searchable explorer UI in capable hosts).

The full tool catalog is in [Tools reference](/tools/).

## Next steps

- **Tighten or expand the tool set** — see [Configuration](/configuration/#profiles) to switch from the default `agent` profile to `triage` (read-heavy), `knowledge` (KB authoring), `operations`, or `full`
- **Hosting for a team** — see [Deployment](/deployment/) for the HTTP-transport setup
- **Microsoft Copilot Studio integration** — see [Deployment → Microsoft Copilot Studio](/deployment/#microsoft-copilot-studio)
