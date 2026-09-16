# SolarWinds Service Desk for Windows

## First use

1. Install SolarWinds Service Desk from your organization's plugin directory.
2. Open a **new local Work or Codex chat** in the Windows desktop app.
3. Ask: **Set up SolarWinds Service Desk on this computer.**
4. In the separate setup window, click **Install / repair tools**. Node.js 24.15 or newer within version 24 must already be installed with npm; ask IT if it is missing.
5. Choose your SWSD region and paste your own API token into the masked field. Never paste a token into chat.
6. Click **Test and save token**. A successful message means SolarWinds accepted the credential and allowed a minimal incident read.
7. Choose a **Profile** from the dropdown and click **Save profile**. Agent is the default.
8. Fully quit and reopen the desktop app, then start a new chat and ask: **Check my SolarWinds connection.**

## Switch profiles

Open **SolarWinds Service Desk Setup** from the Start menu, choose a profile, and click **Save profile**. The selection and description are shown in the window. Saving a profile preserves the saved token and region. Fully quit and reopen the desktop app, then start a new chat: running sessions retain the tools selected at startup.

| Profile | Tools available |
| --- | --- |
| Triage | Incident review, catalog context, task/problem visibility, and comments |
| Agent | Everyday ticket handling, tasks, problems, time entries, and attachments |
| Knowledge | Knowledge search, article creation and updates, and incident context |
| Operations | Agent tools plus changes, releases, assets, procurement, and risks |
| Full | All tools |

Profiles select tools, not account permissions. The selection belongs to the current Windows user on this computer.

## Change or remove the connection

Open **SolarWinds Service Desk Setup** from the Windows Start menu, or ask **Manage my SolarWinds connection** in a local chat.

- **Test saved connection** checks the saved credential without revealing it.
- **Test and save token** validates a replacement before saving it.
- **Remove saved token** deletes this computer's credential. Fully quit the desktop app afterwards so running servers stop using their in-memory copy. Revoke the token in SolarWinds separately if needed.
- **Install / repair tools** reinstalls the pinned server and refreshes the launcher.

The token is stored as a generic Windows Credential Manager credential named `GAIConsultants/SWSD-MCP`. It belongs to the current Windows user on this computer. Other processes running as the same user can access it; it is not a boundary against software already running under that account. It is not written to the plugin, repository, settings file, or persistent environment variables. The server receives it only in its process environment at launch.

This version does not use any old `SWSD_TOKEN` environment variable. If you previously configured that separately, review and remove the obsolete value through your existing setup process after the new connection works.

## Requirements and limits

- Windows with Windows PowerShell 5.1, and a local desktop agent capable of running the setup skill.
- Node.js 24.15+ within major version 24, including npm.
- Network access to the npm registry and the selected SWSD API host.
- A personal SWSD token authorized for your intended work. Workspace installation does not grant SolarWinds permissions.
- Corporate script-signing, AppLocker, or WDAC requirements may require IT deployment/signing. The plugin does not bypass them.
- Server release is pinned to `swsd-mcp@2.3.1`, with locked dependency versions. Plugin package version is `2.3.2`.
- The default is `agent`. Available profiles are `triage`, `agent`, `knowledge`, `operations`, and `full`. Write tools remain subject to the authenticated account's permissions and the host's tool approvals.
- This is a desktop-only local integration. Uploading it does not create a hosted app, OAuth sign-in button, automatic install-time wizard, or web/mobile connection.
- Setup data and runtime live under `%LOCALAPPDATA%\GAIConsultants\SWSD-MCP`. Uninstalling the plugin does not automatically erase credentials or these files: remove the saved token first, then quit the app.

## Sources

- [OpenAI plugin packaging](https://developers.openai.com/plugins/build/plugins)
- [Workspace plugin management](https://learn.chatgpt.com/docs/enterprise/plugin-management)
- [SWSD MCP source and API-token guidance](https://github.com/mikimatsub/swsd-mcp)
