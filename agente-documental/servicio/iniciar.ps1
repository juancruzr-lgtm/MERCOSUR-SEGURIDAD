# Inicia (o reinicia) el lector documental. PowerShell como administrador:
#   powershell -ExecutionPolicy Bypass -File .\servicio\iniciar.ps1
$Base = Join-Path $env:ProgramData 'MercosurLectorDocumental'
Remove-Item (Join-Path $Base 'DETENER') -Force -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskPath '\Mercosur\' -TaskName 'Lector documental'
Start-Sleep -Seconds 8
& (Join-Path $PSScriptRoot 'estado.ps1')
