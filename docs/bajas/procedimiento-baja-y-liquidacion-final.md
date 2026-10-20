# Baja laboral, acceso y liquidación final

Orden de desarrollo de JC del 20/10/2026. Migración `20261110120000_liquidacion_final_borrador.sql` (rollback aparte, **sin aplicar**).

## Procedimiento (una sola carga)

**Guardias → Registrar baja**, **Legajo → REGISTRAR BAJA** o **Diferencias con ARCA → Registrar baja**: los tres abren el mismo formulario (`components/bajas/RegistrarBaja.tsx`) y escriben en la misma tabla (`baja_laboral`).

1. **Identificación automática**: nombre, DNI, CUIL, ingreso (legajo), legajo, situación laboral y acceso.
2. **Motivo** (catálogo `baja_causa`, ampliable) y **fechas**:
   - fecha de notificación;
   - fecha **efectiva** (nunca se toma del último turno);
   - fecha del registro administrativo.
3. **Telegramas / documentación**:
   - se suben al legajo con el circuito de documentación existente (tipos nuevos: telegrama de renuncia, telegrama de despido, acuerdo, documentación de la baja; carta documento ya existía);
   - la IA (la misma infraestructura Gemini que lee credenciales) lee el documento y **sugiere** fechas, motivo y datos;
   - avisa si el documento es ilegible, si las fechas se contradicen o si el nombre o el DNI no coinciden;
   - no completa nada sola.
4. **Vacaciones**:
   - antigüedad, devengadas (método de la planilla de JC), control LCT, gozadas (novedades de la app más registros manuales) y pendientes;
   - un registro manual que se superpone con otro, o con una novedad de la app, se rechaza;
   - Administración marca «verifiqué el historial»; sin esa marca quedan pendientes.
5. **Turnos posteriores a la fecha efectiva**: se muestran antes de confirmar.
6. **CONFIRMAR BAJA** (con confirmación explícita): en **una transacción**
   - registra la baja;
   - pasa a desvinculado (`usuarios.estado = 'inactivo'`);
   - bloquea el acceso (`usuarios.acceso_bloqueado`);
   - guarda las vacaciones confirmadas y los turnos posteriores;
   - genera el borrador de liquidación final.

   Después, la ruta `/api/bajas/confirmar`:
   - aplica el ban en Supabase Auth;
   - avisa por push a los supervisores de la zona y a los jefes, sin importes ni motivo.

   Si el ban falla, la base ya está bloqueada y queda un botón para reintentar.
7. **Liquidación → Liquidaciones finales**:
   - revisar (bases, fechas, cantidades, importes, ajustes, pendientes);
   - resolver los conceptos de la causal;
   - indicar el período o tipo de Visual;
   - **Aprobar para exportar** → **Exportar a Visual (.xls)** → importar en Visual → reimportar la Planilla de Sueldos → **Conciliar** al centavo.

Mientras la baja es **borrador**, el empleado no cambia de situación ni pierde el acceso.

## Estados separados

| | Dónde | Valores |
|---|---|---|
| Situación laboral | `usuarios.estado` | activo / inactivo (desvinculado) |
| Acceso | `usuarios.acceso_bloqueado` + ban en Auth | habilitado / bloqueado |
| Situación administrativa | `liquidacion_final.estado` | pendiente de cálculo / borrador / lista / exportada / conciliada / anulada |

## Bloqueo de acceso: dónde se hace efectivo

- **Base**:
  - política RLS **restrictiva** `acceso_bloqueado_baja` en todas las tablas públicas con RLS y en `storage.objects`. Con una sesión o un token vivos no lee ni escribe nada;
  - trigger `usuarios_guarda_acceso_bloqueado`: nadie desbloquea con un update directo, y no se reactiva (`estado = 'activo'`) a quien tiene el acceso bloqueado.
- **Auth**: ban (`ban_duration`) desde `/api/bajas/confirmar`. Con el ban no inicia sesión ni renueva tokens; aunque la recuperación de contraseña siga enviando el mail, el enlace no le abre sesión.
- **Sincronizar accesos / Reset DNI / Crear acceso / Reparar** (`motivoSinAcceso`): no tocan a desvinculados ni a bloqueados. Además, Sincronizar ya **no resetea contraseñas** de cuentas existentes (SEG-01 de la auditoría).
- **App**: al iniciar o restaurar la sesión consulta `mi_acceso_estado()` y muestra «Tu acceso está deshabilitado por una baja laboral».
- **Rehabilitar**: sólo Gerencia, con motivo (`acceso_rehabilitar` + quitar el ban). No reactiva la situación laboral.

