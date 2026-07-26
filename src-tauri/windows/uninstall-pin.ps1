# Requires the same adult PIN as Safe Home.
# Hash: legacy SHA256(pin), or salted SHA256("safe-home-pin-v1" || len_le || salt || pin)
# when config.pin_salted is true. Salt path comes from ProgramData watchdog.json.
# Looks in AppData first, then the hardened ProgramData seal, then pending.
# Exit codes: 0 = allow uninstall, 1 = wrong/missing PIN, 2 = cancelled.

$ErrorActionPreference = 'Stop'

function Get-ConfigFromFile([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }
  try {
    return Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Get-SecuredPinConfig([object]$cfg) {
  if ($null -eq $cfg) { return $null }
  $hash = [string]$cfg.pin_hash
  if ([string]::IsNullOrWhiteSpace($hash)) { return $null }
  if ($cfg.PSObject.Properties.Name -contains 'configured' -and $cfg.configured -eq $false) {
    return $null
  }
  return $cfg
}

$appDataConfig = Join-Path $env:APPDATA 'no.familie.safehome\config.json'
$sealedConfig = Join-Path $env:ProgramData 'Safe Home\config.seal'
$pendingConfig = Join-Path $env:ProgramData 'Safe Home\config.pending.json'

$cfg = Get-SecuredPinConfig (Get-ConfigFromFile $appDataConfig)
if (-not $cfg) { $cfg = Get-SecuredPinConfig (Get-ConfigFromFile $sealedConfig) }
if (-not $cfg) { $cfg = Get-SecuredPinConfig (Get-ConfigFromFile $pendingConfig) }

if (-not $cfg) {
  # No PIN set yet (first-run setup not completed).
  exit 0
}

$expected = ([string]$cfg.pin_hash).ToLowerInvariant()
$pinSalted = $false
if ($cfg.PSObject.Properties.Name -contains 'pin_salted') {
  $pinSalted = [bool]$cfg.pin_salted
}

$saltBytes = $null
if ($pinSalted) {
  $watchdogPath = Join-Path $env:ProgramData 'Safe Home\watchdog.json'
  if (-not (Test-Path -LiteralPath $watchdogPath)) {
    exit 1
  }
  try {
    $wd = Get-Content -LiteralPath $watchdogPath -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    exit 1
  }
  $saltPath = [string]$wd.salt_path
  if ([string]::IsNullOrWhiteSpace($saltPath) -or -not (Test-Path -LiteralPath $saltPath)) {
    exit 1
  }
  $saltBytes = [System.IO.File]::ReadAllBytes($saltPath)
  if ($saltBytes.Length -lt 16) {
    exit 1
  }
}

Add-Type -AssemblyName System.Windows.Forms | Out-Null
Add-Type -AssemblyName System.Drawing | Out-Null

function Get-Sha256Hex([byte[]]$Bytes) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $hash = $sha.ComputeHash($Bytes)
    return ([System.BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
}

function Get-PinDigest([string]$Pin) {
  $pinBytes = [System.Text.Encoding]::UTF8.GetBytes($Pin)
  if (-not $script:pinSalted) {
    return Get-Sha256Hex $pinBytes
  }

  $label = [System.Text.Encoding]::UTF8.GetBytes('safe-home-pin-v1')
  $len = [BitConverter]::GetBytes([uint32]$script:saltBytes.Length)
  if (-not [BitConverter]::IsLittleEndian) {
    [Array]::Reverse($len)
  }
  $payload = New-Object byte[] ($label.Length + $len.Length + $script:saltBytes.Length + $pinBytes.Length)
  [Array]::Copy($label, 0, $payload, 0, $label.Length)
  [Array]::Copy($len, 0, $payload, $label.Length, $len.Length)
  [Array]::Copy($script:saltBytes, 0, $payload, ($label.Length + $len.Length), $script:saltBytes.Length)
  [Array]::Copy($pinBytes, 0, $payload, ($label.Length + $len.Length + $script:saltBytes.Length), $pinBytes.Length)
  return Get-Sha256Hex $payload
}

function Show-PinDialog {
  $form = New-Object System.Windows.Forms.Form
  $form.Text = 'Safe Home'
  $form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedDialog
  $form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
  $form.MaximizeBox = $false
  $form.MinimizeBox = $false
  $form.ShowInTaskbar = $true
  $form.TopMost = $true
  $form.ClientSize = New-Object System.Drawing.Size(380, 158)

  $label = New-Object System.Windows.Forms.Label
  $label.Text = "Skriv inn PIN-koden for å avinstallere Safe Home.`nKun en voksen skal kunne gjøre dette."
  $label.Location = New-Object System.Drawing.Point(14, 12)
  $label.Size = New-Object System.Drawing.Size(350, 42)

  $box = New-Object System.Windows.Forms.TextBox
  $box.Location = New-Object System.Drawing.Point(14, 60)
  $box.Size = New-Object System.Drawing.Size(350, 24)
  $box.UseSystemPasswordChar = $true
  $box.MaxLength = 8

  $ok = New-Object System.Windows.Forms.Button
  $ok.Text = 'Avinstaller'
  $ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
  $ok.Location = New-Object System.Drawing.Point(188, 108)
  $ok.Size = New-Object System.Drawing.Size(90, 28)

  $cancel = New-Object System.Windows.Forms.Button
  $cancel.Text = 'Avbryt'
  $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
  $cancel.Location = New-Object System.Drawing.Point(284, 108)
  $cancel.Size = New-Object System.Drawing.Size(80, 28)

  $form.AcceptButton = $ok
  $form.CancelButton = $cancel
  $form.Controls.AddRange(@($label, $box, $ok, $cancel)) | Out-Null

  $result = $form.ShowDialog()
  $pin = $box.Text
  $form.Dispose()

  if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
    return $null
  }
  return $pin
}

$maxAttempts = 3
for ($i = 0; $i -lt $maxAttempts; $i++) {
  $pin = Show-PinDialog
  if ($null -eq $pin) {
    exit 2
  }

  $trimmed = $pin.Trim()
  if ($trimmed.Length -ge 4 -and $trimmed.Length -le 8 -and $trimmed -match '^\d+$') {
    if ((Get-PinDigest $trimmed) -eq $expected) {
      exit 0
    }
  }

  [System.Windows.Forms.MessageBox]::Show(
    "Feil PIN-kode. Prøv igjen.",
    'Safe Home',
    [System.Windows.Forms.MessageBoxButtons]::OK,
    [System.Windows.Forms.MessageBoxIcon]::Error
  ) | Out-Null
}

exit 1
