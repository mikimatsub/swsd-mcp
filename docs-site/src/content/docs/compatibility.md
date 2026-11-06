---
title: Client compatibility
description: Which MCP clients work with swsd-mcp, and which render the rich UI widgets.
---

swsd-mcp is a standard [Model Context Protocol](https://modelcontextprotocol.io) server. Use a client that supports **stdio or Streamable HTTP**, with the SWSD JSON Web Token supplied through the matching transport. The active profile selects which of the 146 tools are available.

The ten [UI widgets](/widgets/) ship over the [MCP Apps extension](https://modelcontextprotocol.io/extensions/apps/overview) (SEP-1865). Hosts that don't support MCP Apps still get text and structured tool output. Widget availability also follows the profile: the catalog form needs both the lookup and service-request tools.

## Client matrix

| Client | Stdio MCP | MCP Apps widgets | Notes |
|---|:---:|:---:|---|
| **Claude Desktop** (macOS, Windows) | ✅ | ✅ | Local stdio setup; MCP Apps rendering depends on the host's enabled features. |
| **Claude Code** (CLI) | ✅ | No | No widget rendering surface; tools work via structured text. |
| **Claude Web** (claude.ai) | No | ✅ | Connect to a hosted HTTP endpoint. |
| **VS Code Copilot Chat** | ✅ | ✅ | Enable MCP Apps in a supporting build; see the [VS Code configuration reference](https://code.visualstudio.com/docs/agents/reference/mcp-configuration). |
| **ChatGPT (web)** | No | ✅ | Connect through a hosted HTTP integration that supports the required token header. |
| **ChatGPT Work / Codex (Windows plugin)** | ✅ | Check host | The Windows plugin launches a local stdio server with the saved profile and JSON Web Token. |
| **Cursor** | ✅ | Check host | Configure local stdio; consult the host's current widget support. |
| **Continue** | ✅ | Check host | Agent-mode MCP; use the client's configuration format. |
| **Cline** | ✅ | Check host | Configure local stdio; consult the host's current widget support. |
| **Goose** (Block) | ✅ | ✅ | MCP Apps support is listed by the upstream project. |
| **Postman** | ✅ | Check host | Supports stdio and Streamable HTTP MCP requests. |
| **MCPJam** | ✅ (local) | ✅ | The local inspector supports stdio; its hosted web app uses HTTPS endpoints. |
| **LM Studio** | ✅ | Check host | Configure local stdio; consult the host's current widget support. |
| **Microsoft Copilot Studio** | No | Check host | Needs an HTTP server. See [Deployment → Copilot Studio](/deployment/#microsoft-copilot-studio). |

A "✅" under **Stdio MCP** means a local subprocess connection is available; browser-hosted clients instead need HTTP. A "✅" under **MCP Apps widgets** indicates a host with MCP Apps support. **Check host** means to consult the installed client's current support. See the [MCP Apps host list](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/) and [MCPJam connection options](https://github.com/MCPJam/inspector). Edition, settings, authentication, and organizational policy can affect availability.

## My client isn't listed

If your client isn't listed, check that it supports stdio or Streamable HTTP and can supply the required credentials, then try the [Quick start](/quickstart/). Hosts without MCP Apps support can use the text and structured results.

If you've verified swsd-mcp working in a client not listed here, [open a PR](https://github.com/mikimatsub/swsd-mcp/pulls) to add it.

## See also

- [Quick start](/quickstart/): install and configure your client
- [Widgets reference](/widgets/): what each of the ten widgets renders
- [Deployment](/deployment/): HTTP-transport hosting for Copilot Studio and shared-team setups
