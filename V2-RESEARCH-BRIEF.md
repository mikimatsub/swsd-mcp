# swsd-mcp V2: Research & Planning Brief

This is the kickoff brief for planning v2 of swsd-mcp. The expected output of this phase is a research-backed planning document, not code. v1 is shipped and stable; v2 is open.

Today is **May 6, 2026**. Anything you cite about MCP, MCP Apps, SWSD, the TypeScript MCP SDK, or competing servers should be current as of this date. The MCP ecosystem has moved fast since v1 was scoped. Verify, don't assume.

## Where v1 stands

v1.0.1 is published to npm as `swsd-mcp` and to GHCR as `ghcr.io/mikimatsub/mcp-swsd`. The repo is https://github.com/mikimatsub/MCP-SWSD. Docs site is at https://mcp-swsd.pages.dev. Architecture is TypeScript on `@modelcontextprotocol/sdk`, dual-transport (stdio + Streamable HTTP from one binary), zero credentials at rest, per-request token passthrough. Four profiles (`triage`, `agent`, `knowledge`, `full`) selected at startup via `SWSD_PROFILE`, with `SWSD_ENABLE_EXTRAS` for additive per-tool overrides. Twenty-three tools across utility, incidents, comments, solutions/KB, lookups, and custom-field introspection. Microsoft Copilot Studio is supported via per-profile Swagger 2.0 specs and an Azure Container Apps deployment recipe.

Read the README, the docs site, and the source before forming any v2 opinions. Don't take this brief as a substitute for reading the actual code.

## What the project is for

swsd-mcp exists because there's no first-party self-hostable MCP server for SolarWinds Service Desk, and the SaaS bridges (Zapier, Pipedream, Truto, AgenticFlow) route every call through their infrastructure, which is a non-starter for sovereignty-minded operators. The intended audience is anyone running SWSD with an API token: internal IT teams, MSPs, sysadmins, the SWSD admin community broadly. It is not aimed at any one workplace. Decisions should optimize for that audience: people who already have SWSD, already have an MCP-capable client, and want to plug them together without sending their tickets through a third party.

## Known issue: identity and scope

This is the most important thing v2 needs to address. The current tool surface is built out of CRUD primitives: `list_incidents`, `get_incident`, `update_incident`, and so on. These work correctly at the API level but produce poor results for daily-workflow questions. Two failure modes specifically:

**The model has no way to know who the authenticated user is.** The token belongs to a real person, but no tool exposes "you are this user, with this id, in these groups, with this role." So when a user asks "how many tickets do I have assigned," the model can't filter on assignee because it doesn't know the assignee id. It either guesses, refuses, or returns tenant-wide results.

**The model has no way to distinguish "me" from "the tenant."** A list response of 25 incidents from a tenant with 56,000 incidents looks identical to a list response of 25 incidents from a user with exactly 25 assignments. There's no in-band signal about scope, totals, or filter completeness. So "how many tickets do I have" gets answered "you have 25" when the truth is "you have 12, but there are 56,000 in the tenant and the model paginated wrong."

Both problems are tool-surface design issues, not client issues. Research how other MCP servers in similar domains handle authenticated-user identity and scope signaling: Linear's MCP, GitHub's MCP, Asana's MCP, Atlassian's, ServiceNow if any exist, anything in the ITSM or ticketing space. Look at what SWSD's REST API actually exposes for the authenticated user, for group and role membership, for total-count headers, and for any pagination/cursor patterns that might be cleaner than the current page/per_page approach.

Then propose a v2 approach. I'm not specifying what tools to add or what response shapes to use. Reason from the failure modes and the API capabilities to a design.

## Known opportunity: MCP Apps (SEP-1865)

MCP Apps was ratified as the first official MCP extension on January 26, 2026: the productionization of the community MCP-UI project, jointly authored by Anthropic, OpenAI, and the MCP-UI working group. Spec and SDK live at https://github.com/modelcontextprotocol/ext-apps. The mechanic: a tool declares a `ui://` resource via `_meta.ui.resourceUri` in its metadata, the host fetches that HTML through standard MCP resource reads, renders it inline in a sandboxed iframe, and the iframe can call back into other tools on the same server via postMessage carrying MCP JSON-RPC. It's strictly additive: text fallbacks are mandatory in the spec, and non-supporting clients receive the structured response unchanged.

