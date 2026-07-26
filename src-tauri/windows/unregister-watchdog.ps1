# Stops and removes the Safe Home watchdog service and ProgramData files.

$ErrorActionPreference = 'SilentlyContinue'

$serviceName = 'SafeHomeWatchdog'
$programData = Join-Path $env:ProgramData 'Safe Home'
$configPath = Join-Path $programData 'watchdog.json'

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

# Remove install-time PIN salt (random path recorded in watchdog.json).
if (Test-Path -LiteralPath $configPath) {
  try {
    $wd = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $saltPath = [string]$wd.salt_path
    if (-not [string]::IsNullOrWhiteSpace($saltPath) -and (Test-Path -LiteralPath $saltPath)) {
      $saltDir = Split-Path -Parent $saltPath
      # Uninstall is elevated — reset ACLs then delete.
      & icacls.exe $saltPath /inheritance:e /grant:r "BUILTIN\Administrators:F" | Out-Null
      Remove-Item -LiteralPath $saltPath -Force -ErrorAction SilentlyContinue
      if ($saltDir -and (Test-Path -LiteralPath $saltDir)) {
        & icacls.exe $saltDir /inheritance:e /grant:r "BUILTIN\Administrators:F" | Out-Null
        $leftInSaltDir = @(Get-ChildItem -LiteralPath $saltDir -Force -ErrorAction SilentlyContinue)
        if ($leftInSaltDir.Count -eq 0) {
          Remove-Item -LiteralPath $saltDir -Force -ErrorAction SilentlyContinue
        }
      }
    }
  } catch {
    # ignore
  }
}

if (Test-Path -LiteralPath $programData) {
  Remove-Item -LiteralPath $configPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $programData 'watchdog.log') -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $programData 'watchdog.tamper') -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $programData 'heartbeat') -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $programData 'config.pending.json') -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $programData 'config.seal') -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $programData 'payload') -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $pausePath -Force -ErrorAction SilentlyContinue
  # Remove dir only if empty.
  $left = @(Get-ChildItem -LiteralPath $programData -Force -ErrorAction SilentlyContinue)
  if ($left.Count -eq 0) {
    Remove-Item -LiteralPath $programData -Force -ErrorAction SilentlyContinue
  }
}

exit 0
