# Instala el lector documental como tarea programada de Windows.
# Ejecutar UNA vez, en PowerShell COMO ADMINISTRADOR, desde la carpeta del agente:
#
#   powershell -ExecutionPolicy Bypass -File .\servicio\instalar.ps1
#
# - Tarea \Mercosur\Lector documental, cuenta SYSTEM (sin contrasenas
#   guardadas), arranca con el servidor sin sesion iniciada.
# - Una sola instancia; Windows la reinicia si el supervisor falla.
# - No guarda credenciales: el lector usa el .env que ya tiene el agente.
# - No toca MEGAsync, el indice ni el agente de indexacion (no hay scan/watch).
$ErrorActionPreference = 'Stop'
$Tarea = 'Lector documental'
$Carpeta = '\Mercosur\'

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Abrir PowerShell como administrador y volver a ejecutar.' }

$AgenteDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Script = Join-Path $PSScriptRoot 'visor-servicio.ps1'
$NodePath = (Get-Command node -ErrorAction Stop).Source
if (-not (Test-Path (Join-Path $AgenteDir 'src\visor\index.ts'))) { throw 'No se encuentra src\visor\index.ts en ' + $AgenteDir }
if (-not (Test-Path (Join-Path $AgenteDir 'node_modules\ts-node'))) { throw 'Falta node_modules (ejecutar npm install en ' + $AgenteDir + ')' }
$envPath = Join-Path $AgenteDir '.env'
if (-not (Test-Path $envPath)) { throw 'Falta el .env del agente' }
if (Select-String -Path $envPath -Pattern '^\s*VISOR_RAICES\s*=' -Quiet) {
  Write-Warning 'El .env tiene VISOR_RAICES: el lector correria en MODO PRUEBA. Quitar esa linea para usar las areas de la base.'
}

# No duplicar: si ya existe una tarea o un servicio equivalente, no se instala otro.
# (API COM: Get-ScheduledTask falla en SRV02, ver tarea.ps1)
. (Join-Path $PSScriptRoot 'tarea.ps1')
if (Get-TareaLector) { throw ('Ya existe la tarea ' + $Carpeta + $Tarea + ': usar estado.ps1 / iniciar.ps1, o desinstalar.ps1 antes de reinstalar.') }
$otros = @(Get-OtrasTareasLector)
if ($otros.Count -gt 0) { throw ('Hay otra tarea que ya ejecuta el lector: ' + ($otros -join ', ')) }

# Carpeta de registros: solo SYSTEM y Administradores escriben (la marca DETENER vive aca).
$Base = Join-Path $env:ProgramData 'MercosurLectorDocumental'
New-Item -ItemType Directory -Force (Join-Path $Base 'logs') | Out-Null
& icacls $Base /inheritance:r /grant:r '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F' '*S-1-5-32-545:(OI)(CI)RX' | Out-Null

$accion = New-ScheduledTaskAction -Execute 'powershell.exe' -WorkingDirectory $AgenteDir `
  -Argument ('-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' + $Script + '" -AgenteDir "' + $AgenteDir + '" -NodePath "' + $NodePath + '"')
$disparador = New-ScheduledTaskTrigger -AtStartup
$disparador.Delay = 'PT1M'
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$config = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -Priority 7
Register-ScheduledTask -TaskPath $Carpeta -TaskName $Tarea -Action $accion -Trigger $disparador -Principal $principal -Settings $config `
  -Description 'Lector documental de MEGA para la app de Mercosur (lectura a pedido, sin scan ni watch).' | Out-Null

Add-VigilanciaTarea | Out-Null

Remove-Item (Join-Path $Base 'DETENER') -Force -ErrorAction SilentlyContinue
Start-ScheduledTask -TaskPath $Carpeta -TaskName $Tarea
Write-Host 'Instalado e iniciado. Ver estado con: powershell -ExecutionPolicy Bypass -File .\servicio\estado.ps1'
