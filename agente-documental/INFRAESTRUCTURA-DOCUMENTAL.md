# Infraestructura documental única (SRV02 + MEGA)

Una sola infraestructura para toda la empresa: el **índice** del agente, el
**lector a pedido** de SRV02 y la **configuración de áreas** en la base.
Cualquier módulo (legajos de empleados hoy; objetivos, clientes, contratos y
Gerencia más adelante) la reutiliza sin otro servidor ni otro lector.

```
MEGA (SRV02) ──agente (índice: ruta + hash, sin contenido)──► repositorio_documental
     ▲                                                              │
     │ lee SOLO el archivo pedido, si su área está habilitada        │ referencias por entidad
     │                                                              ▼
lector (tarea \Mercosur\Lector documental) ◄── cola ── legajo_historico_vistas ◄── app (permiso por área + módulo)
     │ copia temporal (10 min) ──► bucket privado ──► enlace firmado 60 s ──► visor de la app (apertura auditada)
```

## 1. Áreas documentales (`documental_areas`)

Una fila por carpeta del índice (prefijo). Es la **única** configuración: el
lector la lee cada minuto; habilitar o cerrar un área no requiere tocar código
ni el servidor.

| Campo | Qué define |
|---|---|
| `codigo` | Identificador del área |
| `prefijo` | Carpeta raíz autorizada (como figura en el índice; el más largo manda: `EMPLEADOS/SUELDOS/` es otra área que `EMPLEADOS/`) |
| `habilitada` | Si se puede leer desde la app |
| `nivel_acceso` | `administracion` (Administración y Gerencia) o `gerencia` (sólo Gerencia o delegación de Gerencia) |
| `modulos` | Qué módulos de la app pueden pedir archivos de esta área (`legajo_empleados`, `objetivos`, `clientes`, `contratos`, `facturacion`, `gerencia`, `habilitaciones`, `administracion`) |
| `contenido` / `notas` | Tipo de documentos |

Reglas, controladas en la base (no en la interfaz):

- Un archivo **sin área** o de un área **cerrada** no se puede pedir.
- Hace falta, a la vez: área habilitada + módulo autorizado + nivel de acceso
  del usuario. Conocer un id o una ruta no alcanza.
- Se vuelve a controlar al abrir (si el área se cerró, ya no se abre).
- El lector sólo toma pedidos de áreas habilitadas y sólo puede leer carpetas
  de áreas habilitadas; jamás una ruta arbitraria.
- Cada cambio de un área queda en `documental_areas_historial` (inmutable).

Cambiar un área (por ahora, desde el editor SQL de Supabase; queda registrado):

```sql
update documental_areas set habilitada = true where codigo = 'policia';
```

**Antes de habilitar un área**, definir y probar sus permisos (nivel y módulos).

## 2. Lector de SRV02

- Tarea programada `\Mercosur\Lector documental` (cuenta SYSTEM, arranca con el
  servidor, una sola instancia, se recupera de fallas). Ver
  [`servicio/`](servicio/) y [ACTIVACION-SRV02.md](ACTIVACION-SRV02.md).
- Latido cada minuto en `documental_lectores`. Si no hay latido en 3 minutos,
  la app avisa al instante que el lector no está funcionando.
- Lectura sólo-lectura, verificación de hash y del tipo real, copia temporal de
  10 minutos, enlace de 60 s. Registros sin rutas ni nombres.

## 3. Referencias a entidades (estado y extensión)

Hoy, la entidad con referencias es el **empleado**:
`legajo_historico_propuestas` (archivo del índice → empleado, categoría del
catálogo de documentación de empleados) y `documentacion_documentos` (el
documento incorporado al legajo).

Separación que se mantiene en el circuito de empleados:

1. Detectado en MEGA (índice).
2. Identidad sugerida (`empleado_id_sugerido`, con su nivel de identificación).
3. Referencia aceptada y asociada (`aceptada`): exige declarar cómo se verificó
   el original (visor de la app, MEGA directo u otro; sin visor, con
   observación). Queda en `legajo_historico_eventos`.
4. Incorporado a Documentación (`importada` → `documentacion_documentos`).
5. Revisado y validado en Documentación (`aprobado`).

La identidad (`senales.nivel`) y la categoría (`confianza`) son evaluaciones
distintas; la categoría sugerida se puede corregir o quitar a mano
(«recategorizar», con motivo).

**Para objetivos, clientes y contratos** (cuando se desarrollen) se reutiliza
lo mismo, agregando una tabla de referencias genérica en lugar de duplicar la
de empleados:

```
documental_referencias (diseño, NO creada todavía)
  id, repositorio_id → repositorio_documental, area_codigo → documental_areas,
  entidad_tipo ('objetivo' | 'cliente' | 'contrato'), entidad_id,
  categoria (catálogo propio por entidad), estado (pendiente|aceptada|descartada),
  verificacion, eventos (mismo patrón append-only)
```

Y el pedido de visualización se generaliza a `documental_solicitar_vista(
p_referencia, p_modulo)` con el mismo control de área + módulo + nivel; la cola
(`legajo_historico_vistas`, ya con `area_codigo` y `modulo`), el lector, el
bucket, el enlace y la auditoría no cambian. Las referencias históricas de
empleados **no** se migran.

## 4. Legajo Digital de Objetivos (futuro — no desarrollado)

Entidades existentes que se reutilizan:

| Concepto | Hoy |
|---|---|
| Objetivo (lugar del servicio) | `objetivos` (el cliente es un texto en `objetivos.cliente`) |
| Puesto (unidad de cobertura dentro del objetivo) | `puestos` (`objetivo_id`) |
| Servicio habitual por puesto | `servicios_objetivo`, `turnos_base` |
| Horas programadas | `turnos` (programación mensual publicada) |
| Horas efectivamente cubiertas | turnos confirmados por Supervisión (`revisiones_planilla`) y horas liquidables (`lib/liquidacion`) — **no** fichajes GPS solos |

A crear cuando se desarrolle (sin tocar las reglas de programación, planillas,
revisiones ni horas liquidables):

- `clientes` (hoy texto libre) y `contratos` (cliente, objetivo, vigencia
  desde/hasta, documentos en MEGA vía `documental_referencias`).
- `contrato_puestos`: por puesto y período, horario de cobertura y **horas
  contratadas**, precio por hora o abono, actualizaciones de precio y anexos.
- Vista de cumplimiento por objetivo y período: contratadas vs. programadas vs.
  cubiertas (confirmadas por Supervisión) → faltantes y adicionales, por puesto
  y respetando vigencias y modificaciones.
- Gerencia: facturación prevista/emitida, costos laborales, rentabilidad por
  objetivo y cliente, vencimientos y renovaciones. Las áreas `facturas`,
  `clientes_precios`, `sueldos`, `bancos`, `balances` ya existen con nivel
  `gerencia` y cerradas.

## 5. Búsqueda documental común (futuro)

Disponible hoy: el índice (`repositorio_documental`: ruta, extensión, hash,
tamaño, disponibilidad) y, para empleados, las referencias con persona,
categoría, estado y fechas. Limitaciones: el índice no tiene fechas del
documento ni entidad; el cliente no es una entidad; hay carpetas sueltas en la
raíz de MEGA que repiten subcarpetas. La búsqueda común se apoyará en
`documental_referencias` (entidad + categoría + estado + fechas) más el área.
No se indexa ni escanea MEGA para esto.
