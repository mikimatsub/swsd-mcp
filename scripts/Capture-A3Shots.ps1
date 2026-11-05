param([string]$OutputDirectory=(Join-Path $PSScriptRoot '../review-shots'))
$ErrorActionPreference='Stop'
$previousTheme=$env:SWSD_THEME
$previousModules=$env:PSModulePath
try {
    $env:PSModulePath=$null
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
    $scriptPath=Join-Path $PSScriptRoot '../plugins/swsd/scripts/Manage-Swsd.ps1'
    foreach ($theme in @('light','dark')) {
        $env:SWSD_THEME=$theme
        foreach ($state in @('ready','firstrun','jwt-help','error','tools','tool-detail')) {
            $path=Join-Path $OutputDirectory "app-$state-$theme.png"
            $output=& powershell.exe -NoProfile -NonInteractive -STA -WindowStyle Hidden -File $scriptPath -ValidateWindow -PreviewState $state -ScreenshotPath $path
            if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $path)) {throw "Capture failed: $state / $theme"}
            $output | Set-Content -LiteralPath (Join-Path $OutputDirectory "app-$state-$theme.json") -Encoding UTF8
            Write-Output "Captured $path"
        }
    }
} finally {$env:SWSD_THEME=$previousTheme; $env:PSModulePath=$previousModules}
