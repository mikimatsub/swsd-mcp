# Windows plugin verification

Run these checks from the repository root on Windows with the supported Node 24
installation. They require no elevation, desktop configuration changes, token
entry, or Windows Credential Manager writes:

```powershell
$env:PSModulePath = $null
npm ci --ignore-scripts --strict-peer-deps --prefix plugins/swsd/runtime
npm audit --audit-level=low --prefix plugins/swsd/runtime
powershell.exe -NoProfile -NonInteractive -File tests/windows-plugin/check-install.ps1
powershell.exe -NoProfile -NonInteractive -File tests/windows-plugin/check-profiles.ps1
powershell.exe -NoProfile -NonInteractive -File tests/windows-plugin/check-ui-handlers.ps1
powershell.exe -NoProfile -NonInteractive -STA -File tests/windows-plugin/check-dpi.ps1
powershell.exe -NoProfile -NonInteractive -STA -File plugins/swsd/scripts/Manage-Swsd.ps1 -ValidateUi
node tests/windows-plugin/check-tool-catalog.mjs plugins/swsd/runtime/node_modules/swsd-mcp/dist
node tests/windows-plugin/check-stdio.mjs plugins/swsd/runtime/node_modules/swsd-mcp/dist
```

The WPF UI self-test never shows a window and saves only temporary settings.
All UI Validate modes replace Credential Manager with a guarded in-memory fixture.
Handler validation exercises real WPF events and the DispatcherTimer worker loop;
clipboard, network, Node installation, and runtime installation use test doubles.
The installation check uses a GUID-named temporary runtime and shortcut folder.
It tests installation, the retained repair recipe, exact copied files, settings
preservation, and rejection of a stale recipe before any installation changes.
Its credential methods throw, and it never touches the real Start menu or desktop
installation. It also checks installed catalog/image hashes and loads the installed
WPF client in ValidateUi mode. The private runtime recipe retains the reviewed
server version (enforced by `tests/unit/pluginRuntimeVersion.test.ts`).
The STDIO check uses an in-process credential reader fixture whose write/delete
methods throw. It launches the real PowerShell launcher for each profile, checks
the server version and exact tool list, and verifies the fixture token stays out of protocol output.
The optional argument is the absolute or repository-relative server `dist`
directory; without it, the check uses the recipe's version in the per-user runtime.

These checks run in the Windows CI job. They do not establish native credential
storage, workplace plugin delivery, or successful clean coworker setup. The
separate `check-credentials.ps1` test creates/replaces/deletes a temporary Windows
credential and must only be run with explicit authorization for those changes.
Use the pilot acceptance procedure in `plugins/swsd/ADMIN.md` before deployment.

`Manage-Swsd.ps1 -ValidateWindow` opens an input-disabled fixture, reports native
PerMonitorV2 awareness and actual WPF visual DPI, then automatically closes.
`-ValidateDpiChanges` also visits existing monitors and sends native WM_DPICHANGED
messages in both directions. Foreground availability is reported separately: it
may be unavailable in a headless desktop. `-WindowTestSeconds 1..15` controls the
hold after probing. `-CheckOnly` retains its seven-field JSON status contract.

Capture all six screens in both themes without a human handoff:

```powershell
powershell.exe -NoProfile -NonInteractive -STA -File scripts/Capture-A3Shots.ps1
```

This writes `review-shots/app-{ready,firstrun,jwt-help,error,tools,tool-detail}-{light,dark}.png`
and matching JSON probes. PNGs render the actual WPF visual tree at 96 DPI with
an opaque fallback canvas; they do not capture the wallpaper-dependent DWM effect.
`SWSD_THEME=light|dark` overrides the saved Appearance without changing it.
Regenerate friendly catalog metadata with `node scripts/build-a3-catalog.mjs dist`
after compiling the server. CI diffs the catalog against both the pinned runtime
and the current source build, including all annotations and profile memberships.
