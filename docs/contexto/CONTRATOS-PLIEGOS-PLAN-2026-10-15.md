# Contratos y pliegos por objetivo — plan del siguiente desarrollo

Objetivo: que la ficha de cada objetivo muestre **sus** documentos contractuales
(contrato, pliego, anexos, prórrogas) y que la IA contraste las obligaciones con
el protocolo y con la configuración de la app. Sin estructura documental
paralela y sin asumir que un archivo encontrado es el contrato vigente.

## Qué ya existe y se reutiliza

| Pieza | Para qué |
|---|---|
| `repositorio_documental` (153.218 archivos de MEGA, por ruta y hash) | Única fuente de archivos. No se copia nada. |
| `documental_areas` (área `clientes`, módulos clientes/objetivos/contratos, nivel de acceso) | Permisos por área: contratos sólo Administración y Gerencia. |
| Visor temporal del legajo (`legajo_historico_vistas` + lector en SRV02, enlace firmado de 60 s) | Abrir un PDF de MEGA desde la ficha sin copiarlo a la nube. Mismo mecanismo, otra área. |
| `lib/ia/gemini.ts` + registro de corridas (`protocolo_ia_corridas` como patrón) | Extracción de obligaciones con tokens registrados. |
| `protocolo_diferencias` (origen + cita textual + estado + resolución de Gerencia) | Donde quedan las observaciones contrato ↔ protocolo ↔ app. |
| `protocolo_instrucciones` (rangos exactos del protocolo) | Para citar la instrucción contra la que se compara. |

## Qué hay en MEGA hoy (consulta `docs/consultas/CONTRATOS-1-candidatos-por-objetivo.sql`, 15/10)

- Coincidencias claras por carpeta: **INTA** (59 archivos con nombre contractual), **NACIÓN SERVICIOS** (24), **RADIO NACIONAL** (6), **CLUB UNIVERSITARIO** (6), **RAPSODIA** (6), **PSA** (5), **RANSTAD** (4), **PNC REMOLQUES** (3), **MUNICIPALIDAD DE ROSARIO** (3, compartida por 8 objetivos municipales), **ROVIAL** (1).
- `ADMINISTRACION/LICITACIONES`: 2.230 archivos sin cliente en la ruta.
- **El cruce por nombre se equivoca solo**: «La Casona» y «La Comedia» caen en «LA CAJA - HAGANA» por la palabra «la». Por eso **ningún vínculo se confirma automáticamente**.

## Lo que falta (en este orden)

1. **Vínculo propuesto → confirmado**. Tabla `objetivo_documentos`:
   - `objetivo_id`, `repositorio_id`;
   - `tipo` (contrato, pliego, anexo, prórroga, orden de compra, otro);
   - `vigencia_desde` y `vigencia_hasta`, opcionales;
   - `estado` *propuesto → confirmado / descartado*, con quién y cuándo.

   La IA y la consulta CONTRATOS-1 sólo crean *propuestos*. Confirma Administración o Gerencia, y un documento puede quedar vinculado a varios objetivos (caso Municipalidad).
2. **Texto de los documentos**: hoy el agente documental no extrae texto (sus plugins son stubs).
   - Hay que sumar extracción de PDF y DOCX con capa de texto en el lector de SRV02, sólo para documentos **confirmados**.
   - Se guarda por página en `documento_textos` (documento, página, texto, hash).
   - OCR para escaneos, en una etapa posterior.
3. **Obligaciones contractuales**: la IA propone `contrato_obligaciones`:
   - documento, página, **fragmento literal** con su rango;
   - tipo: dotación, horario, tarea, informe, refuerzo, vigencia o penalidad;
   - estado *propuesta → validada*.

   Valida una persona. Mismo patrón de citas que las instrucciones del protocolo.
4. **Comparación de cuatro capas**: contrato (obligación validada), protocolo (instrucción), configuración de la app (rondas, checklist, tareas del turno, turnos programados) y ejecución real.
   - Cada hallazgo se registra en `protocolo_diferencias` con su fuente y cita.
   - Hay que ampliar el CHECK de `tipo` con *obligación omitida en el protocolo*, *contradicción con el contrato*, *control faltante* e *instrucción interna adicional*.
   - **Nada corrige el protocolo solo**: la meta es mejorar el servicio, no llevar las diferencias a cero.
5. **Ficha del objetivo**: bloque F «Documentación» con documentos confirmados, vigencias y vencimientos, y propuestas para confirmar. Sólo Administración y Gerencia; el vigilador nunca ve contratos.

## Decisiones que hacen falta antes de programar

- ¿Quién confirma vínculos: sólo Gerencia, o también Administración?
- ¿Se habilita el lector de SRV02 a extraer texto de `CLIENTES/` y `ADMINISTRACION/LICITACIONES`? Hoy sólo lee `EMPLEADOS/`.
- ¿Se autoriza el costo de IA de leer contratos completos? Se registra por corrida.
