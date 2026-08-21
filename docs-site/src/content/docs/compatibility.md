---
title: Client compatibility
description: Which MCP clients work with swsd-mcp, and which render the rich UI widgets.
---

swsd-mcp is a standard [Model Context Protocol](https://modelcontextprotocol.io) server. **Any MCP-compatible client can use it** for the 66 tools; that's the protocol's whole point.

The seven [UI widgets](/widgets/) ship over the [MCP Apps capability](https://modelcontextprotocol.io/specification/2025-11-25) (SEP-1865), a strictly additive extension. Hosts that don't support MCP Apps still get the full text and structured tool output. The widgets are simply not rendered, and the tools do not error.

## Client matrix

| Client | Stdio MCP | MCP Apps widgets | Notes |
|---|:---:|:---:|---|
| **Claude Desktop** (macOS, Windows, Linux) | ✅ | ✅ | Verified end-to-end. Widgets render in-line. |
| **Claude Code** (CLI) | ✅ | No | No widget rendering surface; tools work via structured text. |
| **Claude Web** (claude.ai) | ✅ | ✅ | Verified. |
| **VS Code Copilot Chat** (Insiders + GA) | ✅ | ✅ | Spec-compliant since the v2.0.1 widget-bridge fix. |
| **ChatGPT** (Apps SDK) | ✅ | ✅ | OpenAI's MCP Apps client. |
| **Cursor** | ✅ | No | Standard stdio MCP; widget surface not yet implemented host-side. |
| **Continue** | ✅ | No | Standard stdio MCP. |
| **Cline** | ✅ | No | Standard stdio MCP. |
| **Goose** (Block) | ✅ | ✅ | Verified by upstream MCP Apps maintainers. |
| **Postman** | ✅ | ✅ | Renders widgets when the request hits the MCP server. |
| **MCPJam** | ✅ | ✅ | Open-source MCP playground. |
| **LM Studio** | ✅ | No | No widget rendering surface. |
| **Microsoft Copilot Studio** | ✅* | No | *Different transport: needs an HTTP server, not stdio. See [Deployment → Copilot Studio](/deployment/#microsoft-copilot-studio). |

A "✅" under **Stdio MCP** means the client speaks the standard MCP protocol and can call swsd-mcp's tools. A "✅" under **MCP Apps widgets** means the client also renders the seven UI bundles in-line. A "No" means the host doesn't currently render widgets; the structured tool output still works.

## My client isn't listed

If your MCP-compatible client isn't in the table above, it almost certainly still works for the tools because the protocol is the contract, not the host. Try the [Quick start](/quickstart/). If the widgets don't render, that's expected for hosts without MCP Apps support; the same tools return identical structured text.

If you've verified swsd-mcp working in a client not listed here, [open a PR](https://github.com/mikimatsub/swsd-mcp/pulls) to add it.

## See also

- [Quick start](/quickstart/): install and configure in under five minutes
- [Widgets reference](/widgets/): what each of the seven widgets renders
- [Deployment](/deployment/): HTTP-transport hosting for Copilot Studio and shared-team setups
