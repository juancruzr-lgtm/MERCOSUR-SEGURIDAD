// lib/visual-generar.ts
//
// LIQ2G — Orquestador del archivo Visual completo. Parte del PADRÓN DE
// LIQUIDACIÓN (liquidacion_persona: personas liquidables con o sin usuario),
// arma las líneas por política del concepto (haberes valor + 000 días editable +
// estructurales 0/0 + calculados individuales + expedientes → slots 111/993),
// corre la validación pre-export y escribe el .xls nativo. No calcula fórmulas
// legales: Visual las calcula con "Recalc. Todos".

import {
  construirLineasVisual, escribirLibroVisualXls,
  type ConceptoCfg, type PersonaPadron, type HaberLinea, type PermanenteLinea, type ExpedienteLinea, type ResultadoLineas,
} from '@/lib/visual-export'
import { jornadasPorUsuarioDelMes } from '@/lib/excel-trabajo-liquidacion'

function limitesMes(mes: string): { desde: string; hasta: string } {
  const [y, m] = mes.split('-').map(Number)
  const ultimo = new Date(y, m, 0).getDate()
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, '0')}` }
}
const vigente = (desde: string | null, hasta: string | null, dDesde: string, dHasta: string) =>
  (!desde || String(desde) <= dHasta) && (!hasta || String(hasta) >= dDesde)

export interface GenerarVisualResultado { bytes: Uint8Array | null; resultado: ResultadoLineas | null; error: string | null }

export async function generarVisualCompleto(
  client: any,
  periodo: { id: string; mes: string },
): Promise<GenerarVisualResultado> {
  const { desde, hasta } = limitesMes(periodo.mes)
  const [personasR, consR, catR, permR, expR, diasR] = await Promise.all([
    client.from('liquidacion_persona').select('id, usuario_id, cuil, nombre, cod_interno, estado_liquidable, motivo').in('estado_liquidable', ['activo', 'excluido']),
    client.from('liquidacion_consolidada').select('empleado_id, codigo, cantidad, importe').eq('periodo_id', periodo.id),
    client.from('liquidacion_concepto_catalogo').select('codigo_visual, politica, entrada'),
    client.from('liquidacion_concepto_permanente').select('empleado_id, persona_id, importe, activo, vigencia_desde, vigencia_hasta, concepto:concepto_id(codigo_visual)').eq('activo', true),
    client.from('liquidacion_expediente').select('persona_id, referencia, importe, slot_preferido, estado, vigencia_desde, vigencia_hasta').eq('estado', 'activo'),
    client.from('liquidacion_dias').select('persona_id, dias, origen').eq('periodo_id', periodo.id),
  ])
  const err = personasR.error || consR.error || catR.error || permR.error || expR.error || diasR.error
  if (err) return { bytes: null, resultado: null, error: err.message || String(err) }

  const personas = (personasR.data ?? []) as any[]
  if (personas.length === 0) return { bytes: null, resultado: null, error: 'No hay personas liquidables (padrón vacío).' }

  // Persona por usuario_id (para linkear haberes del consolidado usuario-keyed).
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

  // Haberes del consolidado (usuario-keyed) → por persona.
  const haberes = new Map<string, HaberLinea[]>()
  for (const r of (consR.data ?? []) as any[]) {
    const persona = personaPorUsuario.get(r.empleado_id); if (!persona) continue
    const arr = haberes.get(persona.id) ?? []
    arr.push({ codigo: String(r.codigo), cantidad: r.cantidad == null ? null : Number(r.cantidad), importe: r.importe == null ? null : Number(r.importe) })
    haberes.set(persona.id, arr)
  }

  // Permanentes calculados (104/977/48410) vigentes → por persona.
  const permanentes = new Map<string, PermanenteLinea[]>()
  for (const p of (permR.data ?? []) as any[]) {
    if (!vigente(p.vigencia_desde, p.vigencia_hasta, desde, hasta)) continue
    const codigo = p.concepto?.codigo_visual; if (!codigo) continue
    const personaId = p.persona_id ?? personaPorUsuario.get(p.empleado_id)?.id; if (!personaId) continue
    const arr = permanentes.get(personaId) ?? []
    arr.push({ codigo: String(codigo), importe: p.importe == null ? null : Number(p.importe) })
    permanentes.set(personaId, arr)
  }

  // Expedientes de importe vigentes → por persona.
  const expedientes = new Map<string, ExpedienteLinea[]>()
  for (const e of (expR.data ?? []) as any[]) {
    if (!vigente(e.vigencia_desde, e.vigencia_hasta, desde, hasta)) continue
    const arr = expedientes.get(e.persona_id) ?? []
    arr.push({ referencia: e.referencia ?? null, importe: e.importe == null ? null : Number(e.importe), slot_preferido: (e.slot_preferido ?? null) as any })
    expedientes.set(e.persona_id, arr)
  }

  // 000 DÍAS por persona — NO depende de la grilla manual. Prioridad:
  //   1) override MANUAL de la grilla (decisión humana explícita en el panel);
  //   2) jornadas reales de la planilla del mes (con la corrección del Excel de
  //      trabajo ya superpuesta por jornadasPorUsuarioDelMes) — vía usuario_id;
  //   3) sin actividad / mensualizado / socio sin usuario -> null = PENDIENTE
  //      (no se inventa; bloquea esa persona hasta carga manual).
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
    dias.set(p.id, j > 0 ? j : null)   // 0/sin actividad -> pendiente
  }

  const resultado = construirLineasVisual({ padron, catalogo, haberes, dias, permanentes, expedientes, lineaCero })
  if (resultado.criticos.length > 0) return { bytes: null, resultado, error: `Hay ${resultado.criticos.length} error(es) crítico(s) estructural(es): corregilos antes de exportar.` }
  if (resultado.lineas.length === 0) return { bytes: null, resultado, error: 'No hay líneas exportables (revisá pendientes: 000, COD_INTERNO, expedientes).' }

  const bytes = await escribirLibroVisualXls(resultado.lineas)
  return { bytes, resultado, error: null }
}
