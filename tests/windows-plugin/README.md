# Windows plugin verification

Run these checks from the repository root on Windows with the supported Node 24
installation. They require no elevation, desktop configuration changes, token
entry, or Windows Credential Manager writes:

```powershell
npm ci --ignore-scripts --strict-peer-deps --prefix plugins/swsd/runtime
npm audit --audit-level=low --prefix plugins/swsd/runtime
powershell.exe -NoProfile -NonInteractive -File tests/windows-plugin/check-install.ps1
powershell.exe -NoProfile -NonInteractive -File tests/windows-plugin/check-profiles.ps1
powershell.exe -NoProfile -NonInteractive -STA -File plugins/swsd/scripts/Manage-Swsd.ps1 -ValidateUi
node tests/windows-plugin/check-stdio.mjs plugins/swsd/runtime/node_modules/swsd-mcp/dist
```

The UI self-test never shows the form and saves only temporary profile settings.
The installation check uses a GUID-named temporary runtime and shortcut folder.
It tests installation, the retained repair recipe, exact copied files, settings
preservation, and rejection of a stale recipe before any installation changes.
Its credential methods throw, and it never touches the real Start menu or desktop
installation. The private runtime recipe keeps server 2.3.2 and SDK 1.31.0,
matching the verified pre-migration build. Revisit the runtime pin during a
separate review of server 3.0.0's SDK v2 and protocol changes.
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

On an interactive Windows desktop, `Manage-Swsd.ps1 -ValidateWindow` opens a
credential-disabled window, checks visibility and placement above the active
application after the real Shown handler, verifies normal stacking and a hidden
console, then closes. It reports keyboard foreground activation separately;
Windows may deny that request from a background process.
Launch it through the same hidden-console Start-Process arguments as setup and
capture its JSON output in a temporary file. `-WindowTestSeconds 1..15` controls
its lifetime for overlapping launch checks. This is a visible development probe,
not part of unattended CI; it never enables token entry or saves credentials.
