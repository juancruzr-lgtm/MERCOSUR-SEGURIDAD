# Contrato del archivo de importación de Visual Sueldos

Auditoría directa de un archivo REAL aceptado por Visual Sueldos:
`PlanillaImportacioagosto.xls` (referencia entregada por JC el 08/09/2026).
Este documento es la especificación de salida de **LIQ2D** (generador del `.xls`
para Visual). No reemplaza la prueba definitiva: **la única aceptación válida es
que Visual Sueldos lo importe correctamente**.

> Ojo: NO confundir este archivo con el *Excel de trabajo de liquidación* (el
> XLSX prolijo que genera MERCOSUR para que Juan edite). Son dos archivos
> distintos. Este es sólo el de importación a Visual.

## Formato binario

| Propiedad | Valor observado |
|---|---|
| Firma (magic) | `D0 CF 11 E0 A1 B1 1A E1` → OLE2 / Compound File Binary |
| Tipo | Excel 97-2003 (**BIFF8**, `.xls`) — **no** es un `.xlsx` renombrado |
| `date1904` | `false` (base de fechas 1900) |
| Tamaño de referencia | 190.464 bytes |

Implicancia: el generador **debe** emitir BIFF8 real. Renombrar un `.xlsx` a
`.xls` **no sirve**. Verificado que SheetJS (`xlsx@0.18.5`, ya en el repo) escribe
BIFF8 con `writeFile(wb, ruta, { bookType: 'biff8' })` y el round-trip conserva
firma OLE2, hojas, título, textos y números. Si Visual rechazara el archivo de
SheetJS, el fallback es escritura quirúrgica sobre una plantilla `.xls` nativa
aceptada, preservando su estructura binaria y escribiendo sólo las filas de datos.

## Hojas

- Tres hojas: **`Hoja1`** (datos), `Hoja2` y `Hoja3` (vacías).
- Los datos van en `Hoja1`. Se conservan las tres hojas por prolijidad/compatibilidad.

## Estructura de `Hoja1`

- **Fila 1** — título en `A1`:
  `VisualSueldos - Planilla de importación de datos` (texto).
- **Fila 2** — encabezados (formato de celda texto `@`):

  | Col | Encabezado |
  |-----|------------|
  | A | `Legajo` |
  | B | `CUIL` |
  | C | `Código de concepto` |
  | D | `Cantidad` |
  | E | `Importe` |

- **Fila 3 en adelante** — una fila por **(empleado × concepto)**. Es formato
  **largo/tidy**, NO ancho: si un empleado tiene 5 conceptos, ocupa 5 filas.

### Tipos y formatos por columna (constantes en las 329 filas de datos)

| Col | Contenido | Tipo de celda | Formato núm. | Notas |
|-----|-----------|---------------|--------------|-------|
| A | `Legajo` | **texto** (`s`) | General | En el archivo real contiene el **apellido/nombre** (ej. `ALMADA`), no un número. Es etiqueta humana. |
| B | `CUIL` | **texto** (`s`) | General | 11 dígitos. **Clave de identidad real.** |
| C | `Código de concepto` | **texto** (`s`) | `@` | Con **ceros a la izquierda preservados** (`001`, `006`, `004`, `008`). Nunca numérico. |
| D | `Cantidad` | **número** (`n`) | `0.00` | |
| E | `Importe` | **número** (`n`) | `0.00` | |

- Columnas **F–K**: sin valores (sólo formato residual). El generador puede
  escribir sólo A:E.
- El rango usado del archivo real venía inflado (`A1:K4411`) pero con datos sólo
  hasta la fila 331. Inflar el rango es inocuo (Visual lo aceptó); el generador
  escribirá el rango real `A1:E<n>`.

## Universo de códigos observado en el archivo real

329 filas de datos, ~65 empleados. 8 códigos distintos:

| Código | Filas | Lectura (referencial, NO hardcodear semántica) |
|--------|-------|-----------------------------------------------|
| `203` | 65 | concepto base presente en todos |
| `204` | 65 | " |
| `212` | 65 | " |
| `001` | 65 | " |
| `006` | 65 | " |
| `205` | 2 | concepto particular |
| `004` | 1 | concepto particular |
| `008` | 1 | concepto particular |

Cada empleado lleva el set base `{203, 204, 212, 001, 006}` y algunos suman
particulares `{205, 004, 008}`. La semántica de cada código **es configurable por
concepto**, no se fija en código (regla ya acordada: la semántica de los códigos
de Visual varía entre períodos).

## Reglas de generación (LIQ2D)

1. Emitir BIFF8 real (`bookType: 'biff8'`), hoja `Hoja1` + `Hoja2`/`Hoja3` vacías.
2. `A1` = título literal; fila 2 = encabezados exactos; datos desde fila 3.
3. `CUIL` y `Código` **siempre como texto** (preservar ceros a la izquierda del
   código); `Cantidad`/`Importe` como número con formato `0.00`.
4. Una fila por (empleado, concepto) que corresponda **enviar a Visual**.
5. Por cada concepto del catálogo, la configuración decide: **se exporta sí/no**,
   **código Visual**, y si manda **Cantidad**, **Importe** o **ambos**. Los
   conceptos que Visual calcula internamente y su importador no requiere **no se
   exportan**. Todo configurable, nunca hardcodeado.
6. Identidad de la fila = **CUIL** (col B). La col A es etiqueta (apellido/nombre).
7. Cerrar LIQ2D sólo con: archivo generado + **diff binario/estructural** contra
   `PlanillaImportacioagosto.xls` + **prueba manual de importación en Visual** (la
   hace JC).
