# Stops and removes the Safe Home watchdog service and ProgramData files.

$ErrorActionPreference = 'SilentlyContinue'

$serviceName = 'SafeHomeWatchdog'
$programData = Join-Path $env:ProgramData 'Safe Home'

$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existing) {
  if ($existing.Status -ne 'Stopped') {
    Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
  }
  & sc.exe delete $serviceName | Out-Null
  Start-Sleep -Seconds 1
}

# Pause marker so a half-removed install cannot race a respawn.
$pausePath = Join-Path $programData 'watchdog.pause'
New-Item -ItemType Directory -Force -Path $programData | Out-Null
Set-Content -LiteralPath $pausePath -Value '' -Encoding UTF8

if (Test-Path -LiteralPath $programData) {
  Remove-Item -LiteralPath (Join-Path $programData 'watchdog.json') -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $programData 'watchdog.log') -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $programData 'watchdog.tamper') -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $programData 'heartbeat') -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $pausePath -Force -ErrorAction SilentlyContinue
  # Remove dir only if empty.
  $left = @(Get-ChildItem -LiteralPath $programData -Force -ErrorAction SilentlyContinue)
  if ($left.Count -eq 0) {
    Remove-Item -LiteralPath $programData -Force -ErrorAction SilentlyContinue
  }
}

exit 0
