# Read-only: snapshot only durable application records, not Chromium caches.
param(
    [Parameter(Mandatory=$true)][string]$EvidenceFile,
    [string]$CompareWith
)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Native Windows required' }
if (Get-Process -Name 'FixFlow Studio' -ErrorAction SilentlyContinue) { throw 'Close all installed and portable instances first' }
$profile = Join-Path $env:APPDATA 'fixflow-studio'
if (!(Test-Path (Join-Path $profile 'ROOTLITH-SYNTHETIC-VALIDATION.txt'))) { throw 'Synthetic test-profile marker required; never snapshot the owner workspace' }
if (Test-Path $EvidenceFile) { throw 'Choose a new evidence filename' }
$files = @()
if (Test-Path (Join-Path $profile 'fixflow-data')) {
    $files += Get-ChildItem (Join-Path $profile 'fixflow-data') -File -Recurse
}
if (Test-Path (Join-Path $profile 'update-preferences.json')) { $files += Get-Item (Join-Path $profile 'update-preferences.json') }
$rows = @($files | Sort-Object FullName | ForEach-Object {
    if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unexpected profile reparse point' }
    [PSCustomObject]@{ path = $_.FullName.Substring($profile.Length + 1); bytes = $_.Length; sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash }
})
if (!$rows.Count) { throw 'No durable records found' }
$report = @{ capturedUtc = [DateTime]::UtcNow.ToString('o'); profile = $profile; files = $rows; comparison = 'NOT REQUESTED' }
if ($CompareWith) {
    $before = Get-Content $CompareWith -Raw | ConvertFrom-Json
    if ($before.profile -ne $profile) { throw 'Profile mismatch' }
    $delta = @(Compare-Object @($before.files | ForEach-Object { "$($_.path)|$($_.bytes)|$($_.sha256)" }) @($rows | ForEach-Object { "$($_.path)|$($_.bytes)|$($_.sha256)" }))
    $report.comparison = if ($delta.Count) { 'DIFFERENT: inspect expected edits/recovery/preferences; not an automatic acceptance' } else { 'IDENTICAL durable bytes' }
    $report.differences = $delta
}
$report | ConvertTo-Json -Depth 6 | Set-Content $EvidenceFile -Encoding UTF8
Write-Output $report.comparison
