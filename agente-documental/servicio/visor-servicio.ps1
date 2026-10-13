# Supervisor del lector documental (lo ejecuta la tarea programada como SYSTEM).
#
# - Una sola instancia (mutex global).
# - Arranca el lector (node + ts-node src/visor/index.ts) en la carpeta del
#   agente; las credenciales las lee el lector del .env (no pasan por aca).
# - Si el lector termina sin que se lo pida, lo reinicia con espera creciente
#   (10 s ... 5 min) y lo registra.
# - Se detiene de forma ordenada si existe la marca DETENER (ver detener.ps1).
# - Registros en %ProgramData%\MercosurLectorDocumental\logs (30 dias). El
#   lector no escribe rutas ni nombres de archivo: solo ids de pedido.
param(
  [Parameter(Mandatory = $true)][string]$AgenteDir,
  [Parameter(Mandatory = $true)][string]$NodePath
)
$ErrorActionPreference = 'Stop'
$Base = Join-Path $env:ProgramData 'MercosurLectorDocumental'
$Logs = Join-Path $Base 'logs'
$Flag = Join-Path $Base 'DETENER'
New-Item -ItemType Directory -Force $Logs | Out-Null

function Log([string]$m) {
  $archivo = Join-Path $Logs ('servicio-' + (Get-Date -Format 'yyyyMMdd') + '.log')
  Add-Content -Path $archivo -Value ((Get-Date -Format 'yyyy-MM-ddTHH:mm:ssK') + ' ' + $m) -Encoding UTF8
}

# Detenido a pedido: la vigilancia (cada 5 min) lo lanza igual; sale sin registrar.
if (Test-Path $Flag) { exit 0 }

$mutex = New-Object System.Threading.Mutex($false, 'Global\MercosurLectorDocumental')
if (-not $mutex.WaitOne(0)) { Log 'Ya hay una instancia del servicio corriendo: esta termina.'; exit 0 }

try {
  Get-ChildItem $Logs -File | Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-30) } | Remove-Item -Force -ErrorAction SilentlyContinue

  # Lectores que hayan quedado sueltos (por ejemplo, tras un corte): se detienen.
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -match 'visor[\\/]index\.ts' } |
    ForEach-Object { Log ('Lector suelto detenido (pid ' + $_.ProcessId + ')'); Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

  $tsnode = Join-Path $AgenteDir 'node_modules\ts-node\dist\bin.js'
  if (-not (Test-Path $tsnode)) { Log ('ERROR no se encuentra ts-node en ' + $AgenteDir + ' (correr npm install)'); exit 2 }
  if (-not (Test-Path (Join-Path $AgenteDir '.env'))) { Log 'ERROR falta el .env del agente'; exit 2 }

  Log 'Servicio iniciado'
  $fallos = 0
  while ($true) {
    if (Test-Path $Flag) { Log 'Marca DETENER presente: el lector no se inicia (usar iniciar.ps1).'; break }
    $out = Join-Path $Logs 'lector-actual.log'
    $err = Join-Path $Logs 'lector-actual-errores.log'
    $inicio = Get-Date
    $p = Start-Process -FilePath $NodePath -ArgumentList @('"' + $tsnode + '"', 'src/visor/index.ts') `
      -WorkingDirectory $AgenteDir -NoNewWindow -PassThru -RedirectStandardOutput $out -RedirectStandardError $err
    $null = $p.Handle
    Log ('Lector iniciado (pid ' + $p.Id + ')')
    while (-not $p.HasExited) {
      Start-Sleep -Seconds 5
      if (Test-Path $Flag) {
        Log 'Detencion solicitada: se detiene el lector'
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
        break
      }
    }
    $p.WaitForExit()
    $dia = Join-Path $Logs ('lector-' + (Get-Date -Format 'yyyyMMdd') + '.log')
    foreach ($f in @($out, $err)) { if (Test-Path $f) { Get-Content $f | Add-Content -Path $dia -Encoding UTF8 } }
    $segundos = [int]((Get-Date) - $inicio).TotalSeconds
    if (Test-Path $Flag) { Log 'Lector detenido a pedido.'; break }
    Log ('Lector termino sin pedido (codigo ' + $p.ExitCode + ', duro ' + $segundos + ' s)')
    if ($segundos -gt 600) { $fallos = 0 } else { $fallos++ }
    $espera = [int][Math]::Min(300, 10 * [Math]::Pow(2, [Math]::Min($fallos - 1, 5)))
    if ($espera -lt 10) { $espera = 10 }
    Log ('Recuperacion: se reinicia en ' + $espera + ' s (falla consecutiva ' + $fallos + ')')
    for ($i = 0; $i -lt $espera; $i += 5) { if (Test-Path $Flag) { break }; Start-Sleep -Seconds 5 }
  }
}
catch {
  Log ('ERROR del servicio: ' + $_.Exception.Message)
  exit 1
}
finally {
  Log 'Servicio finalizado'
  $mutex.ReleaseMutex() | Out-Null
}
exit 0
