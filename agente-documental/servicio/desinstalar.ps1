# Quita la tarea del lector documental (conserva los registros).
# PowerShell como administrador:
#   powershell -ExecutionPolicy Bypass -File .\servicio\desinstalar.ps1
& (Join-Path $PSScriptRoot 'detener.ps1')
Unregister-ScheduledTask -TaskPath '\Mercosur\' -TaskName 'Lector documental' -Confirm:$false -ErrorAction SilentlyContinue
Write-Host 'Tarea quitada. Registros conservados en %ProgramData%\MercosurLectorDocumental\logs'
