param([int]$Port = 4000)
$conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if (-not $conns) { Write-Output "Nothing listening on port $Port"; exit 0 }
foreach ($c in $conns) {
  Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
  Write-Output "Killed PID $($c.OwningProcess) (was listening on $Port)"
}
