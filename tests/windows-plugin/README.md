# Windows plugin verification

Run these checks from the repository root on Windows with the supported Node 24
installation. They require no elevation, desktop configuration changes, token
entry, or Windows Credential Manager writes:

```powershell
npm ci --ignore-scripts --strict-peer-deps --prefix plugins/swsd/runtime
npm audit --audit-level=low --prefix plugins/swsd/runtime
powershell.exe -NoProfile -NonInteractive -File tests/windows-plugin/check-profiles.ps1
powershell.exe -NoProfile -NonInteractive -STA -File plugins/swsd/scripts/Manage-Swsd.ps1 -ValidateUi
node tests/windows-plugin/check-stdio.mjs plugins/swsd/runtime/node_modules/swsd-mcp/dist
```

The UI self-test never shows the form and saves only temporary profile settings.
The private runtime recipe keeps SDK 1.31.0, matching the verified release build;
SDK 1.32.0 was published October 2 and remains inside the three-day age gate.
Revisit that pin during a later reviewed runtime update.
The STDIO check uses an in-process credential reader fixture whose write/delete
methods throw. It launches the real PowerShell launcher for each profile, checks
the exact tool list, and verifies the fixture token stays out of protocol output.
The optional argument is the absolute or repository-relative server `dist`
directory; without it, the check uses the recipe's version in the per-user runtime.

These checks run in the Windows CI job. They do not establish native credential
storage, workplace plugin delivery, or successful clean coworker setup. The
separate `check-credentials.ps1` test creates/replaces/deletes a temporary Windows
credential and must only be run with explicit authorization for those changes.
Use the pilot acceptance procedure in `plugins/swsd/ADMIN.md` before deployment.
