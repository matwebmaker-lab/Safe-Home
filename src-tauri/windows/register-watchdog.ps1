# Registers the Safe Home watchdog Windows service and writes ProgramData config.
# Seals host + launcher copies so the service can restore deleted binaries.
# Args: -ExePath <sh-host.exe> -WatchdogPath <watchdog.exe> [-LauncherPath <safe-home.exe>]
# Captures the interactive logon user SID (not the elevated admin identity).

param(
  [Parameter(Mandatory = $true)][string]$ExePath,
  [Parameter(Mandatory = $true)][string]$WatchdogPath,
  [Parameter(Mandatory = $false)][string]$LauncherPath
)

$ErrorActionPreference = 'Stop'

$serviceName = 'SafeHomeWatchdog'
$displayName = 'Safe Home Watchdog'
$programData = Join-Path $env:ProgramData 'Safe Home'
$configPath = Join-Path $programData 'watchdog.json'
$payloadDir = Join-Path $programData 'payload'

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

function Seal-Binary {
  param(
    [Parameter(Mandatory = $true)][string]$Source,
    [Parameter(Mandatory = $true)][string]$DestName
  )
  if (-not (Test-Path -LiteralPath $Source)) {
    throw "Cannot seal missing binary: $Source"
  }
  New-Item -ItemType Directory -Force -Path $payloadDir | Out-Null
  $dest = Join-Path $payloadDir $DestName
  Copy-Item -LiteralPath $Source -Destination $dest -Force
}

function New-RandomHex([int]$ByteCount) {
  $bytes = New-Object byte[] $ByteCount
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return -join ($bytes | ForEach-Object { $_.ToString('x2') })
}

function Harden-SaltFile([string]$SaltPath, [string]$SaltDir) {
  # Directory: traverse only for Users (no listing). File: read-only for Users.
  & icacls.exe $SaltDir /inheritance:r /grant:r "NT AUTHORITY\SYSTEM:(OI)(CI)F" /grant:r "BUILTIN\Administrators:(OI)(CI)F" /grant:r "BUILTIN\Users:(X)" | Out-Null
  & icacls.exe $SaltPath /inheritance:r /grant:r "NT AUTHORITY\SYSTEM:F" /grant:r "BUILTIN\Administrators:F" /grant:r "BUILTIN\Users:R" | Out-Null
}

# Per-machine PIN salt in a random ProgramData path (not in source, not next to config.json).
# Preserves an existing salt across upgrades.
function Ensure-PinSalt {
  if (Test-Path -LiteralPath $configPath) {
    try {
      $existing = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
      $prev = [string]$existing.salt_path
      if (-not [string]::IsNullOrWhiteSpace($prev) -and (Test-Path -LiteralPath $prev)) {
        $prevDir = Split-Path -Parent $prev
        Harden-SaltFile -SaltPath $prev -SaltDir $prevDir
        return $prev
      }
    } catch {
      # fall through and create a new salt
    }
  }

  $saltDir = Join-Path $env:ProgramData (New-RandomHex 16)
  New-Item -ItemType Directory -Force -Path $saltDir | Out-Null
  $saltPath = Join-Path $saltDir (New-RandomHex 16)
  $saltBytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($saltBytes)
  } finally {
    $rng.Dispose()
  }
  [System.IO.File]::WriteAllBytes($saltPath, $saltBytes)
  Harden-SaltFile -SaltPath $saltPath -SaltDir $saltDir
  return $saltPath
}

if (-not (Test-Path -LiteralPath $ExePath)) {
  throw "Host executable not found: $ExePath"
}
if (-not (Test-Path -LiteralPath $WatchdogPath)) {
  throw "Watchdog executable not found: $WatchdogPath"
}

if (-not $LauncherPath) {
  $LauncherPath = Join-Path (Split-Path -Parent $ExePath) 'safe-home.exe'
}

$sid = Get-InteractiveUserSid
New-Item -ItemType Directory -Force -Path $programData | Out-Null

# Sealed copies used by the service if someone deletes Program Files binaries.
Seal-Binary -Source $ExePath -DestName 'host.exe'
if (Test-Path -LiteralPath $LauncherPath) {
  Seal-Binary -Source $LauncherPath -DestName 'launcher.exe'
}

# Standard users must not be able to wipe the sealed restore copies.
& icacls.exe $payloadDir /inheritance:r /grant:r "NT AUTHORITY\SYSTEM:(OI)(CI)F" /grant:r "BUILTIN\Administrators:(OI)(CI)F" | Out-Null

$saltPath = Ensure-PinSalt

$config = @{
  target_user_sid = $sid
  exe_path        = $ExePath
  salt_path       = $saltPath
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
