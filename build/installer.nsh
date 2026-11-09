; Copyright (c) 2026 KLOWZY. SPDX-License-Identifier: MIT
; Functions return an HRESULT and consume exactly their documented arguments.
; Shell cleanup is best effort on Windows versions without the legacy pin interface.
!macro FixFlowShell_SetLnkAUMI file id
  Push $R9
  FixFlowShell::SetLnkAUMI "${file}" "${id}"
  Pop $R9
  ${If} $R9 < 0
    DetailPrint "Shortcut identity could not be saved ($R9)"
    SetErrors
  ${EndIf}
  Pop $R9
!macroend
!macro FixFlowShell_UninstShortcut file
  Push $R9
  FixFlowShell::UninstShortcut "${file}"
  Pop $R9
  Pop $R9
!macroend
!macro FixFlowShell_UninstAppUserModelId id
  Push $R9
  FixFlowShell::UninstAppUserModelId "${id}"
  Pop $R9
  Pop $R9
!macroend

; Visible preview labels only. Product filename, install directory and GUID remain legacy.
!macro customHeader
  Caption "Rootlith Studio Setup"
  UninstallCaption "Rootlith Studio Uninstall"
!macroend
