---
name: swsd-setup
description: Set up SolarWinds Service Desk on a Windows computer, manage or replace its saved API token, test a connection, repair missing tools, switch tool profiles, or remove local credentials. Use when the SWSD plugin is installed but tools are unavailable.
---

# SolarWinds Service Desk setup and management

This skill works before the SWSD MCP server can connect. It requires a local Windows Work or Codex task with shell access. If this is a cloud-only task, tell the user to open a local task in the Windows desktop app. Do not claim a cloud session can change the desktop's credentials.

## Private credential entry

Never ask the user to paste a token into chat, a tool argument, a command line, or a source file. Never read token values from Credential Manager or the environment into a tool result. The bundled setup window owns credential entry, tests it against the chosen SolarWinds API host, and saves it in Windows Credential Manager.

## Set up or manage

1. Resolve `../../scripts/Manage-Swsd.ps1` relative to this SKILL.md into an absolute path. Do not guess a cache location or username.
2. Check readiness with Windows PowerShell: `powershell.exe -NoProfile -File "<absolute script path>" -CheckOnly`. The output contains booleans and a version, never credentials.
3. If Node.js is unsupported or absent, explain that this release needs Node.js 24.15 or newer within version 24. Use the organization's approved software deployment process or ask IT. Do not change machine security policy, bypass AppLocker/WDAC, or install an arbitrary latest Node version.
4. Launch the private setup window with `Start-Process powershell.exe -WindowStyle Hidden -ArgumentList '-NoProfile -STA -WindowStyle Hidden -File "<absolute script path>"'`. The window is intentionally interactive; do not fill or inspect the token field. Do not add execution-policy bypasses.
5. Tell the user to choose **Install / repair tools**, select the correct region, privately paste their personal SWSD API token, then choose **Test and save token**. Do not generate a token on their behalf. If they cannot obtain one, their SWSD administrator must provide the approved process.
6. The same window offers **Test saved connection** and **Remove saved token**. Removing a local credential does not revoke it in SWSD or stop a server already running with that token. Fully quit the desktop app after removal or replacement to end old sessions.
7. Once setup is finished, run `-CheckOnly` again. All three booleans should be true. This only verifies prerequisites. A successful private window connection test, followed by `swsd_health_check` in a new chat, verifies live access.
8. Start a new chat to load the tools. If they remain unavailable, fully quit and reopen the desktop app. Call `swsd_health_check` when available; do not claim success without it. For personal incident queries, use `swsd_get_me` or `swsd_list_my_incidents`.

## Switch profiles without editing files

Open the same setup window. The **Profile** dropdown offers Triage, Agent, Knowledge, Operations, and Full, with a description of the selected tool set. Choose the requested profile and click **Save profile**. The token and saved region are preserved. Never ask for a token just to change a profile.

Tell the user to fully quit and reopen the desktop app, then start a new chat. Profile tools register when the MCP server starts; existing chats/connections may retain the old tool list. Use `-CheckOnly` to confirm the saved selection and `swsd_get_server_info` in the new connection to verify the active profile. Do not present a saved setting as proof that an existing server has switched.

## Troubleshooting

- Missing launcher or runtime: open this skill and choose Install / repair tools.
- Node requirement: Node 24.15+ within major 24, with npm, must be installed on the host.
- 401: invalid or revoked personal token; replace it in the private window.
- 403: account permissions or wrong service access; contact the SWSD administrator.
- Download failure: check access to registry.npmjs.org and npm's approved proxy configuration.
- TLS/network failure: check access to api.samanage.com or apieu.samanage.com and approved proxy/certificate configuration. Never disable TLS validation.
- Scripts blocked: ask IT to review/sign the bundled PowerShell scripts under its existing policy.
- Two SWSD servers: the old personal plugin and the workspace plugin may both be installed. Ask which installation the user wants retained before removing one. Do not remove other plugins.
- Organization availability/update policy: see the bundled ADMIN.md; local setup does not change workspace access.

After tools are installed, users can reopen the settings window from **SolarWinds Service Desk Setup** in the Windows Start menu without asking the agent. See `../../README.md` for the short user guide.
