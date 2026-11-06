---
name: swsd-setup
description: Open or update the SolarWinds Service Desk Windows companion app, set up its connection, manage its saved token, repair tools, choose or build custom profiles, search the tool guide, change appearance, or inspect diagnostics and release notes. Use when the SWSD plugin is installed but tools are unavailable or outdated.
---

# SolarWinds Service Desk setup and management

This skill works before the SWSD MCP server can connect. It requires a local Windows Work or Codex task with shell access. If this is a cloud-only task, tell the user to open a local task in the Windows desktop app. Do not claim a cloud session can change the desktop's credentials.

## Private credential entry

Never ask the user to paste a token into chat, a tool argument, a command line, or a source file. Never read token values from Credential Manager or the environment into a tool result. The bundled setup window owns credential entry, tests it against the chosen SolarWinds API host, and saves it in Windows Credential Manager.

## Set up or manage

1. Resolve `../../scripts/Manage-Swsd.ps1` relative to this SKILL.md into an absolute path. Do not guess a cache location or username.
2. Check readiness with Windows PowerShell: `powershell.exe -NoProfile -File "<absolute script path>" -CheckOnly`. The output contains booleans and a version, never credentials.
3. If Node.js is unsupported or absent, explain that this release needs Node.js 24.15+ within version 24 or Node.js 26+. Node 25 is not supported. Setup can install the current supported Node.js LTS through winget when permitted by the organization; otherwise use its approved software deployment process or ask IT. Do not change machine security policy, bypass AppLocker/WDAC, or install an arbitrary latest Node version.
4. Launch the private setup window with `Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile -STA -WindowStyle Hidden -File "<absolute script path>"'`. The window is intentionally interactive; do not fill or inspect the token field. Do not add execution-policy bypasses.
5. On first use choose **Install tools**. For an existing installation, **Repair** installs the bundled runtime and refreshes this version of the companion app and launcher. Select the correct region, privately paste a personal JSON Web Token if none is saved, then choose **Test**. With a saved token, **Test** reuses it; never ask for a replacement simply because the plugin was updated. Do not generate a token on the user's behalf.
6. **Remove saved JSON Web Token** removes this computer's credential. It does not revoke the token in SWSD or stop a server already running with it. Fully quit the desktop app after removal or replacement to end old sessions.
7. Once setup is finished, run `-CheckOnly` again. All three booleans should be true. This only verifies prerequisites. A successful private window connection test, followed by `swsd_health_check` in a new chat, verifies live access.
8. Start a new chat to load the tools. If they remain unavailable, fully quit and reopen the desktop app. Call `swsd_health_check` when available; do not claim success without it. For personal incident queries, use `swsd_get_me` or `swsd_list_my_incidents`.

## Switch profiles without editing files

Open **SWSD Setup**. The **Profile** picker on Home and Tools offers Triage, Agent, Knowledge, Operations, and saved custom profiles. Selecting a profile saves it immediately. Operations includes all 146 tools; legacy Full selections map to Operations. The token and saved region are preserved. Never ask for a token just to change a profile.

On **Tools**, search the tool guide and inspect Read, Edit, and Delete badges and profile availability. Use the custom profile builder to select tools, name the profile, and choose **Save profile**. Saved custom profiles can be renamed, deleted, imported, or exported as JSON. Do not expand the active tool selection unless the user requests it. Delete tools still require record preview and confirmation.

Tell the user to fully quit and reopen the desktop app, then start a new chat. Profile tools register when the MCP server starts; existing chats/connections may retain the old tool list. Use `-CheckOnly` to confirm the saved selection and `swsd_get_server_info` in the new connection to verify the active profile. Do not present a saved setting as proof that an existing server has switched.

## Troubleshooting

- Missing launcher or runtime after a plugin update: open this skill's bundled companion app and choose **Install tools** or **Repair**. A global npm install does not install the plugin's per-user launcher or companion app.
- Node requirement: Node.js 24.15+ within major 24 or Node.js 26+, with npm, must be installed on the host. Node 25 is not supported.
- 401: invalid or revoked personal token; replace it in the private window.
- 403: account permissions or wrong service access; contact the SWSD administrator.
- Download failure: check access to registry.npmjs.org and npm's approved proxy configuration.
- TLS/network failure: check access to api.samanage.com or apieu.samanage.com and approved proxy/certificate configuration. Never disable TLS validation.
- Scripts blocked: ask IT to review/sign the bundled PowerShell scripts under its existing policy.
- Two SWSD servers: the old personal plugin and the workspace plugin may both be installed. Ask which installation the user wants retained before removing one. Do not remove other plugins.
- Organization availability/update policy: see the bundled ADMIN.md; local setup does not change workspace access.

## Companion features and updates

- **Home > Updates > Check now** checks the published server version; **Update** installs it after validating the candidate and retains the previous tools if validation fails. This updates the server runtime, not the plugin package or companion scripts. A new companion release requires the marketplace/plugin update followed by **Repair** from the new package.
- **Appearance** selects Match Windows, Light, Dark, or a named theme.
- **Diagnostics > Copy report** produces a redacted support report. Do not send it elsewhere unless requested.
- **What's new** shows bundled release notes offline. **Report a bug** and **Request a feature** open issue forms; opening the form does not authorize submission.
- After setup, reopen **SWSD Setup** from the Windows Start menu. See `../../README.md` for the user guide.
