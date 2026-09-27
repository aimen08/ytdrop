$ErrorActionPreference = 'Stop'
$registryPath = 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.ytdrop.downloader'
if (Test-Path -LiteralPath $registryPath) { Remove-Item -LiteralPath $registryPath }
Write-Host 'YT Drop helper unregistered. Remove the extension at chrome://extensions.'
Write-Host 'Downloads are preserved. After closing Chrome, you may delete %LOCALAPPDATA%\YTDrop to remove the helper files.'
