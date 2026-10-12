# Windows plugin deployment and updates

## Package capabilities

Version 2.3.3 adds a setup skill, visible setup copy and starter prompts, a Windows settings window, a Start menu shortcut, a five-profile dropdown, and a Credential Manager-backed launcher. It keeps the native compatibility manifest supported by OpenAI. No hosted service is required.

The plugin/client package and server runtime have separate versions. This pilot deliberately keeps the reviewed `swsd-mcp@2.3.2` runtime and SDK 1.31.0 lock. The main project has released server 3.0.0 with an SDK v2 migration and changed protocol error behavior; adopting that runtime needs its own Windows launcher and live-access verification. Installation rejects a recipe that disagrees with the setup script and checks the installed server version.

## Optional workspace deployment through GitHub

The public marketplace at `.agents/plugins/marketplace.json` points to `plugins/swsd` and can be imported into a workspace. A deploying administrator manages that workspace's availability and authentication policy; plugin installation does not grant SolarWinds account access.

For an existing uploaded plugin, follow OpenAI's documented `pluginId` adoption process using the workspace's own deployment configuration. Confirm identity before import to avoid a duplicate. Adoption preserves sharing and workspace policy; afterwards, updates come from GitHub and archive upload no longer replaces that plugin.

In **Admin > Plugins > Add > Import marketplace** use:

- Source: `https://github.com/mikimatsub/swsd-mcp`
- Path: leave empty.
- Branch: the reviewed branch containing these files. Start with `codex/windows-plugin-setup`; use a release branch or main after your review/merge process.

Use the administrator's supported GitHub connection flow if required. Review the result and confirm plugin version 2.3.3 and the setup skill. Start with an **Available** policy during the pilot.

For later updates, commit reviewed plugin changes to the selected branch and use **Admin > Plugins > Marketplaces > Sync now**, or wait for the daily sync. Review import errors; an invalid update should leave the last working version in place. Do not delete the marketplace to repair access; OpenAI documents that deleting a marketplace deletes its imported plugins.

## Windows deployment

Use your existing Windows application deployment process to install the required Node.js 24 version and approve/sign the PowerShell scripts if policy requires it. Each user then completes the private setup window. No administrator elevation is required for the per-user npm runtime, shortcut, or credential.

The plugin cannot silently show an install-time wizard through an undocumented manifest field. Its supported discovery path is the long description, starter prompt, and setup skill. The Windows settings window provides ongoing local management; it is not an OpenAI account-connection settings page.

## Pilot acceptance

On a clean Windows user account without another SWSD plugin or preexisting token:

1. Install the workspace plugin and open a new local chat.
2. Confirm the setup skill is present even before a token exists.
3. Launch setup and install tools; verify that the Start menu shortcut appears.
4. Enter a personal token privately. Confirm a successful connection test.
5. Restart the desktop app and verify `swsd_health_check` in a new chat.
6. Verify the expected identity with `swsd_get_me` and one authorized read.
7. Switch each required profile, restart the desktop app, and verify the active profile and expected tools. Confirm that the token remains saved.
8. Test replacement and local removal; after quitting/reopening, removal must prevent SWSD access.
9. Confirm organization enable/disable policy works for the pilot user.

Package validation and a server handshake alone do not prove desktop delivery or user authorization. Record those results separately before wider rollout.

Verify per-user installation, repair, private setup and live launcher access separately from clean-user and optional workspace policy tests. After a marketplace sync, confirm the downloaded package version and runtime recipe, fully restart the desktop app, and verify health in a new local chat. Do not manually modify the app's plugin cache to make an old package appear current.

## Documentation reviewed

- [Plugin management and migration by pluginId](https://learn.chatgpt.com/docs/enterprise/plugin-management)
- [Plugin capability and permission layers](https://learn.chatgpt.com/docs/enterprise/apps-and-connectors)
- [Supported package components](https://developers.openai.com/plugins/build/plugins)
- [MCP environment variables and desktop configuration](https://learn.chatgpt.com/docs/extend/mcp)
- [OAuth requirements for a future hosted integration](https://developers.openai.com/plugins/build/auth)
