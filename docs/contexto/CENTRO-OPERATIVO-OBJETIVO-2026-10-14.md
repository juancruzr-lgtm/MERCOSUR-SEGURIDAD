# Centro operativo por objetivo — primera entrega

Base: auditoría del 14/10/2026 y PR #315 (protocolos, en `main` con migraciones
aplicadas). Esta entrega no repite esa auditoría: verifica en código y en la
base sólo lo que hacía falta para decidir el diseño.

Meta: al abrir un objetivo, entender **qué** hay que hacer, **por qué**,
**quién**, **cuándo** y **si se hizo**.

---

## 1. Cómo están relacionados hoy los módulos

| Qué | Dónde vive (base) | Dónde se ve | Relación con el objetivo |
|---|---|---|---|
| Objetivo y puestos | `objetivos`, `puestos`, `servicios_objetivo` | Menú Objetivos → ficha (`CentroOperativoObjetivo`); Programación | Directa |
| Protocolo | `protocolo_versiones`, `_aperturas`, `_confirmaciones`, `_diferencias` | Ficha (sección Protocolo), menú Protocolos, tarjeta de turno del vigilador | Directa (`objetivo_id`, `puesto_id`) |
| Contratos, pliegos, anexos | **No existen como datos.** Sólo archivos indexados por ruta en `repositorio_documental` (153.218; 5.317 bajo `CLIENTES/`) y el área `clientes` de `documental_areas` | Ninguna pantalla | **Ninguna**: no hay `cliente_id` ni `objetivo_id`; `objetivos.cliente` es texto libre |
| Checklist | `checklist_plantillas`, `checklist_items`, `supervision_respuestas`; `objetivos.checklist_plantilla_id` | Se asigna en el formulario de Objetivos; se edita en menú Checklists (sólo admin pleno); se responde en `SupervisorMobile` | Una plantilla por objetivo; los ítems son de la plantilla, no del objetivo. **Sólo para supervisores**: el vigilador no tiene checklist |
| Rondas | `rondas_base` (un intervalo por ronda), `ronda_puntos`, `ronda_ejecuciones`, `ronda_alertas` | Menú Rondas; ficha (3 bloques); vigilador (`RondasGuardiaPanel`) | Directa (`objetivo_id`, `puesto_id`) |
| Órdenes / tareas | **No existen.** Lo más cercano: `supervisor_intervenciones` (acciones sobre alertas) y `novedades` | — | — |
| Supervisiones | `supervisiones`, `supervision_fotos` | Menú Supervisiones; ficha («Última supervisión» + historial); `SupervisorMobile` | Directa |
| Alertas | `ronda_alertas` (guardadas); asistencia/descubierto **recalculadas** en cada corrida; envíos en `notificaciones_enviadas` y `escalamiento_whatsapp_envios` | Cierre operativo, Revisión operativa, ficha (mosaico «Alertas») | Directa |
| Novedades | `novedades` (sin registros desde el 13/05/2026; el vigilador no puede cargar) | Ficha; página sin entrada en el menú | Directa, pero muerta |
| Turnos y responsables | `turnos`, `supervisores_guardia`, `lib/responsables-operativos.ts` | Turnos, grilla de la ficha, Supervisores de guardia | Directa |
| Permisos | `lib/capacidades.ts` (UI) + RLS `alcanza_objetivo_actual()` (zona) | — | Por puesto y zona |

Datos que pesan en el diseño:
- Aldo Monzón figura como **jefe de supervisores**: puede preparar protocolos (y editarlos) pero no publicarlos. Coincide con «revisar y proponer».
- Checklist de supervisión, 90 días: **5.510 «correcto», 4.558 «no aplica», 9 «observado»**. Hay 4 plantillas activas; dos son de prueba («44444», «la ofi»). Los 8 ítems de «supervision simple» son genéricos («comentarios», «foto cargada»): el checklist hoy casi no distingue un objetivo de otro.
- Protocolos en producción: 22 borradores (7 con objetivo sin confirmar), 0 vigentes, 0 lecturas.

## 2. Problemas concretos de navegación y duplicación

1. **El protocolo estaba al final de la ficha**, después del historial JWM (`CentroOperativoObjetivo.tsx`, antes en la línea 2510), y dentro del panel había que tocar «Ver texto completo». → **Corregido en esta entrega.**
2. **El mosaico «Alertas» lleva a una sección que no muestra esas alertas**: `sec-alertas` sólo lista novedades (`CentroOperativoObjetivo.tsx` ~2297–2311). Con alertas de asistencia y sin novedades, la sección ni aparece.
3. **Rondas en cuatro lugares de la ficha**: mosaico «Rondas pendientes», `SeccionRondas`, `RondasSupervisionPanel` y el historial JWM, además del menú Rondas. La configuración nativa se muestra según el **rol viejo** (`rolUsuario === 'admin' || 'supervisor'`), no por capacidades.
4. **Supervisión duplicada**: la tarjeta «Última supervisión» repite el primer elemento de `SeccionSupervisiones`.
5. **JWM ocupa espacio sin datos**: mosaico «Checkpoints JWM hoy», «Integraciones», «Historial JWM» y modal de importación; sin importaciones desde el 01/07.
6. **Novedades muerta pero visible**: mosaico, sección y «Ver todas» hacia una página que ya no está en el menú.
7. **El checklist no se ve en la ficha**: se asigna en otro formulario (Objetivos), se edita en otro menú (Checklists, sólo admin pleno) y no se relaciona con nada del protocolo.
8. **Botones «próximamente»** en la ficha: Documentación y Cámaras.

