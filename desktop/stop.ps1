# 레퍼런스 끄기 — 3100 포트를 쓰는 서버를 멈춘다
$conn = Get-NetTCPConnection -LocalPort 3100 -State Listen -ErrorAction SilentlyContinue
foreach ($c in $conn) { Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue }
