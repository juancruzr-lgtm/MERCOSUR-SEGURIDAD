// lib/visual-export.ts
//
// LIQ2D/LIQ2F — Generador del archivo de importación a Visual Sueldos (.xls BIFF8).
// Contrato nativo auditado (empresa 63): A1 título, E1 = id empresa, datos desde
// fila 3, A = COD_INTERNO, B = CUIL texto, C = código texto (ceros preservados),
// D = Cantidad, E = Importe, F vacía, G = Nombre (referencia, no se importa).
//
// MERCOSUR NO implementa fórmulas legales de Visual. Sólo crea las líneas y provee
// inputs. Por política del concepto (catálogo):
//   'valor'      -> informa cantidad/importe (Clase A).
//   'linea_cero' -> línea 0/0 para TODOS; Visual calcula (011,050,101,102,103,133).
//   'individual' -> por empleado (permanente): calculados 0/0; IMP (111/993) importe.
//   'no'         -> nunca se manda.
// Probado en Visual: importar una línea 0/0 hace que "Recalc. Todos" ejecute la
// fórmula. Reimportar reemplaza (idempotente), no suma.

export interface ConsolidadaRow {
  empleado_id: string
  legajo_visual: string | null   // COD_INTERNO de Visual
  cuil: string | null
  nombre: string | null
  codigo: string
  cantidad: number | null
  importe: number | null
}

export interface ConfigConcepto {
  exporta_visual: boolean
  manda_cantidad: boolean
  manda_importe: boolean
}

export interface FilaVisual {
  legajo: string        // COD_INTERNO
  cuil: string
  codigo: string
  cantidad: number | null
  importe: number | null
  nombre: string        // columna G (referencia)
}

export const EMPRESA_ID_VISUAL = 63
const TITULO = 'VisualSueldos - Planilla de importación de datos'
const ENCABEZADOS = ['Legajo', 'CUIL', 'Código de concepto', 'Cantidad', 'Importe']
const HDR_NOMBRE = 'Nombre y Apellido (solo como referencia, no se importa)'

// ── Modelo del generador completo (LIQ2F) ────────────────────────────────────
export type Politica = 'valor' | 'linea_cero' | 'individual' | 'no'
export type Entrada = 'IMP' | 'CAN' | 'CANIMP' | 'CALCULADO'

export interface ConceptoCfg { politica: Politica; entrada: Entrada; nombre?: string; categoria?: string }

// AJUSTE al básico (050) y DIFERENCIA de O.S. (133 = "diferencias O.S."): sólo
// corresponden cuando el REMUNERATIVO del empleado está POR DEBAJO del Básico de la
// liquidación. El 050 ajusta la base hasta el básico y el 133 ajusta la O.S. a ese
// básico; si el remunerativo YA supera el Básico, ninguno corresponde (el 133 daría
// NEGATIVO en Visual). Regla JC 05-06/10 (reemplaza la corrección al importar): la
// decisión se toma ANTES de exportar, con el REMUNERATIVO calculado SÓLO sobre las
// HORAS (001, con las correcciones manuales), comparado contra el Básico de esa
// liquidación. El 133 NO se manda en cero: su sola presencia dispara el cálculo en
// Visual, así que cuando no corresponde se OMITE.
export const CODIGOS_SOBRE_BASICO = new Set(['050', '133'])
// Categorías del catálogo que integran el REMUNERATIVO (base que Visual usa para la
// O.S.): imponibles + asignaciones remuneratorias. Se EXCLUYEN los no remunerativos
// ('no_imponible', p.ej. 214/008), los descuentos ('descuento', incluido el propio
// 133) y las bases auxiliares ('base_auxiliar', p.ej. 000/050/213).
// El remunerativo que decide la Diferencia de O.S. (133) se calcula SÓLO sobre las
// HORAS (001) — JC 06/10. No entran presentismo, viáticos, adicional, nocturnidad,
// feriados, etc., ni la antigüedad (que Visual calcula aparte): si en algún caso
// puntual eso genera un negativo, JC lo revisa a mano. Sólo cuando el 001 supera el
// Básico (típicamente administrativos con sueldo mensual alto) se omite el 133.
export const CODIGOS_REMUNERATIVO_OS = new Set(['001'])
// Persona liquidable (padrón canónico), no necesariamente un usuario de la app.
export interface PersonaPadron {
  persona_id: string
  cod_interno: string | null
  cuil: string | null
  nombre: string
  esPrueba?: boolean
  tieneUsuario?: boolean
  /** Excluido de Liquidación por decisión explícita (no se exporta a Visual). */
  excluido?: boolean
  motivoExcluido?: string | null
  /** Mensualizado (supervisor/jefe/dir.op/administración/gerencia). Para la regla
   * 000: un mensualizado sin jornadas ni conceptos queda PENDIENTE de 000 manual
   * (D); un operativo en esa situación se EXCLUYE del período (C). */
  mensualizado?: boolean
}
export interface HaberLinea { codigo: string; cantidad: number | null; importe: number | null }
export interface PermanenteLinea { codigo: string; importe: number | null }   // calculados 104/977/48410
export interface ExpedienteLinea { referencia?: string | null; importe: number | null; slot_preferido?: '111' | '993' | null }

