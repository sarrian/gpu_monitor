; shortcuts.nsh — let the user choose desktop / Start Menu shortcuts at install time.
;
; electron-builder's assisted installer creates BOTH shortcuts by default. This file
; (wired in via build.nsis.include) asks the user about each, then a customInstall
; step deletes whichever one they declined.
;
; Why MessageBox + customInit (not a custom checkbox page): this NSIS build (3.0.4.1)
; promotes makensis warnings to hard build errors, and fires on (a) a dot-Function
; referenced only from inside a !macro (warning 6010) and (b) a Var unused in a given
; build (warning 6001). So the ask is inlined into the customInit macro body, and the
; whole feature is scoped to the installer build (!ifndef BUILD_UNINSTALLER) so the
; uninstaller build (which never calls these hooks) declares no dead Vars.
;
; Fresh installs: the two Yes/No prompts appear up front; the user chooses.
; Silent in-app update: the prompts are skipped (Silent), so both shortcuts are
; preserved — an update never strips shortcuts the user already chose.
!ifndef GPU_SHORTCUTS_NSH
!define GPU_SHORTCUTS_NSH

!ifndef BUILD_UNINSTALLER
  !include "LogicLib.nsh"   ; ${if}/${endif} — include ourselves so it's defined here regardless of order

  Var /GLOBAL swDesktop      ; "1" = create desktop shortcut (default), "0" = skip
  Var /GLOBAL swStartMenu    ; "1" = create Start Menu shortcut (default), "0" = skip

  ; ── Ask the user. Inlined into the macro body (not a dot-Function, which NSIS
  ;    flags as "unreferenced" when called only from a !macro). Runs in .onInit,
  ;    before the wizard. Silent installs skip and keep both. ──
  !macro customInit
    ; Defaults = create both (matches the pre-feature default and the silent-update path).
    StrCpy $swDesktop   "1"
    StrCpy $swStartMenu "1"
    ${if} ${Silent}
      Return
    ${endif}

    ; Yes jumps to the "set 1" label; No falls through and sets 0.
    MessageBox MB_YESNO|MB_ICONQUESTION "Create a desktop shortcut for GPU Monitor?" IDYES /swDeskYes
      StrCpy $swDesktop "0"
      Goto /swDeskEnd
    /swDeskYes:
      StrCpy $swDesktop "1"
    /swDeskEnd:

    MessageBox MB_YESNO|MB_ICONQUESTION "Add GPU Monitor to the Start Menu?" IDYES /swStartYes
      StrCpy $swStartMenu "0"
      Goto /swStartEnd
    /swStartYes:
      StrCpy $swStartMenu "1"
    /swStartEnd:
  !macroend

  ; ── Apply the choice. Runs AFTER electron-builder created both links (see
  ;    installSection.nsh: addStartMenuLink/addDesktopLink, then customInstall).
  ;    $newDesktopLink / $newStartMenuLink already hold the exact .lnk paths. ──
  !macro customInstall
    ${if} $swDesktop == "0"
      Delete "$newDesktopLink"
    ${endif}
    ${if} $swStartMenu == "0"
      Delete "$newStartMenuLink"
    ${endif}
  !macroend
!endif

!endif
