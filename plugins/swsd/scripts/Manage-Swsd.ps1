param([switch]$CheckOnly, [switch]$ValidateUi)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Common.ps1')
if ($ValidateUi) {
    # Exercise the real controls and save handler without touching a user's settings or credential.
    $script:SwsdHome = Join-Path ([IO.Path]::GetTempPath()) ('swsd-ui-test-' + [guid]::NewGuid().ToString('N'))
}
if ($CheckOnly) {
    $nodeOk = $false
    try { $null = Get-SwsdNode; $nodeOk = $true } catch {}
    [pscustomobject]@{
        nodeSupported = $nodeOk
        toolsInstalled = (Test-Path -LiteralPath (Get-SwsdEntryPoint))
        credentialSaved = (-not [string]::IsNullOrWhiteSpace([SwsdDesktop.Credentials]::Read($script:SwsdCredentialTarget)))
        packageVersion = $script:SwsdPackageVersion
        profile = (Get-SwsdSettings).profile
    } | ConvertTo-Json
    exit 0
}
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$form = New-Object Windows.Forms.Form
$form.Text = 'SolarWinds Service Desk Setup'
$form.ClientSize = New-Object Drawing.Size(650, 660)
$form.StartPosition = 'CenterScreen'
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false
$form.Font = New-Object Drawing.Font('Segoe UI', 10)

function Add-Label($Text, $Y, $Height) {
    $label = New-Object Windows.Forms.Label
    $label.Text = $Text
    $label.Location = New-Object Drawing.Point(20, $Y)
    $label.Size = New-Object Drawing.Size(605, $Height)
    $form.Controls.Add($label)
}
Add-Label 'Connect your own SolarWinds account. Your token stays in Windows Credential Manager on this computer.' 18 48
Add-Label '1. Install tools (requires Node.js 24.15 or newer within version 24).' 74 25
$install = New-Object Windows.Forms.Button
$install.Text = 'Install / repair tools'
$install.Location = New-Object Drawing.Point(20, 104)
$install.Size = New-Object Drawing.Size(200, 34)
$form.Controls.Add($install)
Add-Label '2. Select your SolarWinds region and enter your personal API token.' 151 25
$region = New-Object Windows.Forms.ComboBox
$region.DropDownStyle = 'DropDownList'
$region.Location = New-Object Drawing.Point(20, 181)
$region.Size = New-Object Drawing.Size(605, 30)
[void]$region.Items.Add('US - api.samanage.com')
[void]$region.Items.Add('EU - apieu.samanage.com')
$region.SelectedIndex = 0
if ((Get-SwsdSettings).baseUrl -eq 'https://apieu.samanage.com') { $region.SelectedIndex = 1 }
$form.Controls.Add($region)
$tokenBox = New-Object Windows.Forms.TextBox
$tokenBox.UseSystemPasswordChar = $true
$tokenBox.Location = New-Object Drawing.Point(20, 223)
$tokenBox.Size = New-Object Drawing.Size(605, 30)
$form.Controls.Add($tokenBox)
Add-Label 'Saved tokens are never displayed. Paste a new token only to add or replace it.' 260 26
$save = New-Object Windows.Forms.Button
$save.Text = 'Test and save token'
$save.Location = New-Object Drawing.Point(20, 296)
$save.Size = New-Object Drawing.Size(195, 35)
$form.Controls.Add($save)
$test = New-Object Windows.Forms.Button
$test.Text = 'Test saved connection'
$test.Location = New-Object Drawing.Point(225, 296)
$test.Size = New-Object Drawing.Size(195, 35)
$form.Controls.Add($test)
$remove = New-Object Windows.Forms.Button
$remove.Text = 'Remove saved token'
$remove.Location = New-Object Drawing.Point(430, 296)
$remove.Size = New-Object Drawing.Size(195, 35)
$form.Controls.Add($remove)
Add-Label '3. Choose the tools you need. You can change this later without re-entering a token.' 348 28
$profile = New-Object Windows.Forms.ComboBox
$profile.DropDownStyle = 'DropDownList'
$profile.AccessibleName = 'SWSD profile'
$profile.Location = New-Object Drawing.Point(20, 382)
$profile.Size = New-Object Drawing.Size(605, 30)
foreach ($item in $script:SwsdProfiles) { [void]$profile.Items.Add($item.name) }
$savedProfile = (Get-SwsdSettings).profile
$profile.SelectedIndex = [Array]::IndexOf(@($script:SwsdProfiles | ForEach-Object { $_.id }), $savedProfile)
$form.Controls.Add($profile)
$profileDescription = New-Object Windows.Forms.Label
$profileDescription.Location = New-Object Drawing.Point(20, 422)
$profileDescription.Size = New-Object Drawing.Size(605, 45)
$profileDescription.Text = $script:SwsdProfiles[$profile.SelectedIndex].description
$form.Controls.Add($profileDescription)
$profile.Add_SelectedIndexChanged({ $profileDescription.Text = $script:SwsdProfiles[$profile.SelectedIndex].description })
$saveProfile = New-Object Windows.Forms.Button
$saveProfile.Text = 'Save profile'
$saveProfile.Location = New-Object Drawing.Point(20, 478)
$saveProfile.Size = New-Object Drawing.Size(195, 35)
$form.Controls.Add($saveProfile)
$currentProfile = New-Object Windows.Forms.Label
$currentProfile.Location = New-Object Drawing.Point(230, 485)
$currentProfile.Size = New-Object Drawing.Size(390, 28)
$currentProfile.Text = 'Saved profile: ' + $script:SwsdProfiles[$profile.SelectedIndex].name
$form.Controls.Add($currentProfile)
$status = New-Object Windows.Forms.Label
$status.Location = New-Object Drawing.Point(20, 540)
$status.Size = New-Object Drawing.Size(605, 100)
$status.Text = 'Start with Install / repair tools. Then test and save your token. After setup, start a new chat.'
$form.Controls.Add($status)