export interface Hallazgo { persona_id: string | null; cuil: string | null; codigo?: string; tipo: string; detalle: string }
export type EstadoPadron = 'exporta' | 'no_corresponde' | 'falta_info'
export interface PadronEstado { persona_id: string; cuil: string | null; nombre: string; estado: EstadoPadron; filas: number; motivo?: string }

export interface ResultadoLineas {
  lineas: FilaVisual[]
  criticos: Hallazgo[]        // estructurales/config: bloquean TODO el export
  bloqueados: Hallazgo[]      // por persona (identidad, 000 pendiente, >2 exp): se excluye esa persona, NO el archivo
  advertencias: Hallazgo[]    // visibles, no bloquean
  padron: PadronEstado[]
}

const SLOTS_EXPEDIENTE = ['111', '993'] as const
const soloDigitos = (s?: string | null) => String(s ?? '').replace(/\D/g, '')

// Bloqueos por persona clasificados por CAUSA, para no mezclarlas en un solo
// cartel confuso (pedido JC): identidad Visual faltante ≠ 000 requerido.
export interface BloqueosClasificados {
  identidadFaltante: Hallazgo[]  // sin COD_INTERNO o CUIL inválido → no está en Visual
  diasRequerido: Hallazgo[]      // 000 pendiente → cargar el valor (manual si es mensualizado)
  otros: Hallazgo[]              // p.ej. >2 expedientes
}
export function clasificarBloqueados(bloqueados: Hallazgo[]): BloqueosClasificados {
  const identidadFaltante: Hallazgo[] = []
  const diasRequerido: Hallazgo[] = []
  const otros: Hallazgo[] = []
  for (const b of bloqueados) {
    if (b.tipo === 'falta_cod_interno' || b.tipo === 'cuil_invalido') identidadFaltante.push(b)
    else if (b.tipo === 'dias_pendiente') diasRequerido.push(b)
    else otros.push(b)
  }
  return { identidadFaltante, diasRequerido, otros }
}

/**
 * Construye las líneas del archivo Visual desde el PADRÓN DE LIQUIDACIÓN (personas,
 * con o sin usuario). PURO. Aplica la política por concepto y valida:
 *  - críticos estructurales/config → bloquean TODO el archivo;
 *  - bloqueos por persona (falta COD_INTERNO/CUIL, 000 pendiente, >2 expedientes)
 *    → excluyen a esa persona y se reportan, sin frenar el resto.
 * NO calcula fórmulas legales: 'linea_cero' e individuales calculados salen 0/0.
 * `000` NO se deriva de jornadas: viene de `dias` (editable); si falta, es pendiente.
 */
