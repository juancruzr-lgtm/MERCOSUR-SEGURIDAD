# Detiene el lector documental de forma ordenada y lo deja DETENIDO (tampoco
# arranca al reiniciar el servidor) hasta ejecutar iniciar.ps1.
# PowerShell como administrador:
#   powershell -ExecutionPolicy Bypass -File .\servicio\detener.ps1
$Base = Join-Path $env:ProgramData 'MercosurLectorDocumental'
New-Item -ItemType File -Force (Join-Path $Base 'DETENER') | Out-Null
for ($i = 0; $i -lt 12; $i++) {
  $lec = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'visor[\\/]index\.ts' }
  $sup = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'visor-servicio\.ps1' }
  if (-not $lec -and -not $sup) { break }
  Start-Sleep -Seconds 5
}
. (Join-Path $PSScriptRoot 'tarea.ps1')
$t = Get-TareaLector
if ($t -and $t.State -eq 4) { try { $t.Stop(0) } catch { } }
$lec = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'visor[\\/]index\.ts' }
foreach ($p in @($lec)) { if ($p) { Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue } }
Write-Host 'Lector detenido. Para volver a iniciarlo: .\servicio\iniciar.ps1'
