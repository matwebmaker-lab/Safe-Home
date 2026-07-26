# Registers the Safe Home watchdog Windows service and writes ProgramData config.
# Args: -ExePath <main.exe> -WatchdogPath <watchdog.exe>
# Captures the interactive logon user SID (not the elevated admin identity).

param(
  [Parameter(Mandatory = $true)][string]$ExePath,
  [Parameter(Mandatory = $true)][string]$WatchdogPath
)

$ErrorActionPreference = 'Stop'

$serviceName = 'SafeHomeWatchdog'
$displayName = 'Safe Home Watchdog'
$programData = Join-Path $env:ProgramData 'Safe Home'
$configPath = Join-Path $programData 'watchdog.json'

function Get-InteractiveUserSid {
  # Prefer the owner of explorer.exe in the active console session.
  try {
    $sessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
    $explorers = @(Get-Process -Name explorer -ErrorAction SilentlyContinue | Where-Object { $_.SessionId -eq $sessionId })
    if (-not $explorers -or $explorers.Count -eq 0) {
      $explorers = @(Get-Process -Name explorer -ErrorAction SilentlyContinue)
    }
    if ($explorers -and $explorers.Count -gt 0) {
      $proc = Get-CimInstance Win32_Process -Filter ("ProcessId = {0}" -f $explorers[0].Id)
      $owner = Invoke-CimMethod -InputObject $proc -MethodName GetOwner
      if ($owner -and $owner.User) {
        $account = if ($owner.Domain) { "{0}\{1}" -f $owner.Domain, $owner.User } else { $owner.User }
        $nt = New-Object System.Security.Principal.NTAccount($account)
        return $nt.Translate([System.Security.Principal.SecurityIdentifier]).Value
      }
    }
  } catch {
    # fall through
  }

  # Fallback: Win32_ComputerSystem logged-on user.
  $cs = Get-CimInstance Win32_ComputerSystem
  if ($cs.UserName) {
    $nt = New-Object System.Security.Principal.NTAccount($cs.UserName)
    return $nt.Translate([System.Security.Principal.SecurityIdentifier]).Value
  }

  throw 'Could not determine interactive user SID for watchdog.'
}

if (-not (Test-Path -LiteralPath $ExePath)) {
  throw "Main executable not found: $ExePath"
}
if (-not (Test-Path -LiteralPath $WatchdogPath)) {
  throw "Watchdog executable not found: $WatchdogPath"
}

$sid = Get-InteractiveUserSid
New-Item -ItemType Directory -Force -Path $programData | Out-Null

$config = @{
  target_user_sid = $sid
  exe_path        = $ExePath
} | ConvertTo-Json -Compress

Set-Content -LiteralPath $configPath -Value $config -Encoding UTF8

# Stop/delete existing service so the binary can be replaced on upgrade.
$existing = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($existing) {
  if ($existing.Status -ne 'Stopped') {
    Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
  }
  & sc.exe delete $serviceName | Out-Null
  Start-Sleep -Seconds 1
}

New-Service -Name $serviceName `
  -BinaryPathName "`"$WatchdogPath`"" `
  -DisplayName $displayName `
  -StartupType Automatic | Out-Null

& sc.exe description $serviceName "Restarts Safe Home if it is closed unexpectedly." | Out-Null
# Restart the watchdog itself quickly if someone kills the service process.
& sc.exe failure $serviceName reset= 86400 actions= restart/1000/restart/1000/restart/1000 | Out-Null
Start-Service -Name $serviceName