export function construirLineasVisual(p: {
  padron: PersonaPadron[]
  catalogo: Map<string, ConceptoCfg>
  haberes: Map<string, HaberLinea[]>          // por persona_id (usuario-linkeadas)
  dias: Map<string, number | null>            // 000 por persona_id (editable)
  permanentes: Map<string, PermanenteLinea[]> // calculados individuales por persona_id
  expedientes: Map<string, ExpedienteLinea[]> // expedientes de importe vigentes por persona_id
  lineaCero: string[]
  /** Básico de la liquidación: si el remunerativo previsto lo supera, se omiten 050/133. */
  basicoLiquidacion?: number
}): ResultadoLineas {
  const lineas: FilaVisual[] = []
  const criticos: Hallazgo[] = []
  const bloqueados: Hallazgo[] = []
  const advertencias: Hallazgo[] = []
  const padron: PadronEstado[] = []

  for (const e of p.padron) {
    const cuil = soloDigitos(e.cuil)
    const base = { persona_id: e.persona_id, cuil: cuil || null }
    if (e.esPrueba) { padron.push({ ...base, nombre: e.nombre, estado: 'no_corresponde', filas: 0, motivo: 'cuenta de prueba' } as any); continue }
    // Excluido de Liquidación por decisión explícita y trazable: NO se exporta,
    // pero se REPORTA (no es exclusión silenciosa).
    if (e.excluido) { padron.push({ ...base, nombre: e.nombre, estado: 'no_corresponde', filas: 0, motivo: `excluido de liquidación${e.motivoExcluido ? ': ' + e.motivoExcluido : ''}` } as any); continue }

    const errsEmp: string[] = []
    // Identidad
    if (!e.cod_interno || !String(e.cod_interno).trim()) { bloqueados.push({ ...base, tipo: 'falta_cod_interno', detalle: `${e.nombre}: sin COD_INTERNO (no está en Visual; no se exporta)` }); errsEmp.push('falta COD_INTERNO') }
    if (cuil.length !== 11) { bloqueados.push({ ...base, tipo: 'cuil_invalido', detalle: `${e.nombre}: CUIL inválido "${e.cuil}"` }); errsEmp.push('CUIL inválido') }
    // Regla 000 (JC 05/10): 000 NO es condición para exportar. Es sólo el registro
    // de los días REALMENTE trabajados; no se inventa, no se pide, no bloquea.
    const dias = p.dias.get(e.persona_id)
    const diasReal = dias != null && dias > 0

    const filasEmp: FilaVisual[] = []
    const emitir = (codigo: string, cantidad: number | null, importe: number | null) => {
      filasEmp.push({ legajo: String(e.cod_interno ?? '').trim(), cuil, codigo: String(codigo), cantidad, importe, nombre: e.nombre })
    }

    // 1) Haberes del período (política 'valor'): licencia, vacaciones, ART, etc.
    // En paralelo se acumula el REMUNERATIVO PREVISTO (Σ importe de los conceptos
    // remunerativos que se exportan), que decide 050/133 (ver más abajo).
    let haberReal = 0
    let remunerativoPrevisto = 0
    for (const h of p.haberes.get(e.persona_id) ?? []) {
      const cfg = p.catalogo.get(h.codigo)
      if (!cfg) { criticos.push({ ...base, codigo: h.codigo, tipo: 'concepto_sin_config', detalle: `código ${h.codigo} sin configuración en el catálogo Visual` }); continue }
      if (cfg.politica !== 'valor') { advertencias.push({ ...base, codigo: h.codigo, tipo: 'haber_politica_incorrecta', detalle: `código ${h.codigo} no es política 'valor' (${cfg.politica}); se omite` }); continue }
      let impEmitido = 0
      if (cfg.entrada === 'CAN') { if (h.cantidad == null) continue; emitir(h.codigo, h.cantidad, null); haberReal++ }
      else if (cfg.entrada === 'IMP') { impEmitido = h.importe ?? 0; emitir(h.codigo, 1, impEmitido); haberReal++ }
      else { impEmitido = h.importe ?? 0; emitir(h.codigo, h.cantidad ?? 1, impEmitido); haberReal++ }
      // Remunerativo para el 133 = SÓLO las horas (001). El resto de los conceptos
      // no cuenta para esta comparación (JC 06/10).
      if (CODIGOS_REMUNERATIVO_OS.has(String(h.codigo))) remunerativoPrevisto += impEmitido
    }

    // Regla 000 (JC): exporta quien TRABAJÓ (000 real) o tiene algún concepto
    // liquidable del período (licencia/vacaciones/ART/…). Si NO trabajó y NO tiene
    // conceptos: operativo → se EXCLUYE del período (C); mensualizado → queda
    // PENDIENTE de 000 manual (D), informativo, sin bloquear el archivo.
    const tieneReal = diasReal || haberReal > 0
    if (!tieneReal) {
      if (errsEmp.length > 0) {
        padron.push({ persona_id: e.persona_id, cuil: cuil || null, nombre: e.nombre, estado: 'falta_info', filas: 0, motivo: errsEmp.join(' · ') })
      } else if (e.mensualizado) {
        advertencias.push({ ...base, codigo: '000', tipo: 'dias_pendiente_mensualizado', detalle: `${e.nombre}: mensualizado sin jornadas — cargar 000 manual del período` })
        padron.push({ persona_id: e.persona_id, cuil: cuil || null, nombre: e.nombre, estado: 'no_corresponde', filas: 0, motivo: 'mensualizado: 000 pendiente de carga manual' })
      } else {
        padron.push({ persona_id: e.persona_id, cuil: cuil || null, nombre: e.nombre, estado: 'no_corresponde', filas: 0, motivo: 'sin jornadas ni conceptos liquidables en el período' })
      }
      continue
    }

    // 2) 000 DÍAS (CAN): sólo si trabajó jornadas reales. 0 jornadas → sin 000.
    if (diasReal) emitir('000', dias!, null)

    // 050 (ajuste) y 133 (diferencia O.S.): se OMITEN cuando el REMUNERATIVO PREVISTO
    // (de los conceptos que se exportan, con correcciones manuales) SUPERA el Básico
    // de la liquidación — ahí el 133 daría negativo en Visual. Igual o menor → se
    // conservan (comportamiento existente). Comparación por IMPORTES, no por horas.
    const omitirSobreBasico = p.basicoLiquidacion != null && remunerativoPrevisto > p.basicoLiquidacion

    // 3) Líneas 0/0 estructurales para TODOS (Visual calcula). EXCEPCIÓN: 050 y 133.
    for (const codigo of p.lineaCero) {
      if (omitirSobreBasico && CODIGOS_SOBRE_BASICO.has(codigo)) continue
      if (!p.catalogo.get(codigo)) { advertencias.push({ ...base, codigo, tipo: 'linea_cero_sin_config', detalle: `estructural ${codigo} sin config; se omite` }); continue }
      emitir(codigo, 0, 0)
    }

    // 4) Individuales calculados vigentes (permanentes 104/977/48410): línea 0/0.
    for (const perm of p.permanentes.get(e.persona_id) ?? []) {
      const cfg = p.catalogo.get(perm.codigo)
      if (!cfg) { criticos.push({ ...base, codigo: perm.codigo, tipo: 'concepto_sin_config', detalle: `individual ${perm.codigo} sin config` }); continue }
      if (cfg.entrada === 'CALCULADO') emitir(perm.codigo, 0, 0)
      else { advertencias.push({ ...base, codigo: perm.codigo, tipo: 'permanente_no_calculado', detalle: `${perm.codigo} no es calculado; revisar` }) }
    }

    // 5) Expedientes de importe vigentes → slots 111/993 (preservando el previo).
    const exps = (p.expedientes.get(e.persona_id) ?? [])
    if (exps.length > SLOTS_EXPEDIENTE.length) {
      bloqueados.push({ ...base, tipo: 'expedientes_exceden_slots', detalle: `${e.nombre}: ${exps.length} expedientes de importe simultáneos y sólo hay 2 slots (111/993). Resolver: no se descarta ni se pisa ninguno.` })
      errsEmp.push('expedientes > 2 slots')
    } else {
      const asignados = new Map<string, ExpedienteLinea>()
      for (const ex of exps) if (ex.slot_preferido && !asignados.has(ex.slot_preferido)) asignados.set(ex.slot_preferido, ex)
      for (const ex of exps) { if (Array.from(asignados.values()).includes(ex)) continue; const libre = SLOTS_EXPEDIENTE.find(s => !asignados.has(s)); if (libre) asignados.set(libre, ex) }
      for (const slot of SLOTS_EXPEDIENTE) {
        const ex = asignados.get(slot); if (!ex) continue
        if (ex.importe == null) { advertencias.push({ ...base, codigo: slot, tipo: 'expediente_sin_importe', detalle: `${e.nombre}: expediente en slot ${slot} sin importe; Visual mantiene el anterior` }); emitir(slot, 1, 0) }
        else emitir(slot, 1, ex.importe)
      }
    }

    // Validación cruzada: ningún concepto calculado con importe > 0.
    for (const f of filasEmp) {
      const cfg = p.catalogo.get(f.codigo)
      if (cfg && cfg.entrada === 'CALCULADO' && (f.importe ?? 0) !== 0) {
        criticos.push({ ...base, codigo: f.codigo, tipo: 'calculado_con_importe', detalle: `${f.codigo} es calculado por Visual y se intentó mandar importe ${f.importe}` })
      }
    }

    const estado: EstadoPadron = errsEmp.length > 0 ? 'falta_info' : (filasEmp.length > 0 ? 'exporta' : 'no_corresponde')
    padron.push({ persona_id: e.persona_id, cuil: cuil || null, nombre: e.nombre, estado, filas: filasEmp.length, motivo: errsEmp.join(' · ') || (filasEmp.length === 0 ? 'sin conceptos' : undefined) })
    if (errsEmp.length === 0) lineas.push(...filasEmp)
  }

  return { lineas, criticos, bloqueados, advertencias, padron }
}

