$app = $PSScriptRoot
$desk = [Environment]::GetFolderPath('Desktop')
$sh = New-Object -ComObject WScript.Shell
$lnk = $sh.CreateShortcut((Join-Path $desk '레퍼런스.lnk'))
$lnk.TargetPath = "$env:WINDIR\System32\wscript.exe"
$lnk.Arguments = '"' + (Join-Path $app 'launch.vbs') + '"'
$lnk.WorkingDirectory = $app
$lnk.IconLocation = (Join-Path $app 'icon.ico') + ',0'
$lnk.Description = '레퍼런스 — 비슷한 이야기로 잘 된 영상 찾기'
$lnk.Save()
# 끄기 바로가기는 앱 폴더에만 둔다 (바탕화면은 깔끔하게)
$off = $sh.CreateShortcut((Join-Path $app '레퍼런스 끄기.lnk'))
$off.TargetPath = "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe"
$off.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $app 'stop.ps1') + '"'
$off.IconLocation = (Join-Path $app 'icon.ico') + ',0'
$off.Save()
Write-Output (Test-Path (Join-Path $desk '레퍼런스.lnk'))