## 3. Propuesta de pantalla unificada (con componentes existentes)

Una sola ficha, en este orden, sin pantallas nuevas:

| Bloque | Responde a | Componentes que se reutilizan |
|---|---|---|
| **A. Encabezado + semáforo** | ¿cómo está? | Lo actual |
| **B. Protocolo del servicio** | ¿qué hay que hacer y por qué? | `ProtocoloObjetivoPanel` (**hecho**) |
| **C. Hoy en el objetivo** | ¿quién está y quién responde? | Mosaicos + «Turnos hoy» + `personas` de `lib/legajo-objetivo` + responsable de `lib/responsables-operativos` |
| **D. Controles** (pestañas) | ¿cómo se verifica? | Rondas (`SeccionRondas` + `RondasSupervisionPanel`), Checklist de supervisión (`SeccionSupervisiones` + plantilla asignada), más adelante Tareas del turno |
| **E. Requiere intervención** | ¿qué no se hizo? | Alertas de ronda pendientes (`listarRondaAlertasObjetivo`), asistencia (`derivarEstadoObjetivo`), diferencias de protocolo, órdenes abiertas (futuro) |
| **F. Documentación y planificación** (plegado) | ¿qué dice el contrato?, ¿cómo se programa? | Grilla de programación actual; contratos cuando existan (sección 5) |
| **G. Legado JWM** (plegado, al final) | — | Lo actual |

Por rol: el **vigilador** sigue en su tarjeta de turno (protocolo + rondas, hoy; tareas, después). El **supervisor** entra por la ficha y ve B, C, D, E. **Aldo / Dirección Operativa** edita B y gestiona órdenes en E. **Administración** consulta B y F. **Gerencia** aprueba en B y mira E.

Cuando existan los vínculos de la sección 5, cada control de D y cada observación de E muestra **la instrucción del protocolo que lo origina** («por qué») y, si aplica, la cláusula del contrato.

## 4. Implementado en esta entrega

- La sección Protocolo pasó al **primer lugar de la ficha**.
- Se ve **de entrada el texto completo de la última versión escrita**, con una franja que dice qué es:
  - *Vigente*: lo que leen los vigiladores, desde cuándo y quién aprobó.
  - *Borrador* o *pendiente de aprobación*: «todavía no lo ve el personal», más qué ve hoy (la vigente vN, o nada).
- Vigente y versión en trabajo **nunca se mezclan**: pestañas «Vigente · lo que ve el vigilador» / «Borrador · vN». Si hay dos borradores (Rapsodia), se avisa que Gerencia tiene que elegir.
- **Editar desde la misma pantalla**:
  - Un borrador redactado en la app se guarda sobre sí mismo.
  - El texto original de Aldo y toda versión enviada, vigente o reemplazada **no se reescriben**: «Editar» crea un borrador nuevo con ese texto, la fuente queda como «Edición en la app sobre la versión N…» y el original sigue intacto en el historial.
  - Mientras Gerencia no confirme el objetivo de una coincidencia probable, **no se edita** (un borrador nuevo nacería con el objetivo confirmado y saltearía esa validación).
- **Comparar versiones**: diferencia línea por línea entre lo que se muestra y cualquier otra versión del mismo alcance.
- **En segundo plano** (plegado): Lecturas del personal, Historial de versiones (con acciones de aprobación) y Diferencias pendientes.
- Sin migraciones ni cambios de permisos: todo usa las RPC de #315 (`protocolo_crear_borrador`, `protocolo_editar_borrador`, etc.), que ya validan puesto y alcance.

## 5. Diseño técnico: contratos y checklist automáticas

### 5.a Contratos y pliegos

**Qué se reutiliza**
- `repositorio_documental`: ya indexa por ruta y hash los archivos de MEGA, incluido `CLIENTES/` (p. ej. «NACIÓN SERVICIOS» con 1.129 archivos, «INTA» 372, «RANSTAD» 182).
- `documental_areas` (área `clientes`, módulos clientes/objetivos/contratos) para permisos por área.
- El visor temporal de MEGA del legajo (`legajo_historico_vistas`) como patrón para abrir un archivo sin copiarlo.
- `lib/ia/gemini.ts` para extracción.
- `protocolo_diferencias`, que ya guarda origen y cita textual.

