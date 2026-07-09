import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const SERVER_NAME = 'swsd-mcp';
export const SERVER_VERSION = '2.2.0';

const INSTRUCTIONS = [
  'Tools wrap the SolarWinds Service Desk (SWSD / Samanage) API.',
  'IDs are integers. List endpoints accept structured filters; do not pass raw query strings.',
  'For pagination, prefer narrowing filters over deep paging.',
  'For custom-field writes (custom_fields parameter on incident/solution write tools), call swsd_describe_custom_fields first — field names and types are tenant-specific.',
  'For requests mentioning "me", "my", or "I" (e.g. "my tickets", "tickets in my group"), call swsd_get_me first to learn the authenticated user\'s id, email, and group memberships. Then pass those to assignee_email/requester_email filters on swsd_list_incidents (or use swsd_list_my_incidents which does this in one call). Without this step, "my X" queries cannot be answered correctly.',
  'When the user asks to "request" something (new hardware, software access, an account, a file restore), prefer swsd_list_catalog_items first to find a matching catalog item, then swsd_get_catalog_item to inspect its required variables, then swsd_create_service_request to submit. Fall back to swsd_create_incident only when no catalog item matches.',
].join(' ');

export function createMcpServer(): McpServer {
  // MCP Apps capability note (SEP-1865, spec 2025-11-25):
  // We register UI-bearing tools via `registerAppTool` from
  // `@modelcontextprotocol/ext-apps/server`, which writes `_meta.ui.resourceUri`
  // (and the legacy `_meta["ui/resourceUri"]` mirror) into the tool entry. The
  // matching HTML resources are registered via `registerAppResource` with the
  // `text/html;profile=mcp-app` MIME type. No explicit server-level
  // capability declaration is required: the spec advertises support
  // tool-by-tool through `_meta.ui.resourceUri`, and resource-level fallbacks
  // through the dedicated MIME profile. Hosts without MCP Apps support simply
  // ignore the `_meta.ui` field and render the tool as text-only — no graceful
  // degradation path needed at the server-construction level. (See ext-apps
  // `server/index.d.ts` `getUiCapability` — that helper is for *reading* what
  // the *client* declares, not for the server to declare anything.)
  return new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions: INSTRUCTIONS,
      capabilities: { tools: {}, logging: {} },
    },
  );
}
