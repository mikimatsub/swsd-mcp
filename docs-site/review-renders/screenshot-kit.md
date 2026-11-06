# Windows companion screenshot kit

Internal capture plan for PR 223. Do not publish these notes or placeholder images on the README or docs site.

The published docs describe the window in text. They do not include app screenshots. The Appearance captures from `review-assets/v3.3.0` commit `3d142f9` show **Updates: 3.3.1 available**. That number is the preview's installed version plus one. It is not a published release. Do not put those PNGs back into the docs.

## What the current preview already does

`plugins/swsd/scripts/Manage-Swsd.ps1` `Set-SwsdPreviewFixture` sets `installedVersion` to `$script:SwsdPackageVersion` (`3.3.0` in `plugins/swsd/scripts/Common.ps1`).

It then sets the looked-up latest version to that same value, and **only** for `ready`, `appearance`, `jwt-help`, `tools`, and `tool-detail` changes latest to the package version plus one. `ready` and `appearance` also assert that the button reads **Update** and that the row says that plus-one version is available.

Do not change that assertion or the installer to make a documentation picture. A clean Agent **Overview** with installed and latest both `3.3.0` is not an existing preview state.

| PreviewState | Page | Version pill | Updates row | Use for docs |
|---|---|---|---|---|
| `custom-selected` | Home, profile **Incident follow-up** | 3.3.0 | Up to date | Clean Home. It is the custom profile, not Agent. |
| `firstrun` | **Set up** | 3.3.0 | Dashboard hidden | First-run install steps. |
| `tools` | Tools, search empty | 3.3.0 | Not on this page | Tool guide and profile membership. |
| `tool-detail` | Tools, search `delete incident` | 3.3.0 | Not on this page | Search in use. |
| `profile-builder` | Tools, builder open | 3.3.0 | Not on this page | Named profile, Export JSON, Import JSON. |
| `import-error` | Tools, builder plus error banner | 3.3.0 | Not on this page | Rejected extra JSON field. |
| `whats-new` | What's new | 3.3.0 | Not on this page | Bundled notes. Upcoming is the Node.js note, then 3.3.0. |
| `jwt-help` | Home with token help open | 3.3.0 | Shows 3.3.1 | Help content is valid. The status row is the plus-one update example. Caption it as an example of the update row, or crop the help panel. |
| `ready` | Home, Agent | 3.3.0 | Shows 3.3.1 | Do not publish as the current overview. |
| `appearance` | Home, menu open | 3.3.0 | Shows 3.3.1 | Same. The menu itself is valid if the update row is not presented as a real release. |

Demo account built into the preview: **Alex Rivera · Acme IT**, masked token. Captions should describe that demo window. They should not say a real SWSD tenant was contacted or that **Test** / **Install tools** was run for the picture.

## Commands

Run on Windows from the repository root. This does not install tools, write Credential Manager, or call SWSD. PowerShell closes the window after it writes the PNG.

```powershell
$out = Join-Path $env:TEMP 'swsd-doc-shots'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$script = 'plugins\swsd\scripts\Manage-Swsd.ps1'

function Shot([string]$State, [string]$Name, [string]$Theme) {
  $shot = Join-Path $out $Name
  $argList = @(
    '-NoProfile', '-NonInteractive', '-STA', '-File', $script,
    '-ValidateWindow', '-PreviewState', $State, '-ScreenshotPath', $shot
  )
  if ($Theme) { $argList += @('-PreviewTheme', $Theme) }
  & powershell.exe @argList
}

Shot 'custom-selected' 'home-custom-current.png' 'light'
Shot 'firstrun' 'setup-firstrun.png' 'light'
Shot 'tools' 'tools-guide.png' 'light'
Shot 'tool-detail' 'tools-search-delete-incident.png' 'light'
Shot 'profile-builder' 'profile-builder.png' 'light'
Shot 'import-error' 'import-error.png' 'light'
Shot 'whats-new' 'whats-new.png' 'light'
Shot 'jwt-help' 'jwt-help.png' 'light'
Shot 'appearance' 'appearance-one-light.png' 'one-light'
Shot 'appearance' 'appearance-dracula.png' 'dracula'
```

`-PreviewTheme` values include `system`, `light`, `dark`, `dracula`, `one-light`, and the other ids in `$script:SwsdThemes` in `Common.ps1`. `appearance` is the state that opens the menu. The other states still accept `-PreviewTheme` and keep the menu closed.

## If a clean Agent overview is required

Add a preview state that sets latest equal to `$script:SwsdPackageVersion` and does not change the existing `ready` / `appearance` assertion. That is an application change, not a docs change, and it is not in this PR.

Until that exists, use `custom-selected` for a Home picture at the current version, and treat `ready` only as a labeled example of the update row.

## Files the pictures depend on

- `plugins/swsd/scripts/Manage-Swsd.ps1` — window, labels, preview states
- `plugins/swsd/scripts/Common.ps1` — package version `3.3.0`, themes, profile rules, Node.js check, changelog reader
- `plugins/swsd/assets/CHANGELOG.md` — What's new body (not the repository root changelog)
- `plugins/swsd/assets/tool-catalog.json` — tool names, badges, profile membership
- `plugins/swsd/assets/jwt-help/` — images inside token help
