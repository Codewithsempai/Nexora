; NEXORA NSIS custom installer hooks
; Preserves user data (%APPDATA%\nexora: encrypted Gemini key, memory vault, settings, reminders)
; across upgrades and reinstalls.

!macro customInit
  ; Ensure any running NEXORA instance closes gracefully before replacing binaries
  nsExec::ExecToLog 'taskkill /IM "NEXORA.exe" /T'
  Sleep 400
!macroend

!macro customInstall
  ; Write metadata markers if helpful, never overwrite userData
!macroend

!macro customUnInstall
  ; Close running NEXORA cleanly before uninstalling program files
  nsExec::ExecToLog 'taskkill /IM "NEXORA.exe" /T'
  Sleep 400
  ; Intentionally preserve $APPDATA\nexora so user settings, encrypted key, and memory vault are not lost accidentally.
!macroend
