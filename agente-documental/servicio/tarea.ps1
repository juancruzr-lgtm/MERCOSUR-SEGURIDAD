# Acceso a la tarea programada del lector por la API COM del Programador de
# tareas (Schedule.Service). No usa Get-ScheduledTask: en SRV02 ese cmdlet
# falla ("El sistema no puede encontrar el archivo especificado") porque
# recorre todas las tareas y alguna del sistema esta danada.
# Uso: . (Join-Path $PSScriptRoot 'tarea.ps1')
$TareaCarpeta = '\Mercosur'
$TareaNombre = 'Lector documental'

function Get-ServicioTareas {
  $s = New-Object -ComObject Schedule.Service
  $s.Connect()
  return $s
}

# Devuelve la tarea del lector o $null si no existe.
function Get-TareaLector {
  try { return (Get-ServicioTareas).GetFolder($TareaCarpeta).GetTask($TareaNombre) } catch { return $null }
}

function Get-EstadoTareaTexto([int]$e) {
  switch ($e) { 1 { 'Deshabilitada' } 2 { 'En cola' } 3 { 'Lista' } 4 { 'En ejecucion' } default { 'Desconocido' } }
}

# Vigilancia: un disparador que repite cada 5 minutos, sin fin. Si el
# supervisor esta corriendo, Windows ignora el disparo (IgnoreNew); si murio
# (el "reiniciar si falla" del Programador solo actua cuando la tarea no logra
# arrancar, no cuando el proceso muere despues), lo vuelve a lanzar.
# Idempotente. Conserva la cuenta SYSTEM.
function Add-VigilanciaTarea([string]$Carpeta = $TareaCarpeta, [string]$Nombre = $TareaNombre, $Usuario = 'SYSTEM', [int]$Logon = 5) {
  try { $t = (Get-ServicioTareas).GetFolder($Carpeta).GetTask($Nombre) } catch { throw 'La tarea no esta instalada' }
  $def = $t.Definition
  foreach ($tr in $def.Triggers) { if ($tr.Id -eq 'vigilancia') { return $false } }
  $tr = $def.Triggers.Create(1)
  $tr.Id = 'vigilancia'
  $tr.StartBoundary = (Get-Date).AddMinutes(1).ToString("yyyy-MM-dd'T'HH:mm:ss")
  $tr.Repetition.Interval = 'PT5M'
  $tr.Repetition.Duration = ''
  $tr.Enabled = $true
  (Get-ServicioTareas).GetFolder($Carpeta).RegisterTaskDefinition($Nombre, $def, 4, $Usuario, $null, $Logon) | Out-Null
  return $true
}

function Test-VigilanciaTarea {
  $t = Get-TareaLector
  if (-not $t) { return $false }
  foreach ($tr in $t.Definition.Triggers) { if ($tr.Id -eq 'vigilancia' -and $tr.Enabled) { return $true } }
  return $false
}

# Otras tareas (fuera de la del lector) que ya ejecuten el lector.
function Get-OtrasTareasLector {
  $res = @()
  $pend = New-Object System.Collections.Queue
  $pend.Enqueue((Get-ServicioTareas).GetFolder('\'))
  while ($pend.Count -gt 0) {
    $f = $pend.Dequeue()
    try { foreach ($sub in $f.GetFolders(0)) { $pend.Enqueue($sub) } } catch { }
    try { $tareas = @($f.GetTasks(1)) } catch { $tareas = @() }
    foreach ($t in $tareas) {
      try {
        if ($t.Path -eq ($TareaCarpeta + '\' + $TareaNombre)) { continue }
        foreach ($a in $t.Definition.Actions) {
          if ($a.Arguments -match 'visor-servicio\.ps1|visor[\\/]index\.ts') { $res += $t.Path }
        }
      } catch { }
    }
  }
  return $res
}
