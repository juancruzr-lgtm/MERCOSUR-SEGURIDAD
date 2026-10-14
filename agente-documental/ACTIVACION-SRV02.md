# Lector documental en SRV02 — instalación y operación

Agente en SRV02: `C:\Mercosur\MERCOSUR-SEGURIDAD\agente-documental`.
**No activa scan ni watch, no toca el índice y no aplica la migración
20261009160000.** Este documento no contiene claves: el lector usa el `.env`
que el agente ya tiene (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
`DOCUMENT_ROOT_PATH`, `VISOR_AGENTE_ID`).

Qué carpetas lee el lector lo decide la base (`documental_areas`, ver
[INFRAESTRUCTURA-DOCUMENTAL.md](INFRAESTRUCTURA-DOCUMENTAL.md)). `VISOR_RAICES`
es sólo para pruebas aisladas y **no** debe quedar en el `.env`.

## 1. Actualizar el código del visor (sin tocar el resto del agente)

En la carpeta del agente, PowerShell normal:

```powershell
git -C .. fetch origin main
git -C .. archive --format=tar -o "$env:TEMP\visor.tar" origin/main agente-documental/src/visor agente-documental/servicio
tar -xf "$env:TEMP\visor.tar" --strip-components=1; Remove-Item "$env:TEMP\visor.tar"
```

## 2. Verificar (sólo lectura)

```powershell
npx ts-node src/visor/verificar.ts
```

Tiene que terminar en **LISTO PARA EL PILOTO**: variables, clave de servicio,
bucket privado, áreas habilitadas y los 2 PDF del piloto con el hash del índice.

## 3. Instalar como tarea permanente (una vez, PowerShell COMO ADMINISTRADOR)

```powershell
cd C:\Mercosur\MERCOSUR-SEGURIDAD\agente-documental
powershell -ExecutionPolicy Bypass -File .\servicio\instalar.ps1
```

- Tarea `\Mercosur\Lector documental`, cuenta SYSTEM, arranca 1 minuto después
  de iniciar el servidor, sin sesión iniciada.
- Una sola instancia. Si el lector se cae, el supervisor lo reinicia (10 s, 20 s,
  40 s… hasta 5 min); si muere el supervisor, la vigilancia de la tarea lo
  vuelve a lanzar en 5 minutos como máximo (el «reiniciar si falla» de Windows
  sólo actúa si la tarea no logra arrancar).
- La tarea se maneja por la API COM del Programador de tareas: en SRV02
  `Get-ScheduledTask` falla («El sistema no puede encontrar el archivo
  especificado»). Para ver la tarea sin los scripts: `schtasks /query /tn "\Mercosur\Lector documental"`.
- No guarda credenciales ni las pasa como argumento. Prioridad baja: no compite
  con MEGAsync.
- Si ya hay una tarea o servicio equivalente, no instala otro.

## 4. Operación (PowerShell como administrador, en la carpeta del agente)

| Acción | Comando |
|---|---|
| Ver estado | `powershell -ExecutionPolicy Bypass -File .\servicio\estado.ps1` |
| Detener (queda detenido, también tras reiniciar el servidor) | `powershell -ExecutionPolicy Bypass -File .\servicio\detener.ps1` |
| Iniciar / reiniciar | `powershell -ExecutionPolicy Bypass -File .\servicio\iniciar.ps1` |
| Quitar la tarea | `powershell -ExecutionPolicy Bypass -File .\servicio\desinstalar.ps1` |
| Agregar la vigilancia a una tarea instalada antes del 13/10 (sin detener nada) | `powershell -ExecutionPolicy Bypass -File .\servicio\actualizar-tarea.ps1` |

Registros: `C:\ProgramData\MercosurLectorDocumental\logs` (30 días):
`servicio-AAAAMMDD.log` (inicio, detención, fallas y recuperación),
`lector-actual.log` (el lector en curso) y `lector-AAAAMMDD.log`. Sin rutas,
nombres ni secretos: sólo ids de pedido.

Desde la base (editor SQL de Supabase):

```sql
-- ¿Está andando? (latido cada minuto)
select agente_id, estado, ultimo_latido, info from documental_lectores;

-- Pedidos y aperturas recientes
select left(id::text,8) id, estado, area_codigo, agente_id, hash_esperado = hash_leido hash_ok,
       creado_at, lista_at, eliminada_at, error
from legajo_historico_vistas order by creado_at desc limit 20;
select a.at, a.vista_id, u.apellido, u.nombre from legajo_historico_vista_aperturas a
  left join usuarios u on u.id = a.usuario_id order by a.at desc limit 20;

-- No debe quedar ninguna copia viva vencida
select count(*) from legajo_historico_vistas
 where objeto is not null and eliminada_at is null and expira_at < now();
```

Ante un problema: `detener.ps1`. Los pedidos en cola vencen solos a los 5
minutos y las copias temporales se borran solas (también desde la app).

## 5. Piloto (ya realizado el 13/10/2026; repetir sólo si cambia el lector)

```powershell
npx ts-node src/visor/piloto.ts 7cc0f6e4-8e0a-40d3-9346-87f95df16506 ec57ca0e-aad6-48f2-88d2-13a73f7847ec
```

## Copia de fotos de credenciales (desde 2026-10-18)

El lector también copia al disco de SRV02 las fotos de credenciales **aprobadas** en el Legajo Digital
(cola `documental_exportaciones`, migración 20261018120000):

- Destino: `<DOCUMENT_ROOT_PATH>\EMPLEADOS\CREDENCIALES\APELLIDO NOMBRE - AAAA-MM-DD - Frente.jpg` (y `Dorso`).
- Sólo escribe en `EMPLEADOS\CREDENCIALES` (crea la carpeta si falta). Nunca pisa ni borra archivos.
- Corre una vez por minuto dentro del mismo proceso del lector. Se apaga con `EXPORTAR_CREDENCIALES=0` en el `.env`.
- Para activarlo hay que actualizar el código en SRV02 y reiniciar la tarea (lo hace JC, con permisos de administrador):
  `git pull` en `C:\Mercosur\MERCOSUR-SEGURIDAD`, después `servicio\detener.ps1` y `servicio\iniciar.ps1`.
