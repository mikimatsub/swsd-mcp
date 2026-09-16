# Organization rollout and updates

## What the previous archive lacked

Version 2.2.0 declared `npx -y swsd-mcp` and forwarded `SWSD_TOKEN` from the desktop environment. That is an environment dependency, not a request for the application to show a credential form. A README inside a ZIP does not create an in-app setup flow. The bundle had no setup skill or registered app dependency.

Version 2.3.2 adds a setup skill, visible setup copy and starter prompts, a Windows settings window, a Start menu shortcut, a five-profile dropdown, and a Credential Manager-backed launcher. It keeps the native compatibility manifest supported by OpenAI. No hosted service is required.

## Manage the existing workspace plugin through GitHub

OpenAI supports adopting an uploaded plugin through the `pluginId` field in a GitHub marketplace. Use the existing ID, not a second plugin with the same name. The adoption preserves sharing and workspace policy; afterwards, updates come from GitHub and archive upload no longer replaces that plugin.

The marketplace at `.agents/plugins/marketplace.json` points to `plugins/swsd`. Its entry includes the existing GAIConsultants plugin ID.

In **Admin > Plugins > Add > Import marketplace** use:

- Source: `https://github.com/mikimatsub/swsd-mcp`
- Path: leave empty.
- Branch: the reviewed branch containing these files. Start with `codex/windows-plugin-setup`; use a release branch or main after your review/merge process.

Authorize the importing administrator's GitHub connection if required. Review the result and confirm that the existing plugin is now version 2.3.2 with a setup skill. Keep its existing **Available** policy during the pilot. The import does not automatically grant SolarWinds access.

For later updates, commit reviewed plugin changes to the selected branch and use **Admin > Plugins > Marketplaces > Sync now**, or wait for the daily sync. Review import errors; an invalid update should leave the last working version in place. Do not delete the marketplace to repair access; OpenAI documents that deleting a marketplace deletes its imported plugins.

## Windows deployment

Use your existing Windows application deployment process to install the required Node.js 24 version and approve/sign the PowerShell scripts if policy requires it. Each user then completes the private setup window. No administrator elevation is required for the per-user npm runtime, shortcut, or credential.

The plugin cannot silently show an install-time wizard through an undocumented manifest field. Its supported discovery path is the long description, starter prompt, and setup skill. The Windows settings window provides ongoing local management; it is not an OpenAI account-connection settings page.

## Pilot acceptance

On a coworker's Windows account without a personal SWSD plugin or preexisting token:

1. Install the workspace plugin and open a new local chat.
2. Confirm the setup skill is present even before a token exists.
3. Launch setup and install tools; verify that the Start menu shortcut appears.
4. Enter a personal token privately. Confirm a successful connection test.
5. Restart the desktop app and verify `swsd_health_check` in a new chat.
6. Verify the expected identity with `swsd_get_me` and one authorized read.
7. Switch each required profile, restart the desktop app, and verify the active profile and expected tools. Confirm that the token remains saved.
8. Test replacement and local removal; after quitting/reopening, removal must prevent SWSD access.
9. Confirm organization enable/disable policy works for the pilot user.

Package validation and a server handshake alone do not prove workspace delivery or a coworker's authorization. Record those results separately before wider rollout.

## Documentation reviewed

- [Plugin management and migration by pluginId](https://learn.chatgpt.com/docs/enterprise/plugin-management)
- [Plugin capability and permission layers](https://learn.chatgpt.com/docs/enterprise/apps-and-connectors)
- [Supported package components](https://developers.openai.com/plugins/build/plugins)
- [MCP environment variables and desktop configuration](https://learn.chatgpt.com/docs/extend/mcp)
- [OAuth requirements for a future hosted integration](https://developers.openai.com/plugins/build/auth)
