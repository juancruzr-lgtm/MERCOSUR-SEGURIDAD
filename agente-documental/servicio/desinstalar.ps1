# Quita la tarea del lector documental (conserva los registros).
# PowerShell como administrador:
#   powershell -ExecutionPolicy Bypass -File .\servicio\desinstalar.ps1
& (Join-Path $PSScriptRoot 'detener.ps1')
. (Join-Path $PSScriptRoot 'tarea.ps1')
if (Get-TareaLector) { (Get-ServicioTareas).GetFolder($TareaCarpeta).DeleteTask($TareaNombre, 0) }
Write-Host 'Tarea quitada. Registros conservados en %ProgramData%\MercosurLectorDocumental\logs'
