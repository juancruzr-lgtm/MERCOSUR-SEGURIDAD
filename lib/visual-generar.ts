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
  CODIGO_DIF_OS, BASICO_VIGILANCIA_133,
  type ConceptoCfg, type PersonaPadron, type HaberLinea, type PermanenteLinea, type ExpedienteLinea,
  type ResultadoLineas, type Hallazgo,
} from '@/lib/visual-export'
import { jornadasPorUsuarioDelMes, prepararLiquidacionDelMes, type FilaConsolidada } from '@/lib/excel-trabajo-liquidacion'

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
  jornadasInject?: Map<string, number>,
): Promise<{ resultado: ResultadoLineas | null; personas: number; error: string | null }> {
  const { desde, hasta } = limitesMes(periodo.mes)
  const [personasR, catR, permR, expR, diasR] = await Promise.all([
    client.from('liquidacion_persona').select('id, usuario_id, cuil, nombre, cod_interno, estado_liquidable, motivo').in('estado_liquidable', ['activo', 'excluido']),
    client.from('liquidacion_concepto_catalogo').select('codigo_visual, politica, entrada, categoria'),
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
    catalogo.set(String(c.codigo_visual), { politica: c.politica, entrada: c.entrada, categoria: c.categoria })
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
  // Preparación única: si el que exporta ya calculó las jornadas desde el mismo
  // resumen, se INYECTAN (no se relee operativo entre snapshot y Visual).
  const jornadasPorUsuario = jornadasInject
    ?? (await jornadasPorUsuarioDelMes(client, { id: periodo.id, mes: periodo.mes })).jornadas
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

  // Imponible por CUIL del resultado de Visual VIGENTE (si ya se importó): decide
  // el 133 (diferencia O.S.) — se omite cuando el imponible ≥ básico de vigilancia,
  // porque ahí Visual lo calcularía negativo (el imponible incluye la antigüedad
  // que MERCOSUR no computa). Sin resultado aún, el 133 sale como siempre.
  const imponiblePorCuil = new Map<string, number>()
  const { data: rv } = await client.from('liquidacion_resultado_visual')
    .select('id').eq('periodo_id', periodo.id).eq('vigente', true).limit(1)
  const resId = ((rv ?? []) as any[])[0]?.id
  if (resId) {
    const { data: filasRes } = await client.from('liquidacion_resultado_fila')
      .select('cuil, imponible').eq('resultado_id', resId)
    for (const f of (filasRes ?? []) as any[]) {
      const c = String(f.cuil ?? '').replace(/\D/g, '')
      if (c && f.imponible != null) imponiblePorCuil.set(c, Number(f.imponible))
    }
  }

  const resultado = construirLineasVisual({ padron, catalogo, haberes, dias, permanentes, expedientes, lineaCero, imponiblePorCuil })
  return { resultado, personas: personas.length, error: null }
}

export interface ExportarVisualResultado {
  bytes: Uint8Array | null
  resultado: ResultadoLineas | null
  consolidada: FilaConsolidada[]   // snapshot para congelar liquidacion_consolidada
  enviado: { cuil: string; cod_interno: string; codigo: string; cantidad: number | null; importe: number | null }[]
  bloqueado: boolean               // hay críticos/bloqueados: NO escribir DB
  error: string | null
}

/**
 * Prepara el archivo Visual desde UNA sola preparación (prepararLiquidacionDelMes)
 * y devuelve TODO lo necesario para exportar SIN tocar la DB:
 *   - bytes del .xls (generados EN MEMORIA: si esto falla, cero escrituras);
 *   - snapshot consolidado (los MISMOS datos que alimentan el .xls);
 *   - líneas 'enviado' para registrar.
 * La prevalidación autoritativa vive acá: si hay críticos o bloqueados (identidad
 * faltante, 000 requerido, expedientes/conceptos bloqueantes), marca `bloqueado`
 * y NO genera bytes → el llamador aborta sin escribir nada.
 * No se relee operativo entre el snapshot y el .xls: `jornadas` viene de la misma
 * preparación (se inyecta a cargarYConstruirVisual).
 */
export async function exportarVisualCompleto(
  client: any,
  periodo: { id: string; mes: string },
): Promise<ExportarVisualResultado> {
  const vacio = {
    bytes: null, resultado: null,
    consolidada: [] as FilaConsolidada[],
    enviado: [] as ExportarVisualResultado['enviado'],
    bloqueado: false,
  }
  const prep = await prepararLiquidacionDelMes(client, periodo)
  if (prep.error || !prep.plantilla) return { ...vacio, error: prep.error || 'sin preparación' }

  const haberRows: HaberRow[] = prep.snapshotFilas.map(f => ({
    empleado_id: f.empleado_id, codigo: String(f.codigo), cantidad: f.cantidad, importe: f.importe,
  }))
  const { resultado, error } = await cargarYConstruirVisual(client, periodo, haberRows, prep.jornadas)
  if (error || !resultado) return { ...vacio, error: error || 'sin resultado' }

  // Prevalidación autoritativa: críticos O bloqueados abortan la exportación.
  if (resultado.criticos.length > 0 || resultado.bloqueados.length > 0) {
    return { ...vacio, resultado, bloqueado: true, error: null }
  }
  if (resultado.lineas.length === 0) {
    return { ...vacio, resultado, error: 'No hay líneas exportables (revisá pendientes: 000, COD_INTERNO, expedientes).' }
  }

  // Bytes EN MEMORIA antes de cualquier escritura: si tira error, no se persiste nada.
  const bytes = await escribirLibroVisualXls(resultado.lineas)
  const enviado = resultado.lineas.map(l => ({
    cuil: String(l.cuil ?? ''), cod_interno: String(l.legajo ?? ''), codigo: String(l.codigo),
    cantidad: l.cantidad ?? null, importe: l.importe ?? null,
  }))
  return { bytes, resultado, consolidada: prep.snapshotFilas, enviado, bloqueado: false, error: null }
}

/**
 * Reconstruye el .xls Visual EXCLUSIVAMENTE desde `liquidacion_enviado_visual`
 * (lo registrado como enviado). NO relee turnos/planillas/novedades ni recalcula
 * 000: representa exactamente las líneas enviadas. La columna G (nombre, sólo
 * referencia, no liquidable) no se persiste en enviado_visual y queda vacía; los
 * campos obligatorios (COD_INTERNO, CUIL, código, cantidad, importe) son idénticos
 * a los enviados. Uso: re-descarga del archivo Visual en período ya exportado.
 */
export async function regenerarVisualDesdeEnviado(
  client: any,
  periodoId: string,
): Promise<{ bytes: Uint8Array | null; lineas: number; error: string | null }> {
  const r = await client.from('liquidacion_enviado_visual')
    .select('cod_interno, cuil, codigo, cantidad, importe').eq('periodo_id', periodoId)
  if (r.error) return { bytes: null, lineas: 0, error: r.error.message }
  // Imponible del resultado importado, para omitir el 133 donde ≥ básico (daría
  // negativo). El enviado se congeló con 133 para todos; acá se depura con el
  // imponible real de Visual (que ya conocemos tras importar el resultado).
  const imp = new Map<string, number>()
  const { data: rvE } = await client.from('liquidacion_resultado_visual')
    .select('id').eq('periodo_id', periodoId).eq('vigente', true).limit(1)
  const resIdE = ((rvE ?? []) as any[])[0]?.id
  if (resIdE) {
    const { data: fr } = await client.from('liquidacion_resultado_fila').select('cuil, imponible').eq('resultado_id', resIdE)
    for (const f of (fr ?? []) as any[]) { const c = String(f.cuil ?? '').replace(/\D/g, ''); if (c && f.imponible != null) imp.set(c, Number(f.imponible)) }
  }
  const filas = ((r.data ?? []) as any[])
    .filter(x => !(String(x.codigo) === CODIGO_DIF_OS && (imp.get(String(x.cuil ?? '').replace(/\D/g, '')) ?? 0) >= BASICO_VIGILANCIA_133))
    .map(x => ({
      legajo: String(x.cod_interno ?? ''), cuil: String(x.cuil ?? ''), codigo: String(x.codigo),
      cantidad: x.cantidad == null ? null : Number(x.cantidad),
      importe: x.importe == null ? null : Number(x.importe),
      nombre: '',
    }))
  if (filas.length === 0) return { bytes: null, lineas: 0, error: 'No hay líneas registradas como enviadas a Visual.' }
  const bytes = await escribirLibroVisualXls(filas)
  return { bytes, lineas: filas.length, error: null }
}

/**
 * Líneas Visual que se enviarían HOY (estado operativo actual), en forma
 * comparable (cuil/cod_interno/codigo/cantidad/importe). Usa la misma
 * preparación única. Sólo lectura; sirve para detectar cambios posteriores a la
 * exportación (comparar contra liquidacion_enviado_visual). Devuelve las líneas
 * aunque haya bloqueados: un bloqueo nuevo TAMBIÉN es un cambio posterior.
 */
export async function lineasVisualEnVivo(
  client: any,
  periodo: { id: string; mes: string },
): Promise<{ lineas: { cuil: string; cod_interno: string; codigo: string; cantidad: number | null; importe: number | null }[]; error: string | null }> {
  const prep = await prepararLiquidacionDelMes(client, periodo)
  if (prep.error || !prep.plantilla) return { lineas: [], error: prep.error || 'sin preparación' }
  const haberRows: HaberRow[] = prep.snapshotFilas.map(f => ({ empleado_id: f.empleado_id, codigo: String(f.codigo), cantidad: f.cantidad, importe: f.importe }))
  const { resultado, error } = await cargarYConstruirVisual(client, periodo, haberRows, prep.jornadas)
  if (error || !resultado) return { lineas: [], error: error || 'sin resultado' }
  const lineas = resultado.lineas.map(l => ({
    cuil: String(l.cuil ?? ''), cod_interno: String(l.legajo ?? ''), codigo: String(l.codigo),
    cantidad: l.cantidad ?? null, importe: l.importe ?? null,
  }))
  return { lineas, error: null }
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
 * Prevalida un período con la MISMA regla y la MISMA preparación única que después
 * usa la exportación (prepararLiquidacionDelMes → construirLineasVisual), sobre el
 * estado EN VIVO. Devuelve LISTO o el detalle de FALTANTES por causa/persona.
 * Es un PREVIEW: la exportación vuelve a correr esta validación de forma
 * autoritativa antes de escribir nada (no confía en que el usuario prevalidó).
 */
export async function prevalidarVisual(
  client: any,
  periodo: { id: string; mes: string },
): Promise<Prevalidacion> {
  const vacio: Prevalidacion = { listo: false, totalPersonas: 0, exportan: 0, criticos: [], identidadFaltante: [], diasRequerido: [], otros: [], advertencias: [], error: null }
  // Preparación única en vivo: haberes = snapshot que la exportación congelaría,
  // jornadas del mismo resumen (sin releer operativo).
  const prep = await prepararLiquidacionDelMes(client, periodo)
  if (prep.error) return { ...vacio, error: prep.error }
  const haberRows: HaberRow[] = prep.snapshotFilas.map(f => ({ empleado_id: f.empleado_id, codigo: String(f.codigo), cantidad: f.cantidad, importe: f.importe }))

  const { resultado, personas, error } = await cargarYConstruirVisual(client, periodo, haberRows, prep.jornadas)
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
