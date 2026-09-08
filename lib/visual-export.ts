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

export interface ConceptoCfg { politica: Politica; entrada: Entrada; nombre?: string }
export interface EmpleadoPadron {
  empleado_id: string
  cod_interno: string | null
  cuil: string | null
  nombre: string
  esPrueba?: boolean
  mensualizado?: boolean
}
export interface HaberLinea { codigo: string; cantidad: number | null; importe: number | null }
export interface PermanenteLinea { codigo: string; importe: number | null }

export interface Hallazgo { empleado_id: string | null; cuil: string | null; codigo?: string; tipo: string; detalle: string }
export type EstadoPadron = 'exporta' | 'no_corresponde' | 'falta_info'
export interface PadronEstado { empleado_id: string; cuil: string | null; nombre: string; estado: EstadoPadron; filas: number; motivo?: string }

export interface ResultadoLineas {
  lineas: FilaVisual[]
  criticos: Hallazgo[]        // estructurales/config: bloquean TODO el export
  bloqueados: Hallazgo[]      // identidad por empleado: se excluye ese empleado, NO el archivo
  advertencias: Hallazgo[]    // visibles, no bloquean
  padron: PadronEstado[]
}

const soloDigitos = (s?: string | null) => String(s ?? '').replace(/\D/g, '')

/**
 * Construye las líneas del archivo Visual a partir del padrón del período y de
 * las fuentes ya resueltas. PURO. Aplica la política por concepto y corre la
 * validación pre-export (críticos bloquean; advertencias quedan visibles).
 * NO calcula fórmulas legales: los conceptos 'linea_cero'/'individual' calculados
 * salen en 0/0 para que Visual los calcule.
 */
export function construirLineasVisual(p: {
  padron: EmpleadoPadron[]
  catalogo: Map<string, ConceptoCfg>
  haberes: Map<string, HaberLinea[]>
  permanentes: Map<string, PermanenteLinea[]>
  lineaCero: string[]
}): ResultadoLineas {
  const lineas: FilaVisual[] = []
  const criticos: Hallazgo[] = []
  const bloqueados: Hallazgo[] = []
  const advertencias: Hallazgo[] = []
  const padron: PadronEstado[] = []

  for (const e of p.padron) {
    const cuil = soloDigitos(e.cuil)
    const base = { empleado_id: e.empleado_id, cuil: cuil || null }
    // Cuentas de prueba: no corresponde exportar (no van a Visual). No es exclusión silenciosa.
    if (e.esPrueba) { padron.push({ ...base, nombre: e.nombre, estado: 'no_corresponde', filas: 0, motivo: 'cuenta de prueba' } as any); continue }

    // Bloqueo POR EMPLEADO (identidad): se excluye ese empleado y se reporta, pero
    // NO frena todo el archivo (típico: empleado de MERCOSUR que no está en Visual).
    const errsEmp: string[] = []
    if (!e.cod_interno || !String(e.cod_interno).trim()) { bloqueados.push({ ...base, tipo: 'falta_cod_interno', detalle: `${e.nombre}: sin COD_INTERNO (no está en Visual; no se exporta)` }); errsEmp.push('falta COD_INTERNO') }
    if (cuil.length !== 11) { bloqueados.push({ ...base, tipo: 'cuil_invalido', detalle: `${e.nombre}: CUIL inválido "${e.cuil}"` }); errsEmp.push('CUIL inválido') }

    const filasEmp: FilaVisual[] = []
    const emitir = (codigo: string, cantidad: number | null, importe: number | null) => {
      filasEmp.push({ legajo: String(e.cod_interno ?? '').trim(), cuil, codigo: String(codigo), cantidad, importe, nombre: e.nombre })
    }

    // 1) Haberes (política 'valor') + 000 días.
    for (const h of p.haberes.get(e.empleado_id) ?? []) {
      const cfg = p.catalogo.get(h.codigo)
      if (!cfg) { criticos.push({ ...base, codigo: h.codigo, tipo: 'concepto_sin_config', detalle: `código ${h.codigo} sin configuración en el catálogo Visual` }); continue }
      if (cfg.politica !== 'valor') { advertencias.push({ ...base, codigo: h.codigo, tipo: 'haber_politica_incorrecta', detalle: `código ${h.codigo} no es política 'valor' (${cfg.politica}); se omite` }); continue }
      // Contrato CAN/IMP/CANIMP. Práctica confirmada: Cantidad=1 + Importe=total,
      // salvo 000 (CAN) que lleva la cantidad real de días y sin importe.
      if (cfg.entrada === 'CAN') {
        if (h.cantidad === null || h.cantidad === undefined) { criticos.push({ ...base, codigo: h.codigo, tipo: 'cantidad_faltante', detalle: `${e.nombre}: ${h.codigo} (CAN) sin cantidad` }); continue }
        emitir(h.codigo, h.cantidad, null)
      } else if (cfg.entrada === 'IMP') {
        emitir(h.codigo, 1, h.importe ?? 0)
      } else { // CANIMP
        emitir(h.codigo, h.cantidad ?? 1, h.importe ?? 0)
      }
    }

    // Ambigüedad declarada (JC): el 000 de un mensualizado no sale de turnos reales
    // sino de la convención de 25 de la plantilla. Se reporta, no se inventa otra regla.
    if (e.mensualizado && (p.haberes.get(e.empleado_id) ?? []).some(h => h.codigo === '000')) {
      advertencias.push({ ...base, codigo: '000', tipo: 'dias_mensualizado_convencion', detalle: `${e.nombre}: 000 días de mensualizado por convención (no días reales de turnos) — confirmar fuente` })
    }

    // 2) Líneas 0/0 estructurales para TODOS (Visual calcula).
    for (const codigo of p.lineaCero) {
      const cfg = p.catalogo.get(codigo)
      if (!cfg) { advertencias.push({ ...base, codigo, tipo: 'linea_cero_sin_config', detalle: `estructural ${codigo} sin config; se omite` }); continue }
      emitir(codigo, 0, 0)
    }

    // 3) Individuales vigentes (permanentes): calculados 0/0; IMP con importe real.
    for (const perm of p.permanentes.get(e.empleado_id) ?? []) {
      const cfg = p.catalogo.get(perm.codigo)
      if (!cfg) { criticos.push({ ...base, codigo: perm.codigo, tipo: 'concepto_sin_config', detalle: `individual ${perm.codigo} sin config` }); continue }
      if (cfg.entrada === 'IMP') {
        if (perm.importe === null || perm.importe === undefined) { advertencias.push({ ...base, codigo: perm.codigo, tipo: 'individual_imp_sin_importe', detalle: `${e.nombre}: ${perm.codigo} (IMP individual) sin importe; Visual mantiene el del mes anterior` }); emitir(perm.codigo, 1, 0) }
        else emitir(perm.codigo, 1, perm.importe)
      } else { // CALCULADO (104/977/48410): línea 0/0
        emitir(perm.codigo, 0, 0)
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
    padron.push({ empleado_id: e.empleado_id, cuil: cuil || null, nombre: e.nombre, estado, filas: filasEmp.length, motivo: errsEmp.join(' · ') || (filasEmp.length === 0 ? 'sin conceptos' : undefined) })
    // Sólo se agregan al archivo si el empleado no tiene bloqueos de identidad.
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
