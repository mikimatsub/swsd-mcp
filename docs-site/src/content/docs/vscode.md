---
title: VS Code
description: Install swsd-mcp in VS Code from every option in the MCP Add Server picker.
---

This guide was last verified on **July 17, 2026** with **VS Code 1.124.0**, the current `swsd-mcp` npm package, and the current [VS Code MCP documentation](https://code.visualstudio.com/docs/agent-customization/mcp-servers). VS Code calls the menu below the **Command Palette**; there is no separate MCP “Dev menu.”

## Before you start

You need:

- VS Code with Chat/Copilot MCP support enabled
- Node.js `>=24.15.0 <25` for the local `npx` routes (the package's current supported engine range)
- An SWSD administrator JWT from **Setup → Users & Groups → Users → your user → Actions → Generate JSON Web Token**

Local MCP servers execute code on your machine. Review the package, publisher, and generated configuration before starting one.

## Open the Add Server picker

1. Open the Command Palette with **Ctrl+Shift+P** on Windows/Linux or **Shift+Command+P** on macOS.
2. Run **MCP: Add Server...**.

<img src="/vscode/vscode-command-palette-add-server.png" alt="VS Code Command Palette filtered to MCP: Add Server" width="602" height="112" loading="lazy" />

3. Choose one of the seven formats shown by the current picker.

<img src="/vscode/vscode-add-server-formats.png" alt="VS Code MCP Add Server picker showing Command, HTTP, NPM, Pip, Docker, import, and gallery options" width="602" height="194" loading="lazy" />

4. When prompted for the configuration target, choose:
   - **Global** to make the server available in every workspace in the current VS Code profile.
   - **Workspace** to write `.vscode/mcp.json` in the current project. This file can be shared, but never put a literal JWT in it.
   - When connected to SSH, WSL, or a dev container, use **MCP: Open Remote User Configuration** if the server should run in that remote environment.

:::note[Manifest installation is a separate command]
**MCP: Install Server from Manifest...** can appear beside Add Server in the Command Palette, but it is not an eighth Add Server format. The seven options pictured above are the complete current Add Server picker.
:::

## Which format should I choose?

| Picker option | Support | Best use |
|---|---|---|
| **Command (stdio)** | Recommended | Run the published npm package locally with `npx` |
| **HTTP (HTTP or Server-Sent Events)** | Supported for deployments | Connect to an already-running swsd-mcp HTTP endpoint |
| **NPM Package** | Supported | Let VS Code resolve the npm package and propose a configuration |
| **Pip Package** | Not applicable | swsd-mcp is not published to PyPI |
| **Docker Image** | Use an alternate route | The published image defaults to HTTP, while this picker path expects a local stdio server |
| **Add from another application...** | Supported when detected | Import an existing swsd-mcp config from another MCP client |
| **Browse MCP Servers...** | Supported when listed | Find the MCP Registry entry in VS Code's MCP gallery |

## Command (stdio) — recommended

1. Select **Command (stdio)**.
2. Enter `npx -y swsd-mcp`.
3. Enter `swsd` as the server name.
4. Choose **Global** or **Workspace**.
5. Open the target `mcp.json` and replace the generated `swsd` entry with the [secure configuration](#secure-vs-code-configuration) below.

This is the most predictable path: VS Code launches the package on demand and communicates with it over standard input/output.

## NPM Package

1. Select **NPM Package**.
2. Enter `swsd-mcp` (no version is required; VS Code resolves the current npm release).
3. Review the confirmation. The publisher must be **`mikimatsub`** and the package must be **`swsd-mcp`**. Select **Allow** only when both match.
4. Choose **Global** or **Workspace** when prompted.
5. Inspect the generated `mcp.json`. The launch must resolve to `npx` plus `swsd-mcp`; then apply the [secure configuration](#secure-vs-code-configuration).

The picker labels this route **Model-Assisted**, so the proposed JSON can change as VS Code evolves. The known-good configuration below is the source of truth.

## HTTP (HTTP or Server-Sent Events)

Use this option only after deploying swsd-mcp with `SWSD_TRANSPORT=http`. Enter the complete MCP endpoint, including `/mcp`, such as `https://swsd-mcp.example.com/mcp`. Do not enter the documentation site, npm page, GitHub repository, or `/healthz` URL.

After choosing a name and scope, configure the per-user SWSD token as a header:

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "swsd-token",
      "description": "SolarWinds Service Desk admin JWT",
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

VS Code tries Streamable HTTP first and can fall back to SSE. The deployment controls `SWSD_BASE_URL`, `SWSD_PROFILE`, and other server-side settings; see [Deployment](/deployment/).

## Pip Package

Do not use this option for swsd-mcp. It is a Node.js package published to npm, not a Python package published to PyPI. Use **Command (stdio)** or **NPM Package** instead.

## Docker Image

Do not enter `ghcr.io/mikimatsub/swsd-mcp:latest` directly in the Docker Image wizard. The published image intentionally defaults to HTTP transport, while VS Code's local image route expects a foreground stdio process.

Use one of these supported patterns instead:

- **Hosted/local HTTP:** start the container using the [Docker deployment instructions](/deployment/#docker), then choose **HTTP** and enter `http://localhost:3000/mcp` (or the deployed HTTPS URL).
- **Containerized stdio:** choose **Command (stdio)** and enter:

  ```text
  docker run --rm -i -e SWSD_TRANSPORT=stdio -e SWSD_TOKEN -e SWSD_BASE_URL -e SWSD_PROFILE -e SWSD_WRITE_MODE ghcr.io/mikimatsub/swsd-mcp:latest
  ```

  Then use the same `inputs` and `env` values from the secure configuration below. Keep the container in the foreground (`-i`, without `-d`) so VS Code can use its standard input/output stream. For production, pin an immutable `sha-...` image tag instead of `latest`.

## Add from another application

Use this when VS Code discovers a working `swsd` configuration from another MCP client:

1. Select **Add from another application...**.
2. Choose the detected application and its `swsd` server.
3. Choose **Global** or **Workspace**.
4. Review the imported command, arguments, environment variables, and target scope before starting it.
5. If the source config contains a literal token, replace it with `${input:swsd-token}` and the secure input definition below.

VS Code controls which applications are discovered through `chat.mcp.discovery.enabled`. If no compatible configuration is detected, use **Command (stdio)**.

## Browse MCP Servers

1. Select **Browse MCP Servers...** to open the MCP gallery in the Extensions view.
2. Search for `swsd-mcp` or the registry name `io.github.mikimatsub/swsd`.
3. Open the result and review its repository, publisher, package name, and requested environment variables.
4. Select **Install** for the current profile, or right-click and choose **Install in Workspace**.
5. Open the resulting `mcp.json` and confirm that token handling matches the secure configuration below.

The gallery is a discovery surface, not a reason to skip verification. If the entry is temporarily unavailable or cached, use **Command (stdio)**; it runs the same published npm package.

## Secure VS Code configuration

VS Code's native file uses `servers`, not the generic `mcpServers` key used by many other clients. The `inputs` entries below prompt once and store the JWT securely instead of writing it into the JSON file.

```json
{
  "inputs": [
    {
      "type": "promptString",
      "id": "swsd-token",
      "description": "SolarWinds Service Desk admin JWT",
      "password": true
    },
    {
      "type": "pickString",
      "id": "swsd-base-url",
      "description": "SolarWinds Service Desk region",
      "options": [
        {
          "label": "US — api.samanage.com",
          "value": "https://api.samanage.com"
        },
        {
          "label": "EU — apieu.samanage.com",
          "value": "https://apieu.samanage.com"
        }
      ],
      "default": "https://api.samanage.com"
    },
    {
      "type": "pickString",
      "id": "swsd-profile",
      "description": "swsd-mcp tool profile",
      "options": ["triage", "agent", "knowledge", "operations", "full"],
      "default": "agent"
    },
    {
      "type": "pickString",
      "id": "swsd-write-mode",
      "description": "swsd-mcp write behavior",
      "options": ["live", "dry-run", "disabled"],
      "default": "live"
    }
  ],
  "servers": {
    "swsd": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "swsd-mcp"],
      "env": {
        "SWSD_TOKEN": "${input:swsd-token}",
        "SWSD_BASE_URL": "${input:swsd-base-url}",
        "SWSD_PROFILE": "${input:swsd-profile}",
        "SWSD_WRITE_MODE": "${input:swsd-write-mode}"
      }
    }
  }
}
```

For a workspace file, this configuration is safe to commit because it contains placeholders, not the token itself. If you prefer OS-managed environment variables, VS Code also supports `${env:SWSD_TOKEN}`.

## Start and verify

1. Run **MCP: List Servers**.
2. Select `swsd`, choose **Start** or **Restart**, and review the trust prompt.
3. In Chat, ask: _“Use swsd to check if you can connect.”_
4. Confirm that the agent calls `swsd_health_check` and reports success.

If it fails:

- Choose **Show Output** from **MCP: List Servers**.
- Run `node --version`; it must satisfy the current package requirement (Node 24.15.0 or newer within the Node 24 line).
- Confirm that `npx` is on the same machine where the MCP config runs.
- For remote workspaces, verify that the config and Node installation are both in the remote environment.
- Run **MCP: Reset Cached Tools** after changing profiles or updating the package.

For the full schema and current command list, see Microsoft's [MCP configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration).
