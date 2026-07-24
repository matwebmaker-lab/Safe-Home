# Requires the same adult PIN as Safe Home (SHA-256 hex in config.json).
# Exit codes: 0 = allow uninstall, 1 = wrong/missing PIN, 2 = cancelled.

$ErrorActionPreference = 'Stop'

$configPath = Join-Path $env:APPDATA 'no.familie.safehome\config.json'

if (-not (Test-Path -LiteralPath $configPath)) {
  exit 0
}

try {
  $cfg = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
} catch {
  exit 0
}

$expected = [string]$cfg.pin_hash
if ([string]::IsNullOrWhiteSpace($expected)) {
  exit 0
}

Add-Type -AssemblyName System.Windows.Forms | Out-Null
Add-Type -AssemblyName System.Drawing | Out-Null

function Get-PinHash([string]$Pin) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Pin)
    $hash = $sha.ComputeHash($bytes)
    return ([System.BitConverter]::ToString($hash) -replace '-', '').ToLowerInvariant()
  } finally {
    $sha.Dispose()
  }
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
    if ((Get-PinHash $trimmed) -eq $expected.ToLowerInvariant()) {
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