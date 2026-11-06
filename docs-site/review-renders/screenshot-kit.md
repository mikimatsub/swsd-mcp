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

## Posted sequence

Documentation screenshots are **neutral dark** (`-PreviewTheme dark`). Post one picture per function, in this order, in both the README companion section and the docs guide. Do not add a light twin. Do not add a Dracula twin. The existing Dracula files show the 3.3.1 update row, so they are not a clean substitute.

Theme contrast is already checked in the app for every Appearance entry. That check does not need a second posted image.

| Order | File | State | What the picture adds |
|---|---|---|---|
| 1 | `setup-firstrun.png` | `firstrun` | **Set up** and **Install tools** |
| 2 | `home-custom-current.png` | `custom-selected` | Home at the current version, custom profile selected |
| 3 | `tools-guide.png` | `tools` | Tool guide and profile membership |
| 4 | `tools-search-delete-incident.png` | `tool-detail` | Search for `delete incident` |
| 5 | `profile-builder.png` | `profile-builder` | Named profile builder |
| 6 | `import-error.png` | `import-error` | Rejected import |
| 7 | `whats-new.png` | `whats-new` | Release notes |
| 8 | `jwt-help.png` | `jwt-help` | Token help. The Home status row still shows 3.3.1; do not describe that number as a release |
| 9 | `appearance-menu.png` | `appearance` | Open Appearance menu, once. Same 3.3.1 status limit as `jwt-help` |

Skip `ready`. It repeats Home and forces the 3.3.1 update row.

## Commands

Run on Windows from the repository root. This does not install tools, write Credential Manager, or call SWSD. PowerShell closes the window after it writes the PNG. Every shot uses neutral dark.

```powershell
$out = Join-Path $env:TEMP 'swsd-doc-shots'
New-Item -ItemType Directory -Force -Path $out | Out-Null
$script = 'plugins\swsd\scripts\Manage-Swsd.ps1'

function Shot([string]$State, [string]$Name) {
  $shot = Join-Path $out $Name
  & powershell.exe -NoProfile -NonInteractive -STA -File $script `
    -ValidateWindow -PreviewState $State -PreviewTheme dark -ScreenshotPath $shot
}

Shot 'firstrun' 'setup-firstrun.png'
Shot 'custom-selected' 'home-custom-current.png'
Shot 'tools' 'tools-guide.png'
Shot 'tool-detail' 'tools-search-delete-incident.png'
Shot 'profile-builder' 'profile-builder.png'
Shot 'import-error' 'import-error.png'
Shot 'whats-new' 'whats-new.png'
Shot 'jwt-help' 'jwt-help.png'
Shot 'appearance' 'appearance-menu.png'
```

`-PreviewTheme dark` is the neutral Dark entry. `appearance` is the only state that opens the menu. The other states keep the menu closed. Do not pass `light`, `one-light`, or `dracula` for this set.

## If a clean Agent overview is required

Add a preview state that sets latest equal to `$script:SwsdPackageVersion` and does not change the existing `ready` / `appearance` assertion. That is an application change, not a docs change, and it is not in this PR.

Until that exists, use `custom-selected` for a Home picture at the current version, and treat `ready` only as a labeled example of the update row.

## Files the pictures depend on

- `plugins/swsd/scripts/Manage-Swsd.ps1` — window, labels, preview states
- `plugins/swsd/scripts/Common.ps1` — package version `3.3.0`, themes, profile rules, Node.js check, changelog reader
- `plugins/swsd/assets/CHANGELOG.md` — What's new body (not the repository root changelog)
- `plugins/swsd/assets/tool-catalog.json` — tool names, badges, profile membership
- `plugins/swsd/assets/jwt-help/` — images inside token help
