# ASCII-only guard so Windows PowerShell 5.1 can run it without a BOM itself.
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '../../plugins/swsd')).Path
# npm creates its own ASCII shims during CI; those are not shipped source scripts.
$files = @(Get-ChildItem -LiteralPath $root -Recurse -Filter '*.ps1' -File | Where-Object { $_.FullName -notmatch '[\\/]node_modules[\\/]' })
if ($files.Count -eq 0) { throw 'No shipped PowerShell scripts found.' }
$utf8 = New-Object Text.UTF8Encoding($false, $true)
$markers = @(@(0xe2,0x20ac), @(0xc2,0xb7), @(0xe2,0x153), @(0xe2,0x2013,0xa1), @(0xc3,0x2014), @(0xe2,0x2020))
foreach ($file in $files) {
    $bytes = [IO.File]::ReadAllBytes($file.FullName)
    # Require a BOM even for today's ASCII-only launcher: future edits stay safe.
    if ($bytes.Length -lt 3 -or $bytes[0] -ne 0xef -or $bytes[1] -ne 0xbb -or $bytes[2] -ne 0xbf) {
        throw "Shipped script requires a UTF-8 BOM (EF BB BF): $($file.FullName)"
    }
    $source = $utf8.GetString($bytes, 3, $bytes.Length - 3)
    foreach ($codes in $markers) {
        $marker = -join @($codes | ForEach-Object { [char]$_ })
        if ($source.Contains($marker)) { throw "Literal mojibake marker in $($file.FullName)" }
    }
    $tokens = $null; $parseErrors = $null
    $ast = [Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count) { throw "Invalid PowerShell syntax in $($file.FullName): $parseErrors" }
    $reads = $ast.FindAll({param($node) $node -is [Management.Automation.Language.CommandAst] -and $node.GetCommandName() -eq 'Get-Content'}, $true)
    foreach ($read in $reads) {
        if (-not @($read.CommandElements | Where-Object { $_ -is [Management.Automation.Language.CommandParameterAst] -and $_.ParameterName -eq 'Encoding' }).Count) {
            throw "Get-Content requires explicit UTF-8 in $($file.FullName):$($read.Extent.StartLineNumber)"
        }
    }
}
Write-Output "PASS: $($files.Count) shipped scripts have UTF-8 BOMs, valid UTF-8, no mojibake, and explicit Get-Content encoding."