function Invoke-SetupAction([scriptblock]$Action) {
    $form.UseWaitCursor = $true
    foreach ($button in @($install, $save, $test, $remove, $saveProfile)) { $button.Enabled = $false }
    $status.Text = 'Working... please wait.'
    $form.Refresh()
    try { & $Action } catch { $status.Text = $_.Exception.Message } finally {
        $form.UseWaitCursor = $false
        foreach ($button in @($install, $save, $test, $remove, $saveProfile)) { $button.Enabled = $true }
    }
}
$install.Add_Click({ Invoke-SetupAction {
    $sourceRoot = Split-Path $PSScriptRoot
    if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'runtime\package.json')) { $sourceRoot = $PSScriptRoot }
    # Installed settings windows already reside beside the launcher; only repair the runtime there.
    if ($sourceRoot -eq $PSScriptRoot) {
        $stage = Join-Path $script:SwsdHome 'repair-source'
        New-Item -ItemType Directory -Path (Join-Path $stage 'scripts') -Force | Out-Null
        foreach ($name in @('Common.ps1','Manage-Swsd.ps1','Start-Swsd.ps1')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $stage 'scripts') -Force }
        New-Item -ItemType Directory -Path (Join-Path $stage 'runtime') -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'runtime\package.json'),(Join-Path $PSScriptRoot 'runtime\package-lock.json') -Destination (Join-Path $stage 'runtime') -Force
        $sourceRoot = $stage
    }
    Install-SwsdTools -SourceRoot $sourceRoot
    $status.Text = 'Tools installed. Test and save your token next. This window is also available from the Windows Start menu.'
} })
$save.Add_Click({ Invoke-SetupAction {
    $secret = $tokenBox.Text.Trim()
    $tokenBox.Clear()
    try {
        if ([string]::IsNullOrWhiteSpace($secret)) { throw 'Paste your personal SWSD token into the masked field first.' }
        $baseUrl = @('https://api.samanage.com','https://apieu.samanage.com')[$region.SelectedIndex]
        Test-SwsdToken -Token $secret -BaseUrl $baseUrl
        $oldSettings = Get-SwsdSettings
        Save-SwsdSettings -BaseUrl $baseUrl -Profile $oldSettings.profile
        try {
        [SwsdDesktop.Credentials]::Save($script:SwsdCredentialTarget, $secret)
        } catch {
            Save-SwsdSettings -BaseUrl $oldSettings.baseUrl -Profile $oldSettings.profile
            throw
        }
        $status.Text = 'Connection verified and token saved. Start a new chat. If an old connection remains, fully quit and reopen the desktop app.'
    } finally { $secret = $null }
} })
$test.Add_Click({ Invoke-SetupAction {
    $secret = [SwsdDesktop.Credentials]::Read($script:SwsdCredentialTarget)
    try {
        if ([string]::IsNullOrWhiteSpace($secret)) { throw 'No token is saved. Paste one into the masked field, then select Test and save token.' }
        Test-SwsdToken -Token $secret -BaseUrl (Get-SwsdSettings).baseUrl
        $status.Text = 'Saved connection verified. SolarWinds accepted the token and allowed the read-only check.'
    } finally { $secret = $null }
} })
$remove.Add_Click({
    $choice = [Windows.Forms.MessageBox]::Show('Remove this computer''s saved SWSD token? Fully quit ChatGPT afterwards to end running connections. This does not revoke the token in SolarWinds.', 'Remove saved token', 'YesNo', 'Question')
    if ($choice -eq 'Yes') { Invoke-SetupAction {
        [SwsdDesktop.Credentials]::Remove($script:SwsdCredentialTarget)
        $tokenBox.Clear()
        $status.Text = 'Saved token removed. Fully quit ChatGPT to stop running connections. Revoke the token in SolarWinds if needed.'
    } }
})
$saveProfile.Add_Click({ Invoke-SetupAction {
    $selection = $script:SwsdProfiles[$profile.SelectedIndex]
    Save-SwsdProfile -Profile $selection.id
    $currentProfile.Text = 'Saved profile: ' + $selection.name
    $status.Text = 'Profile saved. Fully quit and reopen the desktop app, then start a new chat to load this tool set. Your saved token is unchanged.'
} })
if ($ValidateUi) {
    try {
        if (-not $tokenBox.UseSystemPasswordChar) { throw 'Token field must be masked.' }
        if ($profile.Items.Count -ne 5) { throw 'Five profile choices are required.' }
        if ($profile.SelectedItem -ne 'Agent') { throw 'New installations must default to Agent.' }
        $onClick = $saveProfile.GetType().GetMethod('OnClick', [Reflection.BindingFlags]'Instance,NonPublic')
        foreach ($index in 0..4) {
            $profile.SelectedIndex = $index
            $onClick.Invoke($saveProfile, @([EventArgs]::Empty))
            if ((Get-SwsdSettings).profile -ne $script:SwsdProfiles[$index].id) { throw 'Profile button failed to persist selection.' }
            if ($profileDescription.Text -ne $script:SwsdProfiles[$index].description) { throw 'Profile description did not update.' }
            if ($status.Text -notlike 'Profile saved.*') { throw 'Profile save did not display success and restart guidance.' }
        }
        Write-Output 'PASS: masked entry, Agent default, all five dropdown choices, actual Save profile event, persistence, descriptions, and restart guidance.'
    } finally {
        # Only delete the two explicitly named files created by this UI test.
        $settingsPath = Join-Path $script:SwsdHome 'settings.json'
        if (Test-Path -LiteralPath $settingsPath) { Remove-Item -LiteralPath $settingsPath -Force }
        if (Test-Path -LiteralPath $script:SwsdHome) { Remove-Item -LiteralPath $script:SwsdHome }
    }
} else {
    [void]$form.ShowDialog()
}
$tokenBox.Clear()
$form.Dispose()