/**
 * Filas a exportar (LIQ2D legacy, por config exporta/manda). Se conserva para
 * compatibilidad; el circuito completo usa construirLineasVisual.
 */
export function filasVisual(consolidadas: ConsolidadaRow[], configPorCodigo: Map<string, ConfigConcepto>): FilaVisual[] {
  const out: FilaVisual[] = []
  for (const r of consolidadas) {
    const cfg = configPorCodigo.get(r.codigo)
    if (cfg && cfg.exporta_visual === false) continue
    const mandaCantidad = cfg ? cfg.manda_cantidad : true
    const mandaImporte = cfg ? cfg.manda_importe : true
    const cantidad = mandaCantidad ? (r.cantidad ?? 1) : null
    const importe = mandaImporte ? (r.importe ?? null) : null
    if (cantidad === null && importe === null) continue
    out.push({ legajo: String(r.legajo_visual || r.nombre || '').trim(), cuil: soloDigitos(r.cuil), codigo: String(r.codigo).trim(), cantidad, importe, nombre: String(r.nombre ?? '').trim() })
  }
  return out
}

/**
 * Escribe el libro .xls BIFF8 real (Hoja1 + Hoja2/Hoja3 vacías) con el contrato
 * nativo: A1 título, E1 = empresa, encabezados en fila 2 (incluida G), datos
 * desde fila 3. CUIL/código como TEXTO; cantidad/importe numéricos 0.00.
 */
