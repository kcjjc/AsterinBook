; Book libraries and the small bootstrap pointer live outside $INSTDIR.
; Keep all reading data on upgrade/uninstall; there are deliberately no RMDir
; or Delete commands for user-selected libraries or $APPDATA here.
!macro NSIS_HOOK_PREINSTALL
!macroend
!macro NSIS_HOOK_POSTINSTALL
!macroend
!macro NSIS_HOOK_PREUNINSTALL
!macroend
!macro NSIS_HOOK_POSTUNINSTALL
!macroend
