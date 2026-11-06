# SolarWinds Service Desk for Windows

Plugin and companion version **3.3.1** bundles the published **swsd-mcp 3.3.1** runtime. The published runtime exposes 145 tools. This source candidate adds incident attachment reads (146 tools) and must be released before refreshing the pinned runtime recipe. Ten MCP Apps widgets provide incident, knowledge, comments, audit, catalog, custom-field, SLA, statistics, and change-calendar views in compatible hosts.

## First use or upgrade

1. Install or update SolarWinds Service Desk from your organization's plugin directory.
2. Start a new local Work or Codex chat and ask **Set up SolarWinds Service Desk on this computer.** This opens the companion app from the updated plugin package.
3. Choose **Install tools** for first use, or **Repair** to install the bundled runtime and refresh the companion app, launcher, assets, and Start menu shortcut.
4. Choose your region and enter your personal JSON Web Token privately in the masked field only if no token is saved. Select **Test** to verify and save it. With an existing saved token, Test reuses it. Never paste a token into chat.
5. Choose a **Profile** on Home or Tools. Selection saves immediately; Agent is the default for a new setup.
6. Fully quit and reopen the AI desktop app, then start a new chat and ask **Check my SolarWinds connection.** Verify the server version and selected profile with `swsd_get_server_info`.

An npm global installation alone does not install this plugin's launcher or companion app. Plugin updates are delivered by the marketplace; existing chats may retain an older running server until restarted.

## Home and Tools

Reopen **SWSD Setup** from the Windows Start menu to manage the connection without a chat.

- **Home** shows connection and runtime status, region, profile, Appearance, updates, diagnostics, and repair.
- **Tools** provides a searchable tool guide with Read, Edit, and Delete badges, profile availability, and example prompts.
- **Custom profiles** let you select tools, name a profile, and choose **Save profile**. Rename, delete, import, and export controls manage saved profiles. Select the saved profile in the Home or Tools picker to activate it.
- **Appearance** offers Match Windows, Light, Dark, and named themes such as Dracula, Catppuccin, Nord, and Tokyo Night.
- **What's new** displays release notes offline. Report a bug and Request a feature open prefilled issue forms for your review.

| Profile | Tools available |
| --- | --- |
| Triage | Incident review, queue and SLA views, catalog context, tasks, problems, and comments |
| Agent | Everyday ticket handling, tasks, problems, time entries, attachments, and work views |
| Knowledge | Knowledge searches and article editing, with incident and catalog context |
| Operations | All 146 tools, including directory, assets, changes, releases, procurement, and guarded deletes |
| Custom | Only the tools selected in the saved profile |

Legacy Full selections map to Operations. Profiles select tools, not account permissions. Delete tools require preview and confirmation. After switching profiles, restart the AI desktop app and use a new chat; a saved selection does not change a running server's tool list.

## Updates and diagnostics

**Check now** looks for a newer published server; **Update** validates and activates that runtime and retains the previous tools if validation fails. This updates the server, not the companion scripts. To update the companion app, update the plugin and launch its setup skill, then choose **Repair**.

**Copy report** produces redacted diagnostics, including whether a credential exists, never its value. Review the report before sharing. **Repair** reinstalls the runtime pinned by this plugin and refreshes the companion files; it can return a separately updated runtime to the bundled version.

## Credentials and requirements

The token is a per-user Windows Credential Manager entry named `swsd-mcp/api-token`. It is never stored in the plugin, repository, settings file, or persistent environment variables. The server receives it in its process environment. Other processes running as the same Windows user can access that user's credentials.

**Remove saved JSON Web Token** deletes this computer's credential. Fully quit the AI app afterward to stop running servers using their in-memory copy. Revoke the token in SolarWinds separately if needed. Plugin uninstall does not erase credentials or local runtime files.

- Windows, Windows PowerShell 5.1, and a local agent with shell access.
- Node.js 24.15+ within major 24 or Node.js 26+, including npm. Node 25 is unsupported. Setup can install the current supported LTS through winget when organizational policy permits.
- Access to the npm registry and your selected SWSD API region, and a personal SWSD token with appropriate account permissions.
- Local files under `%LOCALAPPDATA%\swsd-mcp`; launcher and companion files under `client\3.3.1`.
- Corporate script-signing, AppLocker, and WDAC policies still apply. This is a Windows desktop integration; installation does not create a web/mobile connection or hosted service.

See [SWSD MCP documentation](https://mcp-swsd.pages.dev/) and `ADMIN.md` for deployment and acceptance checks.
