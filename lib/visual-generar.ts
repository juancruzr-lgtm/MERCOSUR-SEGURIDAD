// lib/visual-generar.ts
//
// LIQ2G — Orquestador del archivo Visual completo. Parte del PADRÓN DE
// LIQUIDACIÓN (liquidacion_persona: personas liquidables con o sin usuario),
// arma las líneas por política del concepto (haberes valor + 000 días editable +
// estructurales 0/0 + calculados individuales + expedientes → slots 111/993),
// corre la validación pre-export y escribe el .xls nativo. No calcula fórmulas
// legales: Visual las calcula con "Recalc. Todos".
//
// LIQ · PREVALIDACIÓN (ETAPA 1): la MISMA regla (construirLineasVisual) se corre
// ANTES de Consolidar, sobre el snapshot en vivo, para decir LISTO / FALTAN DATOS
// sin lógica divergente. Consolidar sólo se habilita si la prevalidación está OK.

import {
  construirLineasVisual, escribirLibroVisualXls, clasificarBloqueados,
  type ConceptoCfg, type PersonaPadron, type HaberLinea, type PermanenteLinea, type ExpedienteLinea,
  type ResultadoLineas, type Hallazgo,
} from '@/lib/visual-export'
import { jornadasPorUsuarioDelMes, snapshotConsolidadoDelMes } from '@/lib/excel-trabajo-liquidacion'

