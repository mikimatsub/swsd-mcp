---
title: Quick start
description: Install and configure swsd-mcp in an MCP client.
---

This guide gets swsd-mcp running locally via `npx`. For Microsoft Copilot Studio, see [Deployment → Copilot Studio](/deployment/#microsoft-copilot-studio), which uses the HTTP transport and requires a different setup.

## What you need

- An MCP client installed with stdio or Streamable HTTP support ([client compatibility matrix](/compatibility/))
- Node.js 24.15+ or Node.js 26+ (for `npx`). Node 25 is not supported.
- An SWSD **JSON Web Token**: see below

## Get an SWSD JSON Web Token

In the SWSD web UI, navigate:

1. **Setup → Users & Groups → Users**
2. Click your user to open the detail page
3. Under **JSON Web Token**, choose **Copy** (or **Show Token**, then **Copy**)
4. If no token is shown, click **Actions → Generate JSON Web Token**, then copy it

:::caution[SWSD administrator rights required to generate a token]
If the Generate action is unavailable, ask your SWSD administrator for help. SWSD account permissions determine what the token can access.
:::

## Install in VS Code

1. Open the Command Palette with **Ctrl+Shift+P** on Windows/Linux or **Shift+Command+P** on macOS.
2. Run **MCP: Add Server...**.

<img src="/vscode/vscode-command-palette-add-server.png" alt="MCP: Add Server in the VS Code Command Palette" width="600" height="85" loading="lazy" />

Choose one of these four routes.

### Command (stdio)

This is the recommended local install.

1. Select **Command (stdio)**.
2. Enter `npx -y swsd-mcp`.

   <img src="/vscode/vscode-stdio-command.png" alt="The swsd-mcp stdio command entered in VS Code" width="600" height="91" loading="lazy" />

3. Enter `swsd` as the server name.
4. Choose **Global** to use it throughout the current VS Code profile, or **Workspace** to add it to the current project's `.vscode/mcp.json`.
5. Apply the [secure token configuration](#secure-vs-code-token-configuration) below.

### NPM Package

1. Select **NPM Package**.
2. Enter `swsd-mcp`.
3. Check the confirmation carefully: the package must be **`swsd-mcp`** and the publisher must be **`mikimatsub`**. Select **Allow** only when both match.
4. Follow the prompts, choose **Global** or **Workspace**, and review the generated configuration before starting the server.
5. Make sure the token is handled as a password input, as shown below, rather than stored directly in JSON.

### HTTP

Use this only for an swsd-mcp instance that has already been deployed with HTTP transport. Select **HTTP (HTTP or Server-Sent Events)** and enter its full MCP endpoint, including `/mcp`, such as `https://swsd-mcp.example.com/mcp`. Do not enter this documentation site, the GitHub repository, the npm page, or the deployment's `/healthz` URL.

After choosing a name and scope, add the per-user token as an authorization header:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "swsd-token",
      "description": "SWSD JSON Web Token",
      "password": true
    }
  ],
  "servers": {
    "swsd": {
      "type": "http",
      "url": "https://swsd-mcp.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${input:swsd-token}"
      }
    }
  }
}
```

The deployment supplies `SWSD_BASE_URL`, `SWSD_PROFILE`, and the other server-side settings. See [Deployment](/deployment/) for the HTTP setup.

### Add from another application

Select **Add from another application...** to open the `chat.mcp.discovery.enabled` setting. Enable the source that already contains your working `swsd` server:

- Claude Desktop
- Windsurf
- Cursor global configuration
- Cursor workspace configuration

VS Code then discovers and reuses MCP server configurations from the selected source. Discovery is off by default. Review the discovered server before starting it, especially if the original configuration contains a token directly.

### Secure VS Code token configuration

For a Global install, run **MCP: Open User Configuration**. For a Workspace install, open `.vscode/mcp.json`. Replace the generated `swsd` entry with this configuration so VS Code requests the JWT as a password input instead of storing it in the file:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "swsd-token",
      "description": "SWSD JSON Web Token",
      "password": true
    }
  ],
  "servers": {
    "swsd": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "swsd-mcp"],
      "env": {
        "SWSD_TOKEN": "${input:swsd-token}",
        "SWSD_BASE_URL": "https://api.samanage.com"
      }
    }
  }
}
```

EU tenants should use `https://apieu.samanage.com` for `SWSD_BASE_URL`. A Workspace file containing this placeholder is safe to commit because the JWT itself is not in the JSON.

## Windows app

The Windows `swsd` plugin includes **SWSD for AI apps**.

1. Install the plugin, then start a new local chat and ask to set up SWSD on this computer.
2. In **Set up**, select **Install tools**. Node.js 24.15+ or Node.js 26+ is required, with npm. Node 25 is not supported.
3. Choose **United States** or **Europe**, paste your JSON Web Token, and select **Test**. Generate a token only when none is shown.
4. Choose a profile. Quit and reopen the AI app, then start a new chat.
5. Open the app again from **SWSD Setup** on the Start menu.

