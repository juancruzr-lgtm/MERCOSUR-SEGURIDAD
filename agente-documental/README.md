# Agente MERCOSUR — Repositorio Documental v1

Componente independiente del Sistema Operativo Mercosur Seguridad.

Observa una carpeta local, detecta documentos nuevos, modificados y eliminados, y registra sus metadatos en Supabase.

No lee el contenido de los archivos. No usa inteligencia artificial. No genera turnos. No modifica la aplicación Next.js ni ninguna tabla existente.

---

## Qué hace

- Escanea recursivamente una carpeta configurable
- Detecta archivos nuevos, modificados, sin cambios y eliminados
- Calcula SHA-256 de cada archivo para detectar modificaciones reales de contenido
- Registra metadatos en la tabla `repositorio_documental`
- Nunca duplica registros: reiniciar el agente es seguro
- Puede ejecutarse en cualquier equipo Windows cambiando solo el `.env`

## Qué NO hace todavía

- No lee el contenido de los documentos
- No usa IA ni OCR
- No clasifica ni etiqueta documentos
- No genera turnos ni servicios
- No se instala como servicio permanente de Windows

---

## Instalación

```
cd agente-documental
npm install
```

---

## Configuración

```
copy .env.example .env
```

Completar `.env` con los valores reales:

| Variable | Descripción |
|---|---|
| `SUPABASE_URL` | URL del proyecto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Clave service_role (nunca la anon key) |
| `DOCUMENT_AGENT_ID` | Identificador único de esta máquina (ej: `notebook-juan`) |
| `DOCUMENT_SOURCE` | Origen lógico. En v1 siempre `local` |
| `DOCUMENT_EMPRESA` | Empresa propietaria. Default: `mercosur-seguridad` |
| `DOCUMENT_ROOT_PATH` | Ruta absoluta de la carpeta a observar |
| `DOCUMENT_MAX_SIZE_MB` | Tamaño máximo por archivo (default: 50) |
| `DOCUMENT_IGNORE` | Carpetas a ignorar, separadas por coma |
| `AGENT_LOG_LEVEL` | `debug` / `info` / `warn` / `error` (default: `info`) |

Ejemplo de `DOCUMENT_ROOT_PATH`:
- Notebook: `C:\Users\juan\Documentos\MercosurDocs`
- Servidor: `D:\Documentos`

---

## Migración de base de datos

Antes de usar el agente, ejecutar el SQL en Supabase SQL Editor:

```
supabase/migrations/20260720_repositorio_documental.sql
```

Solo se necesita hacer esto una vez.

---

## Verificar conexión

```
npm run test-connection
```

Verifica que Supabase responde, que la tabla existe y que la carpeta es accesible.

---

## Escaneo único

```
npm run scan
```

Recorre toda la carpeta, sincroniza los metadatos y termina.

Seguro de ejecutar múltiples veces: actualiza sin duplicar.

---

## Observación continua

```
npm run watch
```

Realiza un escaneo inicial y luego monitorea cambios en tiempo real.

Para detener: `Ctrl + C`

---

## Revisar resultados

En Supabase → Table Editor → `repositorio_documental`.

Columnas relevantes:
- `disponible`: false si el archivo fue eliminado
- `hash_sha256`: cambia cuando el contenido se modifica
- `version_actual`: sube con cada modificación de contenido
- `estado_indexacion`: `indexado` / `error`

---

## Extensiones soportadas en v1

PDF, DOC, DOCX, XLS, XLSX, CSV, TXT, JPG, JPEG, PNG

Los demás formatos se ignoran silenciosamente.

---

## Archivos ignorados siempre

- Archivos ocultos (comienzan con `.`)
- Archivos temporales (`~$`, `.tmp`, `.temp`)
- `Thumbs.db`, `Desktop.ini`
- Directorios: `node_modules`, `.git`, `.next`, `dist`
- Carpetas configuradas en `DOCUMENT_IGNORE`

---

## Migrar al servidor Windows

1. Copiar el directorio `agente-documental/` al servidor
2. Ejecutar `npm install`
3. Crear `.env` con los valores del servidor:
   - `DOCUMENT_AGENT_ID=servidor-mpls` (diferente al de la notebook)
   - `DOCUMENT_ROOT_PATH=D:\Documentos`
4. Ejecutar `npm run test-connection`
5. Ejecutar `npm run scan` o `npm run watch`

No se modifica ningún archivo de código. Solo el `.env`.

---

## Instalación como servicio Windows (futuro)

Con NSSM o WinSW:

```
nssm install AgenteMercosur "node" "C:\ruta\agente-documental\node_modules\.bin\ts-node src/index.ts --mode watch"
```
