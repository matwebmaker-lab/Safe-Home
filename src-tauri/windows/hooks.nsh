; PIN-gated uninstall for Safe Home.
; Skipped when the updater runs the uninstaller with /UPDATE.

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    ; Silent uninstall would skip the PIN dialog - block it.
    ${If} ${Silent}
      Abort
    ${EndIf}

    StrCpy $R7 "$INSTDIR\uninstall-pin.ps1"
    ${If} ${FileExists} "$R7"
      ClearErrors
      ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$R7"' $R8
      ${If} ${Errors}
      ${OrIf} $R8 <> 0
        MessageBox MB_OK|MB_ICONSTOP "Safe Home ble ikke avinstallert.$\r$\n$\r$\nDu må taste inn riktig PIN-kode (samme som i appen)."
        Abort
      ${EndIf}
    ${Else}
      MessageBox MB_OK|MB_ICONSTOP "Finner ikke PIN-sjekk for avinstallering.$\r$\nAvinstallering er avbrutt."
      Abort
    ${EndIf}
  ${EndIf}
!macroend
