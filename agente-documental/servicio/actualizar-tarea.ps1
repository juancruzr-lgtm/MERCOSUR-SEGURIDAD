# Agrega la vigilancia (cada 5 min) a una tarea ya instalada, sin reinstalar ni
# detener el lector. Idempotente. PowerShell como administrador:
#   powershell -ExecutionPolicy Bypass -File .\servicio\actualizar-tarea.ps1
$ErrorActionPreference = 'Stop'
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Abrir PowerShell como administrador y volver a ejecutar.' }
. (Join-Path $PSScriptRoot 'tarea.ps1')
if (Add-VigilanciaTarea) { Write-Host 'Vigilancia agregada.' } else { Write-Host 'La vigilancia ya estaba.' }
& (Join-Path $PSScriptRoot 'estado.ps1')
