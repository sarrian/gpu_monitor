$file = "C:\Users\Andi\Documents\Obsidian Vault\Projects\GPU Monitor\src\renderer.js"
$content = Get-Content $file -Raw

$old = 'document.getElementById(''btn-devtools'').addEventListener(''click'', () => { try { window.electron.openDevTools(); } catch(e) { console.error(''[GPU Monitor] DevTools error:'', e); } });'

$new = 'document.getElementById(''btn-devtools'').addEventListener(''click'', function() {
    try { window.electron.openDevTools(); } catch(e) { console.error(''[GPU Monitor] DevTools error:'', e); }
    var $dbg = document.getElementById(''debug-overlay'');
    if ($dbg) $dbg.style.display = ($dbg.style.display === ''block'') ? ''none'' : ''block'';
  });'

if ($content -match [regex]::Escape($old)) {
    $content = $content -replace [regex]::Escape($old), $new
    Set-Content $file -Value $content -Encoding UTF8 -NoNewline
    Write-Output "Patched btn-devtools handler"
} else {
    Write-Output "Pattern not found — already patched?"
}
