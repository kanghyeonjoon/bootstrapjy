# 레퍼런스 바탕화면 실행기
# 1) 이미 켜져 있으면 바로 연다  2) 아니면 로딩 화면을 띄우고, 서버를 뒤에서 켠다
# 3) 코드가 바뀌었으면 실행용 빌드를 다시 만든다  4) 하루 갱신이 20시간 넘게 안 돌았으면 돌린다
$ErrorActionPreference = 'SilentlyContinue'
$app  = $PSScriptRoot
$root = Split-Path -Parent $app
$base = 'http://localhost:3100'
$dist = '.next-app'
$log  = Join-Path $root 'data\app.log'
New-Item -ItemType Directory -Force (Join-Path $root 'data') | Out-Null

# 앱 창으로 열 브라우저 (크롬 → 엣지)
$browser = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

function Open-App([string]$target) {
  if ($browser) { Start-Process $browser -ArgumentList "--app=$target", '--window-size=1440,920' }
  else { Start-Process $target }
}

function Test-Up {
  try { (Invoke-WebRequest "$base/icon.png" -UseBasicParsing -TimeoutSec 2).StatusCode -eq 200 } catch { $false }
}

function Start-DailyIfDue {
  $stamp = Join-Path $root 'data\last-daily.txt'
  $last = if (Test-Path $stamp) { [datetime](Get-Content $stamp) } else { [datetime]::MinValue }
  if (((Get-Date) - $last).TotalHours -lt 20) { return }
  (Get-Date).ToString('o') | Set-Content $stamp
  # 하루 갱신은 5분 걸릴 수 있다 — 숨은 창에서 따로
  Start-Process powershell -WindowStyle Hidden -ArgumentList '-NoProfile', '-Command',
    "Start-Sleep 20; Invoke-WebRequest '$base/api/cron/daily' -UseBasicParsing -TimeoutSec 330 | Out-Null"
}

if (Test-Up) { Open-App "$base/dashboard"; Start-DailyIfDue; exit }

# 로딩 화면 먼저 — 사용자가 기다리는 동안 볼 것
Open-App ('file:///' + ((Join-Path $app 'splash.html') -replace '\', '/'))

Set-Location $root
$env:NEXT_DIST = $dist
$env:NODE_ENV = 'production'
$next = Join-Path $root 'node_modules\next\dist\bin\next'

if (-not (Test-Path (Join-Path $root 'node_modules'))) {
  Start-Process cmd -ArgumentList '/c', 'npm install' -WorkingDirectory $root -WindowStyle Hidden -Wait
}

# 코드가 바뀌었으면 실행용 빌드를 다시 만든다 (가장 최근에 고친 파일 시각으로 판단)
$latest = (Get-ChildItem (Join-Path $root 'src'), (Join-Path $root 'package.json'), (Join-Path $root 'next.config.mjs') -Recurse -File |
  Measure-Object LastWriteTimeUtc -Maximum).Maximum.Ticks
$stampFile = Join-Path $root "$dist\APP_STAMP"
$built = if (Test-Path $stampFile) { Get-Content $stampFile } else { '' }
if ("$latest" -ne "$built" -or -not (Test-Path (Join-Path $root "$dist\BUILD_ID"))) {
  Start-Process node -ArgumentList "`"$next`"", 'build' -WorkingDirectory $root -WindowStyle Hidden -Wait `
    -RedirectStandardOutput $log -RedirectStandardError "$log.err"
  "$latest" | Set-Content $stampFile
}

Start-Process node -ArgumentList "`"$next`"", 'start', '-p', '3100' -WorkingDirectory $root -WindowStyle Hidden `
  -RedirectStandardOutput $log -RedirectStandardError "$log.err"

# 서버가 뜨면 하루 갱신이 필요한지 본다 (로딩 화면은 스스로 대시보드로 넘어간다)
for ($i = 0; $i -lt 120; $i++) { if (Test-Up) { break }; Start-Sleep 1 }
Start-DailyIfDue
