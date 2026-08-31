$dbg = Get-Content "$PSScriptRoot\..\src\debug-overlay.js" -Raw
$rest = Get-Content "$PSScriptRoot\..\src\renderer.js" -Raw
$new = $dbg + "`n`n" + $rest
Set-Content "$PSScriptRoot\..\src\renderer.js" -Value $new -Encoding UTF8
Write-Output "Injected debug-overlay into renderer.js"