**Qué falta**
1. **Vínculo documento ↔ objetivo**: tabla `objetivo_documentos` (objetivo, documento del repositorio, tipo contrato/pliego/anexo/prórroga, vigencia desde/hasta, estado *propuesto → confirmado / descartado*, quién confirmó). Los candidatos se proponen por carpeta (`CLIENTES/<cliente>`) y nombre. **Nunca se confirman solos**: que un archivo esté en la carpeta no dice que sea el contrato vigente.
2. **Texto de los documentos**: el agente documental de SRV02 no extrae texto (sus plugins son stubs). Hay que sumar extracción de PDF/DOCX con capa de texto; OCR para escaneos, después. Se guarda por página en `documento_textos` (documento, página, texto, hash).
3. **Cláusulas**: la IA propone `contrato_clausulas` (documento, página, fragmento literal, tipo: dotación, horario, obligación, informe, refuerzo, vigencia), con estado *propuesta → validada*.
4. **Comparación**: cuatro capas (contrato, protocolo, configuración de la app, ejecución real). Cada observación se registra en `protocolo_diferencias` con su fuente y fragmento. Habría que ampliar el CHECK de `tipo` con *obligación contractual omitida*, *contradicción con el contrato* y *control faltante*. **Nada corrige el protocolo solo.**
5. **Permisos**: contratos sólo para Administración y Gerencia (como el legajo); jamás para el vigilador.

### 5.b Checklist automáticas desde el protocolo

**Qué se reutiliza**
- El único motor de checklist: `checklist_plantillas` + `checklist_items` + `objetivos.checklist_plantilla_id` + `SupervisorMobile`. Es **de supervisión**.
- Rondas (`rondas_base` / `ronda_puntos`) como motor de tareas periódicas del vigilador.
- `evidencias` (ya tiene `proceso_tipo`) para la prueba de ejecución.

**Qué falta, en este orden**
1. **Instrucciones**: dividir el texto de una versión en párrafos con referencia estable, sin tocar el texto. Tabla `protocolo_instrucciones`: versión, orden, rango de caracteres, hash del párrafo, clasificación (informativa, obligación, frecuencia, excepción), quién y cuándo. La clasificación la propone la IA y la valida una persona.
2. **Propuestas de control**: por cada instrucción verificable, la IA propone el destino (punto de checklist de supervisión, punto de ronda, tarea del turno, orden puntual, alerta o ninguno), con cuándo y quién. **Antes de proponer, compara con lo existente** (ítems de la plantilla del objetivo, rondas y puntos) para no duplicar. Tabla `protocolo_controles_propuestos`: instrucción, tipo, destino, propuesta, estado *propuesto → aprobado / rechazado → activado*, quién aprobó.
3. **Activar lo aprobado con el motor existente**:
   - *Checklist de supervisión*: se crea (o reutiliza) una plantilla propia del objetivo, copia de la genérica más los ítems aprobados. Hay que sumar `checklist_items.origen_instruccion_id` para que cada ítem diga de qué instrucción sale.
   - *Ronda*: sólo como propuesta. Frecuencias, radios y alertas no se tocan sin aprobación expresa, porque afectan la nota.
4. **Tareas del turno del vigilador**: hoy no hay motor. Dos caminos:
   - *(A)* Reutilizar rondas: una «ronda» de control de ingreso, una vez por turno, con puntos sin GPS. Tiene alertas y evidencia desde el primer día, pero entra en la dimensión Rondas de la nota.
   - *(B)* Una tabla liviana `tareas_turno`, sin efecto en la calificación.
   - **Decide Gerencia.**
5. **Órdenes operativas**: no hay estructura reutilizable adecuada (`novedades` está muerta y no tiene responsable ni plazo). Mínimo: `ordenes_operativas` (objetivo, instrucción de origen, descripción, responsable, plazo, estado abierta/cumplida/vencida/cancelada), con evidencia en `evidencias` (`proceso_tipo = 'orden'`).

## 6. Siguiente paso recomendado

1. **Usar esta pantalla** para que Gerencia confirme las 7 coincidencias probables, elija la versión de Rapsodia y publique los protocolos que correspondan. Hoy ningún vigilador ve nada.
2. **PR B — ficha unificada** (bloques C–G): reordenar y agrupar lo existente, corregir el mosaico «Alertas», plegar JWM y novedades. Sin cambios de datos.
3. **PR C — instrucciones y checklist propuesto** (sólo checklist de supervisión, en modo propuesta): `protocolo_instrucciones`, propuestas con IA, aprobación y activación sobre la plantilla del objetivo.
4. Después: vínculo de contratos (5.a), tareas del turno (según la decisión A/B) y órdenes.
