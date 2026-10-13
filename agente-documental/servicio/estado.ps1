# Estado del lector documental (no cambia nada).
#   powershell -ExecutionPolicy Bypass -File .\servicio\estado.ps1
$Base = Join-Path $env:ProgramData 'MercosurLectorDocumental'
$Logs = Join-Path $Base 'logs'
$t = Get-ScheduledTask -TaskPath '\Mercosur\' -TaskName 'Lector documental' -ErrorAction SilentlyContinue
if (-not $t) { Write-Host 'Tarea: NO instalada'; exit 1 }
$i = $t | Get-ScheduledTaskInfo
Write-Host ('Tarea: ' + $t.State + ' | ultima ejecucion: ' + $i.LastRunTime + ' | resultado: ' + $i.LastTaskResult)
Write-Host ('Marca DETENER: ' + (Test-Path (Join-Path $Base 'DETENER')))
$sup = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object { $_.CommandLine -match 'visor-servicio\.ps1' }
$lec = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'visor[\\/]index\.ts' }
Write-Host ('Supervisor: ' + (@($sup).Count) + ' proceso(s) ' + (($sup | ForEach-Object { 'pid ' + $_.ProcessId }) -join ', '))
Write-Host ('Lector:     ' + (@($lec).Count) + ' proceso(s) ' + (($lec | ForEach-Object { 'pid ' + $_.ProcessId + ' desde ' + $_.CreationDate }) -join ', '))
$hoy = Join-Path $Logs ('servicio-' + (Get-Date -Format 'yyyyMMdd') + '.log')
if (Test-Path $hoy) { Write-Host '--- servicio (ultimas lineas) ---'; Get-Content $hoy -Tail 8 }
$act = Join-Path $Logs 'lector-actual.log'
if (Test-Path $act) { Write-Host '--- lector (ultimas lineas) ---'; Get-Content $act -Tail 8 }
