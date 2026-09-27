param([string]$DownloadDirectory = (Join-Path $env:USERPROFILE 'Downloads\YT Drop'))
$ErrorActionPreference = 'Stop'
$installRoot = Join-Path $env:LOCALAPPDATA 'YTDrop'

function Assert-Exit([string]$Step) {
    if ($LASTEXITCODE -ne 0) { throw "$Step failed (exit $LASTEXITCODE)." }
}
function Find-Executable([string]$Name) {
    $found = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { return $found.Source }
    return $null
}
function Write-Utf8([string]$Path, [string]$Text) {
    [System.IO.File]::WriteAllText($Path, $Text, (New-Object System.Text.UTF8Encoding($false)))
}

$pythonExe = Find-Executable 'python.exe'
if (-not $pythonExe) { throw 'Install Python 3.10+ from https://www.python.org/downloads/windows/ and enable Add to PATH. Open a new PowerShell and retry.' }
& $pythonExe -c 'import sys; assert sys.version_info >= (3,10), "Python 3.10+ required"'
Assert-Exit 'Python version check'
$ffmpegExe = Find-Executable 'ffmpeg.exe'
$ffprobeExe = Find-Executable 'ffprobe.exe'
if (-not $ffmpegExe -or -not $ffprobeExe) { throw 'Install FFmpeg: winget install --id Gyan.FFmpeg -e. Open a new PowerShell and retry.' }
$runtimeName = 'deno'
$runtimeExe = Find-Executable 'deno.exe'
if ($runtimeExe) {
    $runtimeVersion = (& $runtimeExe --version | Select-Object -First 1) -replace '^deno\s+', ''
    if ([version](($runtimeVersion -split ' ')[0]) -lt [version]'2.3.0') { $runtimeExe = $null }
}
if (-not $runtimeExe) {
    $runtimeName = 'node'
    $runtimeExe = Find-Executable 'node.exe'
    if ($runtimeExe) {
        $runtimeVersion = (& $runtimeExe --version).TrimStart('v')
        if ([version]$runtimeVersion -lt [version]'22.0.0') { $runtimeExe = $null }
    }
}
if (-not $runtimeExe) { throw 'Install Deno 2.3+ (winget install --id DenoLand.Deno -e) or Node.js 22+. Open a new PowerShell and retry.' }

New-Item -ItemType Directory -Path $installRoot -Force | Out-Null
# Resolve Windows junctions and packaged-app filesystem redirection so an
# external Chrome process can reach exactly the same installation.
$installRoot = (& $pythonExe -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' $installRoot).Trim()
Assert-Exit 'Resolving installation directory'
$venvDirectory = Join-Path $installRoot 'venv'
if (-not (Test-Path -LiteralPath (Join-Path $venvDirectory 'Scripts\python.exe'))) {
    & $pythonExe -m venv $venvDirectory
    Assert-Exit 'Creating local Python environment'
}
$hostPython = Join-Path $venvDirectory 'Scripts\python.exe'
& $hostPython -m pip install --disable-pip-version-check --upgrade 'yt-dlp[default]'
Assert-Exit 'Installing yt-dlp and YouTube challenge scripts'

Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'extension') -Destination $installRoot -Recurse -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'native') -Destination $installRoot -Recurse -Force
$nativeDirectory = Join-Path $installRoot 'native'
$outputDirectory = [System.IO.Path]::GetFullPath($DownloadDirectory)
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$configJson = @{ download_dir = $outputDirectory; ffmpeg = $ffmpegExe; ffprobe = $ffprobeExe; runtime = $runtimeName; runtime_path = $runtimeExe } | ConvertTo-Json
Write-Utf8 (Join-Path $nativeDirectory 'config.json') $configJson

$hostScript = Join-Path $nativeDirectory 'host.py'
# Escape percent signs because the launcher is interpreted by cmd.exe. Quoted
# absolute paths also handle spaces and shell metacharacters in user profiles.
$batchPython = $hostPython.Replace('%', '%%')
$batchScript = $hostScript.Replace('%', '%%')
$launcher = Join-Path $nativeDirectory 'launch.cmd'
@('@echo off', 'setlocal DisableDelayedExpansion', ('"{0}" -u "{1}"' -f $batchPython, $batchScript)) |
    Set-Content -LiteralPath $launcher -Encoding Default

$extensionManifest = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'extension\manifest.json') -Raw | ConvertFrom-Json
$publicKey = [Convert]::FromBase64String($extensionManifest.key)
$sha = [System.Security.Cryptography.SHA256]::Create()
try { $digest = $sha.ComputeHash($publicKey) } finally { $sha.Dispose() }
$extensionId = -join ($digest[0..15] | ForEach-Object { [char](97 + ($_ -shr 4)); [char](97 + ($_ -band 15)) })
$manifestPath = Join-Path $nativeDirectory 'com.ytdrop.downloader.json'
$nativeJson = @{ name = 'com.ytdrop.downloader'; description = 'YT Drop local yt-dlp helper'; path = $launcher; type = 'stdio'; allowed_origins = @("chrome-extension://$extensionId/") } | ConvertTo-Json
Write-Utf8 $manifestPath $nativeJson
$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.ytdrop.downloader'
New-Item -Path $registryPath -Force | Out-Null
Set-Item -Path $registryPath -Value $manifestPath
Write-Host "`nYT Drop is ready." -ForegroundColor Green
Write-Host '1. Open chrome://extensions and enable Developer mode.'
Write-Host '2. Click Load unpacked and choose:'
Write-Host (Join-Path $installRoot 'extension') -ForegroundColor Cyan
Write-Host '3. Pin YT Drop, open a YouTube video, and click Download.'
Write-Host "Extension ID: $extensionId"
Write-Host "Downloads: $outputDirectory"