Host support as of early 2026 includes Claude (web + desktop), VS Code with GitHub Copilot, Goose, Postman, MCPJam, ChatGPT via Apps SDK, and Microsoft 365 Copilot Chat. Each has quirks (Claude's domain signing, dark-mode handling via `data-theme` attribute rather than a CSS class, CSP shape for external scripts). Verify the current state in May 2026: what was rough at launch may have stabilized, or new clients may have shipped support.

This is an opportunity, not a requirement. The question is whether it fits this product, for which tools, in what shapes, at what implementation cost. SWSD records have shapes that benefit from inline UI (incident detail, queues, custom-field forms over per-tenant schemas), but "could benefit from" is not the same as "must be in v2." Research the current state of MCP Apps tooling, including the MCP-UI client SDK, AppBridge, ext-apps reference implementations, and framework wrappers such as Laravel's `laravel/mcp` and CopilotKit's integration. Determine what's actually production-grade today versus what's still rough, and propose accordingly. "Defer to v3" is a valid conclusion if defended.

## Research mandate

Specifically research, at minimum:

- The current MCP specification at https://modelcontextprotocol.io/specification (latest stable plus any draft revisions) and what's changed in tools, resources, metadata, transports, and security since v1 was built
- The current `@modelcontextprotocol/sdk` (TypeScript) API surface and any breaking changes, deprecations, or new patterns in recent releases
- MCP Apps (SEP-1865): read the spec, the `ext-apps` repo, the MCP-UI client SDK, and the reference host implementations. Understand what host support looks like in practice in May 2026, not what the launch announcement said in January
- The current SWSD API at https://apidoc.samanage.com: what endpoints exist for authenticated-user info, group and role membership, total counts, search, advanced filtering, webhooks/events, attachments, and anything else relevant to identity-aware or workflow-shaped tooling. Note any post-ESM behavior or URL changes
- How comparable MCP servers in adjacent domains (ITSM, ticketing, project management) handle the identity and scope problems described above. Look at their tool surfaces, their response shapes, and their workflow-vs-CRUD balance
- The competitive landscape: are there now first-party SWSD MCP servers? Other community implementations? Has SolarWinds shipped anything user-installable since their AI Agent and MCP Framework announcement in late 2025?
- Anything else that surfaces during research and seems load-bearing

Don't cargo-cult. If you find a pattern in another server, evaluate whether it actually fits SWSD's data model, audience, and operational shape before recommending it.

## What I want out of you

A planning document, not code. Roughly:

- A summary of what you found in research, including where v1's assumptions are still correct and where they need updating
- A proposal for how v2 should address the identity and scope problem, with specific tool additions, response-shape changes, and rationale tied to the research
- A proposal for whether and how v2 should incorporate MCP Apps, with rationale. If yes, specifics on which tools get UI, what the UI does, and a realistic implementation-cost picture. If no, or "later," defend the position
- Any other v2 or future-version additions you think fit, based on the project's aim, the current MCP landscape, and gaps you see in v1. Don't limit yourself to the two issues I named: look at the whole product. Categories worth thinking about include but are not limited to observability and structured logging, multi-tenant deployment patterns, prompt and sampling primitives, server-initiated notifications, resource exposure beyond the current surface, audit/compliance features for enterprise self-hosters, attachments, webhooks, change requests, problems, assets, contracts, anything else the research surfaces
- An honest assessment of risks, unknowns, and things worth spiking before committing to any of the proposed work

I am not constraining scope. If the right v2 is small and surgical, propose that. If it's a rebuild, propose that and defend it. If some things belong in v3 or later, say so and explain. Push back on anything in this brief that you think is wrong after research: including the framing of the two issues above.

Don't draft an implementation plan with phases and timelines yet. That comes after we agree on the proposal. This is the research and proposal phase.