function limitesMes(mes: string): { desde: string; hasta: string } {
  const [y, m] = mes.split('-').map(Number)
  const ultimo = new Date(y, m, 0).getDate()
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, '0')}` }
}
const vigente = (desde: string | null, hasta: string | null, dDesde: string, dHasta: string) =>
  (!desde || String(desde) <= dHasta) && (!hasta || String(hasta) >= dDesde)

/** Fila de haber (código/cantidad/importe) keyed por usuario (empleado_id). */
export interface HaberRow { empleado_id: string; codigo: string; cantidad: number | null; importe: number | null }

export interface GenerarVisualResultado { bytes: Uint8Array | null; resultado: ResultadoLineas | null; error: string | null }

/**
 * Carga los insumos del padrón (personas, catálogo, permanentes, expedientes,
 * 000 días) y corre `construirLineasVisual` con los HABERES provistos. Es la
 * fuente ÚNICA de la regla: la usan tanto la generación del .xls como la
 * prevalidación (con haberes del snapshot en vivo). Sin lógica duplicada.
 */
async function cargarYConstruirVisual(
  client: any,
  periodo: { id: string; mes: string },
  haberRows: HaberRow[],
): Promise<{ resultado: ResultadoLineas | null; personas: number; error: string | null }> {
  const { desde, hasta } = limitesMes(periodo.mes)
  const [personasR, catR, permR, expR, diasR] = await Promise.all([
    client.from('liquidacion_persona').select('id, usuario_id, cuil, nombre, cod_interno, estado_liquidable, motivo').in('estado_liquidable', ['activo', 'excluido']),
    client.from('liquidacion_concepto_catalogo').select('codigo_visual, politica, entrada'),
    client.from('liquidacion_concepto_permanente').select('empleado_id, persona_id, importe, activo, vigencia_desde, vigencia_hasta, concepto:concepto_id(codigo_visual)').eq('activo', true),
    client.from('liquidacion_expediente').select('persona_id, referencia, importe, slot_preferido, estado, vigencia_desde, vigencia_hasta').eq('estado', 'activo'),
    client.from('liquidacion_dias').select('persona_id, dias, origen').eq('periodo_id', periodo.id),
  ])
  const err = personasR.error || catR.error || permR.error || expR.error || diasR.error
  if (err) return { resultado: null, personas: 0, error: err.message || String(err) }

  const personas = (personasR.data ?? []) as any[]
  if (personas.length === 0) return { resultado: null, personas: 0, error: 'No hay personas liquidables (padrón vacío).' }

  const personaPorUsuario = new Map<string, any>()
  for (const p of personas) if (p.usuario_id) personaPorUsuario.set(p.usuario_id, p)

  const padron: PersonaPadron[] = personas.map(p => ({
    persona_id: p.id, cod_interno: p.cod_interno ?? null, cuil: p.cuil ?? null,
    nombre: p.nombre ?? '', esPrueba: false, tieneUsuario: Boolean(p.usuario_id),
    excluido: p.estado_liquidable === 'excluido', motivoExcluido: p.motivo ?? null,
  }))

  const catalogo = new Map<string, ConceptoCfg>(); const lineaCero: string[] = []
  for (const c of (catR.data ?? []) as any[]) {
    if (!c.codigo_visual) continue
    catalogo.set(String(c.codigo_visual), { politica: c.politica, entrada: c.entrada })
    if (c.politica === 'linea_cero') lineaCero.push(String(c.codigo_visual))
  }

  // Haberes (usuario-keyed) → por persona.
  const haberes = new Map<string, HaberLinea[]>()
  for (const r of haberRows) {
    const persona = personaPorUsuario.get(r.empleado_id); if (!persona) continue
    const arr = haberes.get(persona.id) ?? []
    arr.push({ codigo: String(r.codigo), cantidad: r.cantidad == null ? null : Number(r.cantidad), importe: r.importe == null ? null : Number(r.importe) })
    haberes.set(persona.id, arr)
  }

  const permanentes = new Map<string, PermanenteLinea[]>()
  for (const p of (permR.data ?? []) as any[]) {
    if (!vigente(p.vigencia_desde, p.vigencia_hasta, desde, hasta)) continue
    const codigo = p.concepto?.codigo_visual; if (!codigo) continue
    const personaId = p.persona_id ?? personaPorUsuario.get(p.empleado_id)?.id; if (!personaId) continue
    const arr = permanentes.get(personaId) ?? []
    arr.push({ codigo: String(codigo), importe: p.importe == null ? null : Number(p.importe) })
    permanentes.set(personaId, arr)
  }

  const expedientes = new Map<string, ExpedienteLinea[]>()
  for (const e of (expR.data ?? []) as any[]) {
    if (!vigente(e.vigencia_desde, e.vigencia_hasta, desde, hasta)) continue
    const arr = expedientes.get(e.persona_id) ?? []
    arr.push({ referencia: e.referencia ?? null, importe: e.importe == null ? null : Number(e.importe), slot_preferido: (e.slot_preferido ?? null) as any })
    expedientes.set(e.persona_id, arr)
  }

  // 000 DÍAS por persona. Prioridad: override MANUAL > jornadas reales de la
  // planilla (operativos) > null = PENDIENTE (no se inventa).
  const jornadasR = await jornadasPorUsuarioDelMes(client, { id: periodo.id, mes: periodo.mes })
  const jornadasPorUsuario = jornadasR.jornadas
  const manual = new Map<string, number | null>()
  for (const d of (diasR.data ?? []) as any[]) {
    if (d.origen === 'manual' && d.dias != null) manual.set(d.persona_id, Number(d.dias))
  }
  const dias = new Map<string, number | null>()
  for (const p of personas) {
    if (manual.has(p.id)) { dias.set(p.id, manual.get(p.id)!); continue }
    const j = p.usuario_id ? (jornadasPorUsuario.get(p.usuario_id) ?? 0) : 0
    dias.set(p.id, j > 0 ? j : null)
  }

  const resultado = construirLineasVisual({ padron, catalogo, haberes, dias, permanentes, expedientes, lineaCero })
  return { resultado, personas: personas.length, error: null }
}

export async function generarVisualCompleto(
  client: any,
  periodo: { id: string; mes: string },
): Promise<GenerarVisualResultado> {
  // Haberes = consolidada CONGELADA (lo que se exporta a Visual).
  const consR = await client.from('liquidacion_consolidada').select('empleado_id, codigo, cantidad, importe').eq('periodo_id', periodo.id)
  if (consR.error) return { bytes: null, resultado: null, error: consR.error.message }
  const haberRows: HaberRow[] = ((consR.data ?? []) as any[]).map(r => ({ empleado_id: r.empleado_id, codigo: String(r.codigo), cantidad: r.cantidad, importe: r.importe }))

  const { resultado, error } = await cargarYConstruirVisual(client, periodo, haberRows)
  if (error || !resultado) return { bytes: null, resultado: null, error: error || 'sin resultado' }
  if (resultado.criticos.length > 0) return { bytes: null, resultado, error: `Hay ${resultado.criticos.length} error(es) crítico(s) estructural(es): corregilos antes de exportar.` }
  if (resultado.lineas.length === 0) return { bytes: null, resultado, error: 'No hay líneas exportables (revisá pendientes: 000, COD_INTERNO, expedientes).' }

  const bytes = await escribirLibroVisualXls(resultado.lineas)
  return { bytes, resultado, error: null }
}

// ── PREVALIDACIÓN (ETAPA 1) ──────────────────────────────────────────────────
export interface Prevalidacion {
  listo: boolean                 // sin críticos y sin bloqueados por persona
  totalPersonas: number
  exportan: number               // personas que exportarían OK
  criticos: Hallazgo[]           // estructurales: impiden generar el archivo
  identidadFaltante: Hallazgo[]  // CUIL / COD_INTERNO faltante (no está en Visual)
  diasRequerido: Hallazgo[]      // 000 pendiente (cargar; manual si es mensualizado)
  otros: Hallazgo[]              // p.ej. >2 expedientes
  advertencias: Hallazgo[]
  error: string | null
}

/**
 * Prevalida un período ANTES de Consolidar, con la MISMA regla que después
 * bloquea la generación Visual (construirLineasVisual), usando el snapshot EN
 * VIVO como haberes. Devuelve LISTO o el detalle de FALTANTES por causa/persona.
 */
export async function prevalidarVisual(
  client: any,
  periodo: { id: string; mes: string },
): Promise<Prevalidacion> {
  const vacio: Prevalidacion = { listo: false, totalPersonas: 0, exportan: 0, criticos: [], identidadFaltante: [], diasRequerido: [], otros: [], advertencias: [], error: null }
  // Haberes = snapshot en vivo (lo que Consolidar congelaría ahora).
  const snap = await snapshotConsolidadoDelMes(client, periodo.id, periodo.mes)
  if (snap.error) return { ...vacio, error: snap.error }
  const haberRows: HaberRow[] = (snap.filas ?? []).map(f => ({ empleado_id: f.empleado_id, codigo: String(f.codigo), cantidad: f.cantidad, importe: f.importe }))

  const { resultado, personas, error } = await cargarYConstruirVisual(client, periodo, haberRows)
  if (error || !resultado) return { ...vacio, error: error || 'sin resultado' }

  const b = clasificarBloqueados(resultado.bloqueados)
  const exportan = resultado.padron.filter(x => x.estado === 'exporta').length
  const listo = resultado.criticos.length === 0 && resultado.bloqueados.length === 0
  return {
    listo, totalPersonas: personas, exportan,
    criticos: resultado.criticos,
    identidadFaltante: b.identidadFaltante,
    diasRequerido: b.diasRequerido,
    otros: b.otros,
    advertencias: resultado.advertencias,
    error: null,
  }
}
