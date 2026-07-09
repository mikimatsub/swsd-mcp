# swsd-mcp

[![CI](https://github.com/mikimatsub/swsd-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/mikimatsub/swsd-mcp/actions/workflows/ci.yml)
[![Security](https://github.com/mikimatsub/swsd-mcp/actions/workflows/security.yml/badge.svg)](https://github.com/mikimatsub/swsd-mcp/actions/workflows/security.yml)
[![npm version](https://img.shields.io/npm/v/swsd-mcp.svg)](https://www.npmjs.com/package/swsd-mcp)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-io.github.mikimatsub%2Fswsd-blue)](https://registry.modelcontextprotocol.io/v0.1/servers?search=io.github.mikimatsub/swsd)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Provenance](https://img.shields.io/badge/Provenance-SLSA-blue.svg)](https://www.npmjs.com/package/swsd-mcp)

**MCP server for SolarWinds Service Desk (SWSD / Samanage).** Works with any [Model Context Protocol](https://modelcontextprotocol.io) client to read and modify SWSD tickets, comments, knowledge-base articles, and more, using each user's own SWSD API token. See the [client compatibility matrix](https://mcp-swsd.pages.dev/compatibility/) for the tested list.

📖 **Full docs:** [mcp-swsd.pages.dev](https://mcp-swsd.pages.dev)

The server holds **zero credentials at rest**. Tokens are forwarded per-request, never persisted, never logged, and only sent to the configured SWSD API host.

---

## Quick start

You need:

- An MCP client installed — any MCP-compatible client works ([compatibility matrix](https://mcp-swsd.pages.dev/compatibility/))
- A SolarWinds Service Desk **admin token (JWT)** — generate one in the SWSD UI: **Setup → Users & Groups → Users** → click your user → **Actions** → **Generate JSON Web Token** (Service Desk administrator rights required)

### 1. Add the config

Every stdio-capable MCP client uses the same JSON shape. Add this under `mcpServers` in your client's config file:

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

Replace `your-jwt-here` with your token. EU tenants use `https://apieu.samanage.com` instead. To customize behavior, add any [configuration variable](https://mcp-swsd.pages.dev/configuration/) (most common: `SWSD_PROFILE` to choose the tool set) into the same `env` block.

### 2. Drop it in the right file

| Client | Config file path |
|---|---|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Desktop (Linux) | `~/.config/Claude/claude_desktop_config.json` |
| Claude Code | `~/.claude.json` (or use the shortcut below) |
| Cursor | `~/.cursor/mcp.json` |
| Continue, Cline, other clients | check your client's docs — same JSON shape |

Create the file if it doesn't exist. Then restart your client.

**Claude Code shortcut** — skip editing the file by hand. This single line pastes verbatim into any shell (bash, zsh, PowerShell, cmd):

```bash
claude mcp add swsd --env SWSD_TOKEN="your-jwt-here" --env SWSD_BASE_URL="https://api.samanage.com" -- npx -y swsd-mcp
```

**Microsoft Copilot Studio** — different path. Copilot Studio can't spawn local processes, so it needs an HTTP-transport server. See [`copilot-studio/README.md`](./copilot-studio/README.md) and the [Azure Container Apps recipe](./docs/deployment/azure-container-apps.md).

### 3. Verify it works

In your MCP client, ask:

> _"Use swsd to check if you can connect."_

The agent should call `swsd_health_check` and report success. If it does, you're set up. Try a few more:

- _"Show me incident 60310"_ — id-keyed tools accept either the internal id (≥7 digits) or the human-facing number visible in the SWSD UI (≤6 digits).
- _"List incidents updated in the last 7 days"_ — `updated_within: "7d"` (also `"24h"`, `"1w"`, `"30d"`).
- _"What tickets are assigned to me?"_ — `swsd_list_my_incidents` calls `swsd_get_me` internally, so you don't have to spell out an email.

---

## Tools (66 across 15 categories)

| Category | Tools |
|---|---|
| **Utility** | `swsd_get_server_info`, `swsd_health_check`, `swsd_get_me` |
| **Incidents** | `swsd_list_incidents`, `swsd_list_my_incidents`, `swsd_get_incident`, `swsd_create_incident`, `swsd_update_incident`, `swsd_assign_incident`, `swsd_update_incident_state`, `swsd_link_solution_to_incident` |
| **Comments** | `swsd_list_incident_comments`, `swsd_add_incident_comment`, `swsd_update_comment` |
| **Tasks** | `swsd_list_incident_tasks`, `swsd_create_incident_task`, `swsd_update_task_state` |
| **Problems** | `swsd_list_problems`, `swsd_get_problem`, `swsd_create_problem` |
| **Change & Release** | `swsd_list_changes`, `swsd_get_change`, `swsd_create_change`, `swsd_update_change`, `swsd_list_releases`, `swsd_get_release`, `swsd_create_release`, `swsd_update_release` |
| **Assets & CMDB** | `swsd_list_hardware_assets`, `swsd_get_hardware_asset`, `swsd_list_mobile_devices`, `swsd_get_mobile_device`, `swsd_list_printers`, `swsd_get_printer`, `swsd_list_software_assets`, `swsd_get_software_asset`, `swsd_list_other_assets`, `swsd_get_other_asset`, `swsd_list_configuration_items`, `swsd_get_configuration_item` |
| **Procurement & Risk** | `swsd_list_contracts`, `swsd_get_contract`, `swsd_list_purchase_orders`, `swsd_get_purchase_order`, `swsd_list_vendors`, `swsd_get_vendor`, `swsd_list_risks` |
| **Time tracking** | `swsd_list_time_tracks`, `swsd_log_time`, `swsd_update_time_track` |
| **Attachments** | `swsd_upload_attachment` |
| **Solutions / KB** | `swsd_search_solutions`, `swsd_get_solution`, `swsd_create_solution`, `swsd_update_solution` |
| **Service Catalog** | `swsd_list_catalog_items`, `swsd_get_catalog_item`, `swsd_create_service_request` |
| **Lookups** | `swsd_list_categories`, `swsd_list_sites`, `swsd_list_departments`, `swsd_list_users`, `swsd_list_groups`, `swsd_list_roles` |
| **Custom fields** | `swsd_describe_custom_fields` |
| **Audits** | `swsd_get_record_audits` |

Each tool's input schema, description, and output shape is auto-discovered by your MCP client at runtime. See the [Tools reference](https://mcp-swsd.pages.dev/tools/) for full per-tool documentation.

---

## MCP Apps widgets (rich UI)

Seven read tools ship interactive UI bundles using the [MCP Apps capability](https://modelcontextprotocol.io/specification/2025-11-25). On capable hosts (Claude Desktop, Claude Web, VS Code Copilot Chat, ChatGPT, Goose, Postman), the tool returns a rendered widget alongside the structured response. On text-only hosts (Claude Code, LM Studio), the same tools return their normal structured payload.

![incident-list widget rendering a sortable table of synthetic Acme Corp tickets](docs-site/public/widgets/incident-list-dark.png)

*Example — `swsd_list_incidents` rendering the `incident-list` widget. Synthetic data; no real tenant info. See the [full gallery](https://mcp-swsd.pages.dev/widgets/) for screenshots of all seven widgets.*

| Tool | Widget | What it renders |
|---|---|---|
| `swsd_get_incident` | `incident-detail` | Single-record card (description, due date, SLA, resolution, custom fields) |
| `swsd_get_solution` | `solution-detail` | Knowledge-base article with sanitized HTML body |
| `swsd_list_incidents`, `swsd_list_my_incidents` | `incident-list` | Filterable, sortable table |
| `swsd_list_incident_comments` | `comment-thread` | Vertical conversation with author chips, public/private badges |
| `swsd_get_record_audits` | `audit-timeline` | Timeline grouped by day with action chips and field diffs |
| `swsd_get_catalog_item` | `catalog-item-form` | Form that submits via `swsd_create_service_request` |
| `swsd_describe_custom_fields` | `custom-fields` | Searchable explorer with scope/module filters |

See the [Widgets reference](https://mcp-swsd.pages.dev/widgets/) for screenshots and per-widget detail.

---

## Configuration

Most users only need `SWSD_TOKEN` and `SWSD_BASE_URL`:

| Variable | Default | Notes |
|---|---|---|
| `SWSD_TOKEN` | — | Required. Your SWSD admin token (JWT). |
| `SWSD_BASE_URL` | `https://api.samanage.com` | EU tenant: `https://apieu.samanage.com` |
| `SWSD_PROFILE` | `agent` | `triage`, `agent`, `knowledge`, `operations`, or `full` — see [Profiles](https://mcp-swsd.pages.dev/configuration/#profiles) |

For the full env-var reference (HTTP transport, retries, rate limits, allowlists), see [Configuration](https://mcp-swsd.pages.dev/configuration/).

---

## Profiles

Profiles control which tools are registered at startup. Cannot be changed mid-session.

| Profile | Intent | Tool count |
|---|---|---|
| `triage` | Read-heavy first-line support + commenting | 14 |
| `agent` | Full ticket-handler workflow (default) | 37 |
| `knowledge` | KB-author workflow + incident reads | 15 |
| `operations` | Agent workflow plus change/release, ITAM, CMDB, procurement, and risk context | 64 |
| `full` | Every tool | 66 |

Use `SWSD_ENABLE_EXTRAS=swsd_foo,swsd_bar` to add specific tools on top of a profile.

---

## Hosting an HTTP server (advanced)

Quick Start above runs swsd-mcp on your own machine — your MCP client spawns it on demand via `npx`. **Most users stop there.**

Set up an HTTP-mode server only if you need:

- **Microsoft Copilot Studio integration** — Copilot Studio can't spawn local processes
- **One shared instance for a team** — one deploy, many users, each providing their own token per-request
- **Stricter network control** — private VNet, IP allowlist, custom domain

The Docker image runs anywhere — Azure, AWS, GCP, Render, Fly.io, your own VM. See [Deployment](https://mcp-swsd.pages.dev/deployment/) for the full guide and the [Azure Container Apps recipe](./docs/deployment/azure-container-apps.md) (recommended for Copilot Studio; scale-to-zero pricing).

---

## Documentation

- [`SECURITY.md`](./SECURITY.md) — vulnerability reporting via GitHub Security Advisories
- [`docs/SECURITY-POSTURE.md`](./docs/SECURITY-POSTURE.md) — security controls, supply-chain hardening, verification methods
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — bug reports, PR review criteria, local development setup
- [`CHANGELOG.md`](./CHANGELOG.md) — version history
- [`copilot-studio/`](./copilot-studio/) — Microsoft Copilot Studio Swagger connector specs and import guide
- [`docs/deployment/`](./docs/deployment/) — cloud deployment recipes

---

## License

MIT — see [LICENSE](./LICENSE). Provided "as is" without warranty.

## Trademarks

SolarWinds, Samanage, and Service Desk are trademarks of SolarWinds Worldwide, LLC. This project is not affiliated with, endorsed by, or sponsored by SolarWinds. It wraps the publicly documented SWSD REST API.