<figure class="win-figure">
  <img class="win-shot" src="/windows/home-appearance-light.png" alt="SWSD for AI apps Home on Windows. Acme IT is connected, the JSON Web Token is verified, Agent is active, an update is available, and the Appearance menu is open." width="1000" height="1350" />
  <figcaption>Home after Test, with Appearance open. The <a href="/windows/">Windows app guide</a> covers tool search, custom profile export and import, themes, updates, and diagnostics.</figcaption>
</figure>

## Other MCP clients

### Add the MCP config

Claude Desktop and Cursor use this JSON shape. Add the `swsd` entry inside the `mcpServers` object in your client's config file:

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
Any variable from the [Configuration](/configuration/) page goes into this same `env` block. The most common one to add is `SWSD_PROFILE` to switch from the default `agent` profile (51 tools) to `triage` (21), `knowledge` (17), `operations` (145), or `custom` (your selection):

```json
"env": {
  "SWSD_TOKEN": "your-jwt-here",
  "SWSD_BASE_URL": "https://api.samanage.com",
  "SWSD_PROFILE": "operations"
}
```

When testing write-heavy workflows, add `SWSD_WRITE_MODE: "dry-run"` to preview create/update payloads without sending write requests to SWSD. Set it to `disabled` when a deployment should remain read-only even if a write tool is present in the profile.
:::

### Find the right config file

| Client | Config file path |
|---|---|
| Claude Desktop (macOS) | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Claude Desktop (Windows) | `%APPDATA%\Claude\claude_desktop_config.json` |
| Claude Code | `~/.claude.json` (or use the [shortcut below](#claude-code-shortcut)) |
| Cursor | `~/.cursor/mcp.json` |
| Continue, Cline, other clients | check your client's docs for its configuration format |

Create the file if it doesn't exist. Then **restart your client** so it picks up the new server.

### Claude Code shortcut

Skip editing the file manually:

```bash
claude mcp add swsd --env SWSD_TOKEN="your-jwt-here" --env SWSD_BASE_URL="https://api.samanage.com" -- npx -y swsd-mcp
```

This saves a private, project-scoped entry in `~/.claude.json`. The [Claude Code MCP guide](https://code.claude.com/docs/en/mcp#local-scope) explains the available scopes and platform setup.

## Verify it works

In your MCP client, ask the agent:

> _"Use swsd to check if you can connect."_

The agent should call the `swsd_health_check` tool and report success. Once you see that, you're set up.

If something doesn't work, see [Configuration](/configuration/) for the full env-var reference and common troubleshooting.

## What you can do now

Try asking the agent things like:

- _"What tickets are assigned to me?"_ → calls `swsd_get_me` + `swsd_list_my_incidents` (the agent identifies you from the JWT, no manual email entry; renders the incident-list widget in MCP Apps-capable hosts)
- _"Show me incident 60310 with comments and audit trail."_ → calls `swsd_get_incident` + `swsd_list_incident_comments` + `swsd_get_record_audits`. Incident references accept either the internal id or the human-facing number visible in the SWSD UI.
- _"List incidents updated in the last 7 days."_ → uses `swsd_list_incidents` with `updated_within: "7d"` (also `"24h"`, `"1w"`, `"30d"`).
- _"What's blocking ticket 60310?"_ → calls `swsd_list_incident_tasks`.
- _"Search the knowledge base for 'VPN troubleshooting'."_ → calls `swsd_search_solutions`.
- _"What services can I request through the catalog?"_ → calls `swsd_list_catalog_items`.
- _"Submit a Software Request for Adobe Acrobat Pro."_ → calls `swsd_get_catalog_item` to read the form schema; in MCP Apps-capable hosts the catalog-item-form widget submits via `swsd_create_service_request` directly.
- _"What custom fields are available on incidents?"_ → calls `swsd_describe_custom_fields` (with a searchable explorer UI in capable hosts).
- _"Show changes planned this week and the affected configuration items."_ → use the `operations` profile to expose change/release plus CMDB tools.
- _"Preview creating a change for the weekend firewall update without writing it."_ → set `SWSD_WRITE_MODE=dry-run`, then call `swsd_create_change` to inspect the payload.

The full tool catalog is in [Tools reference](/tools/).

## Next steps

- **Tighten or expand the tool set**: see [Configuration](/configuration/#profiles) to switch from the default `agent` profile to `triage` (read-heavy), `knowledge` (KB authoring), `operations`, or `custom`
- **Hosting for a team**: see [Deployment](/deployment/) for the HTTP-transport setup
- **Microsoft Copilot Studio integration**: see [Deployment → Microsoft Copilot Studio](/deployment/#microsoft-copilot-studio)
