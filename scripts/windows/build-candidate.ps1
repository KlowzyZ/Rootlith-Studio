# Run from the repository root in Windows PowerShell 5.1+, in a disposable VM.
param([Parameter(Mandatory=$true)][string]$EvidenceDirectory)
$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'Native Windows required' }
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Use a standard, non-elevated account' }
$nodeVersion = & node --version
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v24\.') { throw 'Node.js 24 required' }
if (git status --porcelain) { throw 'Build only a clean committed checkout' }
if (Test-Path release) { throw 'Use a fresh checkout without release/ to avoid stale candidates' }
New-Item -ItemType Directory -Path $EvidenceDirectory -ErrorAction Stop | Out-Null
$evidence = (Resolve-Path $EvidenceDirectory).Path
Start-Transcript -Path (Join-Path $evidence 'build.log') | Out-Null
try {
    $commit = git rev-parse HEAD
    $toolchain = @{ node = (node -v); npm = (npm.cmd -v); os = [Environment]::OSVersion.VersionString }
    foreach ($arguments in @(@('ci'), @('run','lint'), @('run','typecheck'), @('test'), @('run','build'), @('run','verify:identity'), @('run','audit:deps'), @('run','package:win'))) {
        & npm.cmd @arguments
        if ($LASTEXITCODE -ne 0) { throw "npm $arguments failed ($LASTEXITCODE)" }
    }
    Copy-Item release/PACKAGE_CONTENTS.json $evidence
    @{ commit = $commit; lockfileSha256 = (Get-FileHash package-lock.json -Algorithm SHA256).Hash; toolchain = $toolchain;
       nativeAcceptance = 'NOT RUN'; signing = 'NOT VERIFIED'; publicationAuthorized = $false } |
        ConvertTo-Json -Depth 5 | Set-Content (Join-Path $evidence 'BUILD_INFO.json') -Encoding UTF8
    Get-ChildItem release/*.exe | ForEach-Object {
        $signature = Get-AuthenticodeSignature $_.FullName
        [PSCustomObject]@{ file = $_.Name; sha256 = (Get-FileHash $_.FullName -Algorithm SHA256).Hash;
            signatureStatus = [string]$signature.Status; subject = $signature.SignerCertificate.Subject }
    } | ConvertTo-Json | Set-Content (Join-Path $evidence 'SIGNATURES.json') -Encoding UTF8
} finally { Stop-Transcript | Out-Null }