export async function escribirLibroVisualXls(filas: FilaVisual[], opts?: { empresaId?: number; xlsxMod?: any }): Promise<Uint8Array> {
  const XLSX: any = opts?.xlsxMod ?? (await import('xlsx'))
  const empresaId = opts?.empresaId ?? EMPRESA_ID_VISUAL
  const aoa: any[][] = [
    [TITULO, null, null, null, empresaId],                 // A1 título, E1 = empresa
    [...ENCABEZADOS, null, HDR_NOMBRE],                     // fila 2 (F vacía, G nombre)
    ...filas.map(f => [f.legajo, f.cuil, f.codigo, f.cantidad, f.importe, null, f.nombre]),
  ]
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  // E1 como texto (así viene en el molde nativo).
  if (ws['E1']) { ws['E1'].t = 's'; ws['E1'].v = String(empresaId); ws['E1'].z = '@' }
  for (let i = 0; i < filas.length; i++) {
    const r = i + 2
    const setText = (c: number, z?: string) => { const a = XLSX.utils.encode_cell({ r, c }); if (ws[a] && ws[a].v !== null && ws[a].v !== undefined && ws[a].v !== '') { ws[a].t = 's'; if (z) ws[a].z = z } }
    const setNum = (c: number) => { const a = XLSX.utils.encode_cell({ r, c }); if (ws[a] && typeof ws[a].v === 'number') { ws[a].t = 'n'; ws[a].z = '0.00' } }
    setText(1)          // CUIL
    setText(2, '@')     // Código (texto, ceros preservados)
    setNum(3); setNum(4) // Cantidad, Importe
  }
  ws['!cols'] = [{ wch: 20 }, { wch: 14 }, { wch: 16 }, { wch: 10 }, { wch: 12 }, { wch: 3 }, { wch: 34 }]
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Hoja1')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Hoja2')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([[]]), 'Hoja3')
  const out = XLSX.write(wb, { bookType: 'biff8', type: 'array' })
  return out instanceof Uint8Array ? out : new Uint8Array(out)
}
