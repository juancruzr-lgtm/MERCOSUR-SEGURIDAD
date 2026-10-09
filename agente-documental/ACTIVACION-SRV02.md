# Activación del lector en SRV02 — piloto

Procedimiento de unos 20 minutos. Se hace con acceso a SRV02 y no requiere
programar. **No activa scan ni watch, no toca el índice y no aplica la migración
20261009160000.** Este documento no contiene claves.

> Antes de empezar: en la app, `main` tiene que estar en a89cd89 o posterior, y
> las migraciones 20261011130000 (visor) y 20261011120000 (ARCA) aplicadas. Ya lo están.

## 1. Localizar el agente en SRV02

En PowerShell:

```powershell
Get-ChildItem C:\,D:\ -Filter package.json -Recurse -ErrorAction SilentlyContinue |
  Where-Object { Select-String -Path $_.FullName -Pattern '"agente-mercosur"' -Quiet } |
  Select-Object DirectoryName
```

La carpeta encontrada es la del agente. En ella el `.env` tiene `DOCUMENT_AGENT_ID=srv02-mega`.

Actualizar el código del agente con la versión de `main`:
- **Si la carpeta es un clon de Git:** ejecutar `git pull`.
- **Si no lo es:** copiar `agente-documental/src/visor/`, `package.json` y `VISOR.md` desde el repositorio.

Después, en esa carpeta:

```powershell
npm install
```

## 2. Comprobar el entorno existente

El `.env` del agente ya tiene `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`, porque el
agente indexó con clave de servicio. No hace falta pedir claves nuevas.

## 3. Configurar `VISOR_RAICES`

Agregar al `.env`. **Sólo agregar: no cambiar las variables del agente.**

```
VISOR_AGENTE_ID=srv02-visor
VISOR_RAICES=EMPLEADOS/=<DOCUMENT_ROOT_PATH>\EMPLEADOS
```

- `<DOCUMENT_ROOT_PATH>` es el valor que ya figura en ese mismo `.env`. Las rutas del índice son relativas a esa carpeta.
- Para el piloto alcanza con `EMPLEADOS/`, porque ahí están los 2 PDF.
- Para habilitar más áreas después, agregarlas separadas por `;`. Por ejemplo: `;ADMINISTRACION/=<DOCUMENT_ROOT_PATH>\ADMINISTRACION`.
- Lo que no esté configurado no se puede leer.

## 4. Verificar que las rutas corresponden al índice

Este paso sólo lee: no escribe nada.

```powershell
npm run visor:verificar
```

Tiene que terminar en **LISTO PARA EL PILOTO**:
- variables presentes;
- la clave es de servicio;
- el bucket es privado;
- la carpeta existe;
- los 2 PDF tienen el hash igual al índice.

Si dice «HASH DISTINTO» o «no está en la carpeta configurada», revisar
`VISOR_RAICES` (paso 3) antes de seguir.

## 5. Ejecutar el piloto

```powershell
npm run visor:piloto -- 7cc0f6e4-8e0a-40d3-9346-87f95df16506 ec57ca0e-aad6-48f2-88d2-13a73f7847ec
```

Tarda unos 3 minutos: espera 65 s por archivo para probar el vencimiento del enlace.

## 6 a 8. Qué tiene que mostrar

| Línea | Qué comprueba |
|---|---|
| `2. el lector lo dejó listo con el hash verificado` | Se recuperó el PDF (paso 6). |
| `3. sin firma no se descarga` | El bucket es privado. |
| `4. con enlace de 60 s se descarga y el hash coincide` | El enlace firmado funciona. |
| `5. el mismo enlace a los 65 s ya no sirve` | **El enlace vence** (paso 7). |
| `6. la copia sigue hasta su retención` | Vencer el enlace no borra la copia. |
| `7. vencida la retención, la limpieza la borra` | **Se eliminan los archivos temporales** (paso 8). |
| `8. el original no cambió` | MEGA queda intacto. |

Tiene que terminar en **PILOTO OK**, una vez por cada archivo.

## 9. Consultar la auditoría

En el editor SQL de Supabase:

```sql
-- Pedidos del piloto y su recorrido
select id, estado, motivo, agente_id, hash_esperado = hash_leido as hash_ok,
       creado_at, tomada_at, lista_at, expira_at, eliminada_at, error
from legajo_historico_vistas order by creado_at desc limit 20;

-- Aperturas desde la app (vacío en el piloto, que firma desde SRV02)
select a.at, a.vista_id, u.apellido, u.nombre, a.ip
from legajo_historico_vista_aperturas a left join usuarios u on u.id = a.usuario_id
order by a.at desc limit 20;

-- Pedidos y aperturas hechos desde la bandeja (historial de cada referencia)
select propuesta_id, evento, at, usuario_id
from legajo_historico_eventos where evento like 'vista_%' order by at desc limit 20;

-- No debe quedar ninguna copia viva vencida
select count(*) from legajo_historico_vistas
where objeto is not null and eliminada_at is null and expira_at < now();
```

## 10. Detener el lector ante un error

- Ctrl+C en la consola donde corre `npm run visor`. No hay servicio instalado
  ni tarea programada: si se cierra la consola, se detiene.
- Si quedaron pedidos colgados (la app avisa sola al minuto), se pueden cerrar así:

  ```sql
  update legajo_historico_vistas set estado = 'error', error = 'Lector detenido'
  where estado in ('pendiente','tomada');
  ```

- Las copias temporales vencen solas: la app también las borra en cada apertura.

## Después del piloto

1. Dejar andando `npm run visor` en una consola de SRV02. Más adelante se puede instalar como tarea, con autorización.
2. Probar desde la app con una sesión de Administración: Legajo Digital →
   Archivo histórico → una referencia → «Ver documento».
3. Ampliar `VISOR_RAICES` sólo a las áreas autorizadas.
