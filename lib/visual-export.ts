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

// AJUSTE al básico (050) y DIFERENCIA de O.S. (133): sólo corresponden cuando el
// remunerativo está POR DEBAJO del básico de vigilancia (911650): el 050 ajusta la
// base hasta el básico y el 133 ajusta la O.S. a ese básico. Si el IMPONIBLE de la
// persona ≥ básico, NINGUNO de los dos corresponde (el 050 declararía una base
// 911650 menor que la real y el 133 daría negativo) → NO se mandan (regla JC 11/09).
// El imponible incluye la ANTIGÜEDAD (011) que calcula Visual (MERCOSUR no), por eso
// la decisión usa el IMPONIBLE del resultado importado.
export const BASICO_VIGILANCIA_133 = 911650
export const CODIGOS_SOBRE_BASICO = new Set(['050', '133'])
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
  imponiblePorCuil?: Map<string, number>      // imponible de Visual por CUIL (para el 133)
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
    // 000 DÍAS pendiente: sin valor no se puede exportar el recibo de la persona.
    const dias = p.dias.get(e.persona_id)
    if (dias === null || dias === undefined) { bloqueados.push({ ...base, codigo: '000', tipo: 'dias_pendiente', detalle: `${e.nombre}: 000 DÍAS TRABAJADOS pendiente (cargar el valor del período)` }); errsEmp.push('000 pendiente') }

    const filasEmp: FilaVisual[] = []
    const emitir = (codigo: string, cantidad: number | null, importe: number | null) => {
      filasEmp.push({ legajo: String(e.cod_interno ?? '').trim(), cuil, codigo: String(codigo), cantidad, importe, nombre: e.nombre })
    }

    // 1) Haberes (política 'valor').
    for (const h of p.haberes.get(e.persona_id) ?? []) {
      const cfg = p.catalogo.get(h.codigo)
      if (!cfg) { criticos.push({ ...base, codigo: h.codigo, tipo: 'concepto_sin_config', detalle: `código ${h.codigo} sin configuración en el catálogo Visual` }); continue }
      if (cfg.politica !== 'valor') { advertencias.push({ ...base, codigo: h.codigo, tipo: 'haber_politica_incorrecta', detalle: `código ${h.codigo} no es política 'valor' (${cfg.politica}); se omite` }); continue }
      if (cfg.entrada === 'CAN') { if (h.cantidad == null) continue; emitir(h.codigo, h.cantidad, null) }
      else if (cfg.entrada === 'IMP') emitir(h.codigo, 1, h.importe ?? 0)
      else emitir(h.codigo, h.cantidad ?? 1, h.importe ?? 0)
    }

    // 2) 000 DÍAS (CAN): dato editable de la persona.
    if (dias != null) emitir('000', dias, null)

    // 050 (ajuste) y 133 (dif. O.S.): se omiten si el imponible que devolvió Visual
    // ≥ básico (no corresponden; el 050 declararía una base menor a la real y el 133
    // daría negativo). El imponible incluye la antigüedad que MERCOSUR no calcula,
    // por eso se toma del resultado importado (imponiblePorCuil). Sin resultado aún
    // (1er export) se mandan como siempre y se corrige al regenerar tras importar.
    const impon = p.imponiblePorCuil?.get(cuil)
    const sobreBasico = impon != null && impon >= BASICO_VIGILANCIA_133

    // 3) Líneas 0/0 estructurales para TODOS (Visual calcula). EXCEPCIÓN: 050 y 133.
    for (const codigo of p.lineaCero) {
      if (sobreBasico && CODIGOS_SOBRE_BASICO.has(codigo)) continue
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
