# Inicia (o reinicia) el lector documental. PowerShell como administrador:
#   powershell -ExecutionPolicy Bypass -File .\servicio\iniciar.ps1
$Base = Join-Path $env:ProgramData 'MercosurLectorDocumental'
Remove-Item (Join-Path $Base 'DETENER') -Force -ErrorAction SilentlyContinue
. (Join-Path $PSScriptRoot 'tarea.ps1')
$t = Get-TareaLector
if (-not $t) { throw 'La tarea no esta instalada: ejecutar instalar.ps1' }
if ($t.State -ne 4) { $t.Run($null) | Out-Null }
Start-Sleep -Seconds 8
& (Join-Path $PSScriptRoot 'estado.ps1')