## Permisos

- **Registrar, confirmar y rectificar bajas; documentos; vacaciones**: `legajo_puede_gestionar()`, o sea Administración, Gerencia o delegación de Gerencia.
- **Anular una baja confirmada y rehabilitar el acceso**: sólo Gerencia (`puede_acceder_gerencia_actual()`).
- **Liquidación final** (calcular, aprobar, exportar, conciliar): `puede_liquidar_actual()`, los permisos del módulo Liquidaciones.
- **Supervisores**: sólo el aviso push de los turnos a reasignar. No ven bajas, documentos ni importes (RLS).
- **Vigiladores**: nada.

## Fórmulas (reglas operativas de JC; no son validación normativa)

Básico 1.020.300 · valor día C3 = básico/200×8 = 40.812 · hora extra 2.500.

| Código | Regla | A Visual |
|---|---|---|
| Ordinarios (000, 001, 203, 204, 214, 004, 006, 010, 205, 008…) | La misma planilla del Excel de trabajo mensual, recortada a la persona y hasta la fecha efectiva. Se descuenta lo ya enviado a Visual en períodos exportados. | Práctica mensual: 1 × total; 000 como cantidad. |
| 204 | Según la causal. Renuncia que no completa el mes: 0, con motivo. | |
| 120003 | (básico/200×150)/365 × días. Días = baja − inicio, con inicio = 1/1 o 1/7, o el ingreso si es posterior. Regla de la hoja «calculo liq». | 1 × total (como en los recibos). |
| 208 | (devengadas − tomadas confirmadas en la baja) × valor día. | Días × 40.812. |
| 212 | Horas excedentes × hora extra − extras ya pagadas por banco. | 1 × total. |
| 217 | **No se agrega solo** (no figura en los recibos). Se calcula como sugerencia (básico/365 × días) y entra sólo con un ajuste con motivo. | Importe. |
| Causal | Despido sin causa: indemnización (207), preaviso (252) e integración del mes quedan **a evaluar**: bloquean hasta resolverlos («incluido» con un ajuste, o «no corresponde» con motivo). | |

Control del SAC con la base legal: la mejor remuneración imponible del semestre según los resultados de Visual importados. Se muestra al lado y avisa la diferencia, sin reemplazar la regla.

## Casos de referencia

Recibos 15263/15264 y Planilla de Sueldos de Visual:

- **Fulla** (baja 30/09/2026, ingreso 01/03/2023):
  - 120003: 91 días, $190.782,12. El recibo tiene $129.983,42, un error de copia reconocido;
  - 208: 14 × 40.812 = $571.368.
- **Paniagua** (ingreso 02/08/2026): concepto por concepto igual al recibo:
  - 001 $244.872 · 120003 $129.983,42 (62 días) · 203 $123.480;
  - 208 3 × 40.812 · 212 $35.000 · 214 $7.200 · 204 en 0.

  **Pendiente de validación**: 62 días exigen la baja el 03/10, pero la app tiene turnos hasta el 08/10.

## Doble pago

- La exportación se rechaza si cambió lo ya liquidado en el mes o las extras pagadas desde el cálculo, o si ya hay otra final exportada de la persona en el mes. Reintentar con el mismo archivo no duplica.
- Un período mensual no puede volver a enviar un código con valor que salió en una final exportada del mismo mes y CUIL. Es una regla nueva del circuito mensual: sólo actúa si hay una final exportada.

## ARCA

Diferencias con ARCA no da de baja a nadie.

- «Activo en la app, no figura en ARCA» → botón **Registrar baja**, que abre el mismo procedimiento.
- «Relación vigente en ARCA sin usuario activo» → muestra si la app ya tiene la baja registrada (para darla de baja en ARCA).

No hay consulta automática a ARCA: no existe web service para el empleador (ticket 47207062).

## Pruebas

- `tests/liquidacion-final.test.ts` y `tests/baja-laboral.test.ts` (vitest).
- `supabase/pruebas/liquidacion-final/run.mjs` (PGlite; ver su README).
