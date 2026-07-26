; PIN-gated uninstall + Safe Home Watchdog Windows service registration.
; Watchdog/PIN skipped appropriately when the updater runs with /UPDATE.

!macro NSIS_HOOK_PREINSTALL
  ; Stop the watchdog so install can replace binaries (fresh install or update).
  StrCpy $R7 "$INSTDIR\unregister-watchdog.ps1"
  ${If} ${FileExists} "$R7"
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$R7"'
  ${Else}
    ; First install (files not copied yet) or missing script — best-effort sc stop.
    ExecWait '"$SYSDIR\sc.exe" stop SafeHomeWatchdog'
    ExecWait '"$SYSDIR\sc.exe" delete SafeHomeWatchdog'
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Register watchdog for the interactive logon user (child account).
  ; MAINBINARYNAME is sh-host (lock UI); safe-home.exe is the public launcher.
  StrCpy $R7 "$INSTDIR\register-watchdog.ps1"
  ${If} ${FileExists} "$R7"
    ClearErrors
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$R7" -ExePath "$INSTDIR\${MAINBINARYNAME}.exe" -WatchdogPath "$INSTDIR\safe-home-watchdog.exe" -LauncherPath "$INSTDIR\safe-home.exe"' $R8
    ${If} ${Errors}
    ${OrIf} $R8 <> 0
      DetailPrint "Warning: Safe Home Watchdog service was not registered (exit $R8)."
    ${EndIf}
  ${EndIf}

  ; Point Start Menu / desktop shortcuts at the launcher so the obvious name
  ; is not the process that stays running in Task Manager.
  ${If} ${FileExists} "$INSTDIR\safe-home.exe"
    CreateShortCut "$SMPROGRAMS\Safe Home.lnk" "$INSTDIR\safe-home.exe" "" "$INSTDIR\safe-home.exe" 0
    ${If} ${FileExists} "$DESKTOP\Safe Home.lnk"
      CreateShortCut "$DESKTOP\Safe Home.lnk" "$INSTDIR\safe-home.exe" "" "$INSTDIR\safe-home.exe" 0
    ${EndIf}
  ${EndIf}
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Always stop the service before files are removed (update and normal uninstall).
  StrCpy $R7 "$INSTDIR\unregister-watchdog.ps1"
  ${If} ${FileExists} "$R7"
    ExecWait '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "$R7"'
  ${Else}
    ExecWait '"$SYSDIR\sc.exe" stop SafeHomeWatchdog'
    ExecWait '"$SYSDIR\sc.exe" delete SafeHomeWatchdog'
  ${EndIf}

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
