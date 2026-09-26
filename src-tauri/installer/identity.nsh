; productName changes NSIS registration, but not the Tauri database identity.
; Migrate the previous registration only when upgrading the same installation.
Var LegacyBrandLocation

!macro BrandPreInstall OLDNAME
  ReadRegStr $LegacyBrandLocation SHCTX "${MANUKEY}\${OLDNAME}" ""
  ${If} $LegacyBrandLocation != ""
  ${AndIf} ${FileExists} "$LegacyBrandLocation\${MAINBINARYNAME}.exe"
    ; Respect a custom destination chosen by the user; otherwise reuse the old one.
    ${If} $INSTDIR == "$LOCALAPPDATA\${PRODUCTNAME}"
      StrCpy $INSTDIR $LegacyBrandLocation
      SetOutPath $INSTDIR
    ${EndIf}
  ${EndIf}
!macroend

!macro BrandPostInstall OLDNAME
  ${If} $LegacyBrandLocation != ""
  ${AndIf} $LegacyBrandLocation == $INSTDIR
    ; The new registration has already been written by Tauri at this point.
    DeleteRegKey SHCTX "Software\Microsoft\Windows\CurrentVersion\Uninstall\${OLDNAME}"
    DeleteRegKey SHCTX "${MANUKEY}\${OLDNAME}"
    !insertmacro IsShortcutTarget "$SMPROGRAMS\${OLDNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      Delete "$SMPROGRAMS\${OLDNAME}.lnk"
    ${EndIf}
    !insertmacro IsShortcutTarget "$DESKTOP\${OLDNAME}.lnk" "$INSTDIR\${MAINBINARYNAME}.exe"
    Pop $0
    ${If} $0 = 1
      Delete "$DESKTOP\${OLDNAME}.lnk"
    ${EndIf}
  ${EndIf}
!macroend

; Tauri includes this file before defining BUNDLEID: evaluate it inside hooks.
!macro NSIS_HOOK_PREINSTALL
  !if "${BUNDLEID}" == "com.dinheirovisk.desktop"
    !insertmacro BrandPreInstall "Dinheirovisk"
  !else if "${BUNDLEID}" == "com.dinheirovisk.validation.acceptance"
    !insertmacro BrandPreInstall "Dinheirovisk Acceptance"
  !endif
!macroend

!macro NSIS_HOOK_POSTINSTALL
  !if "${BUNDLEID}" == "com.dinheirovisk.desktop"
    !insertmacro BrandPostInstall "Dinheirovisk"
  !else if "${BUNDLEID}" == "com.dinheirovisk.validation.acceptance"
    !insertmacro BrandPostInstall "Dinheirovisk Acceptance"
  !endif
!macroend
