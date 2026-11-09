$ErrorActionPreference = 'Stop'
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$vs) { throw 'Visual C++ build tools required on the Windows cloud runner' }
$output = Join-Path (Get-Location) 'build\x86-unicode'
New-Item -ItemType Directory -Force $output | Out-Null
$source = Join-Path (Get-Location) 'build\shell-plugin\FixFlowShell.cpp'
$definition = Join-Path (Get-Location) 'build\shell-plugin\FixFlowShell.def'
$dev = Join-Path $vs 'Common7\Tools\VsDevCmd.bat'
# Windows APIs only: no C/C++ runtime dependency or static runtime redistribution.
$command = "call `"$dev`" -arch=x86 -host_arch=x64 && cl /nologo /O2 /GS /GR- /W4 /WX /Zl /LD /DUNICODE /D_UNICODE `"$source`" /Fo`"$output\FixFlowShell.obj`" /link /NODEFAULTLIB /ENTRY:DllMain /DYNAMICBASE /NXCOMPAT /DEF:`"$definition`" /OUT:`"$output\FixFlowShell.dll`" kernel32.lib user32.lib ole32.lib shell32.lib uuid.lib"
& cmd.exe /d /s /c $command
if ($LASTEXITCODE -ne 0) { throw 'FixFlowShell compilation failed' }
$imports = & cmd.exe /d /s /c "call `"$dev`" -arch=x86 -host_arch=x64 >nul && dumpbin /dependents `"$output\FixFlowShell.dll`""
if ($LASTEXITCODE -ne 0 -or ($imports -match '(?i)VCRUNTIME|MSVCP|api-ms-win-crt')) { throw 'Unexpected C/C++ runtime dependency in shell plugin' }
