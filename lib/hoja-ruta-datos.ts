// Lectura de los datos de UNA guardia de supervisor para la hoja de ruta.
// Solo servidor (service role). Acotado al supervisor y a la ventana de su
// guardia. Nada de esto escribe.
//
// Fuentes de novedades escritas por el supervisor (revisadas 02/11/2026):
//   · supervisiones.observaciones          (observación general)
//   · supervision_respuestas.observacion   (observación de cada ítem)
// La tabla `novedades` la cargan los vigiladores (0 filas de supervisores) y
// los comentarios de intervenciones sobre alertas son parte de las alertas,
// que no van en la hoja de ruta.

import type { DatosHojaRuta, NovedadHR, PuntoHR, SupervisionHR } from './hoja-ruta'

export interface GuardiaSupervisorFila {
  id: string
  supervisor_id: string
  supervisor_original_id?: string | null
  fecha: string
  hora_inicio: string
  hora_fin: string
  zona: string | null
  estado: string
  tipo_evento: string | null
  rol_operativo: string | null
}

const hora8 = (h: string) => (h.length >= 8 ? h.slice(0, 8) : `${h.slice(0, 5)}:00`)

/** Inicio/fin ISO (hora argentina; si cruza medianoche termina al día siguiente). */
export function ventanaGuardia(g: Pick<GuardiaSupervisorFila, 'fecha' | 'hora_inicio' | 'hora_fin'>): { inicio: string; fin: string } {
  const ini = new Date(`${g.fecha}T${hora8(g.hora_inicio)}-03:00`)
  let fin = new Date(`${g.fecha}T${hora8(g.hora_fin)}-03:00`)
  if (fin.getTime() <= ini.getTime()) fin = new Date(fin.getTime() + 86_400_000)
  return { inicio: ini.toISOString(), fin: fin.toISOString() }
}

/** Guardia de servicio real: activa, de supervisión, no franco ni ausencia. */
export const guardiaCubre = (g: GuardiaSupervisorFila): boolean =>
  g.estado === 'activo' && (g.tipo_evento ?? 'normal') === 'normal' && (g.rol_operativo ?? 'supervisor') === 'supervisor'

const vacio = { data: [] as any[], error: null }

/**
 * Fin del turno anterior del mismo supervisor (el último que termina antes de
 * que empiece éste), en ISO, o null si no hay ninguno en los 31 días previos.
 * Se usa como piso para las supervisiones "fuera de horario".
 */
export async function finTurnoPrevio(db: any, g: GuardiaSupervisorFila, inicio: string): Promise<string | null> {
  const desdeFecha = new Date(new Date(`${g.fecha}T12:00:00Z`).getTime() - 31 * 86_400_000).toISOString().slice(0, 10)
  const r = await db.from('supervisores_guardia')
    .select('id, supervisor_id, fecha, hora_inicio, hora_fin, estado, tipo_evento, rol_operativo')
    .eq('supervisor_id', g.supervisor_id).gte('fecha', desdeFecha).lte('fecha', g.fecha)
  if (r.error) throw new Error(`turno previo: ${r.error.message}`)
  let previo: string | null = null
  for (const p of (r.data ?? []) as GuardiaSupervisorFila[]) {
    if (p.id === g.id || !guardiaCubre(p)) continue
    const f = ventanaGuardia(p).fin
    if (f <= inicio && (!previo || f > previo)) previo = f
  }
  return previo
}

export async function cargarDatosHojaRuta(db: any, g: GuardiaSupervisorFila): Promise<DatosHojaRuta> {
  const { inicio, fin } = ventanaGuardia(g)
  const chk = (r: { error: { message: string } | null }, que: string) => { if (r.error) throw new Error(`${que}: ${r.error.message}`) }

  // Fuera de horario: lo cargado desde el fin de su turno previo (JC 02/11/2026).
  const desde = await finTurnoPrevio(db, g, inicio)

  const personas = [g.supervisor_id, g.supervisor_original_id].filter(Boolean) as string[]
  const [usrRes, supsRes, puntosRes] = await Promise.all([
    db.from('usuarios').select('id, apellido, nombre').in('id', personas),
    // El fin previo es exclusivo (+1 ms): lo cargado justo en ese instante ya salió en aquella hoja.
    db.from('supervisiones').select('id, created_at, objetivo_id, observaciones')
      .eq('supervisor_id', g.supervisor_id).gte('created_at', desde ? new Date(new Date(desde).getTime() + 1).toISOString() : inicio).lte('created_at', fin).order('created_at'),
    db.rpc('hoja_ruta_puntos_guardia', { p_guardia_id: g.id }),
  ])
  chk(usrRes, 'usuarios'); chk(supsRes, 'supervisiones'); chk(puntosRes, 'gps')
  const nombrePersona = (id?: string | null) => {
    const u = (usrRes.data ?? []).find((x: any) => x.id === id)
    return u ? [u.nombre, u.apellido].filter(Boolean).join(' ') : null
  }

  const supIds: string[] = (supsRes.data ?? []).map((s: any) => s.id)
  const respRes = supIds.length
    ? await db.from('supervision_respuestas').select('id, supervision_id, item_id, observacion, created_at').in('supervision_id', supIds)
    : vacio
  chk(respRes, 'respuestas')
  const itemIds = Array.from(new Set((respRes.data ?? []).map((r: any) => r.item_id).filter(Boolean))) as string[]

  // GPS fuera de la ventana (p. ej. la app siguió enviando) no cuenta.
  const puntosFiltrados = (puntosRes.data ?? []).filter((p: any) => p.ts >= inicio && p.ts <= fin)
  const objetivoIds = Array.from(new Set([
    ...(supsRes.data ?? []).map((s: any) => s.objetivo_id),
    ...puntosFiltrados.map((p: any) => p.objetivo_cercano_id),
  ].filter(Boolean))) as string[]

  const [itemsRes, objRes] = await Promise.all([
    itemIds.length ? db.from('checklist_items').select('id, texto').in('id', itemIds) : Promise.resolve(vacio),
    objetivoIds.length ? db.from('objetivos').select('id, nombre, radio_metros').in('id', objetivoIds) : Promise.resolve(vacio),
  ])
  chk(itemsRes, 'checklist'); chk(objRes, 'objetivos')
  const itemTexto = new Map<string, string>((itemsRes.data ?? []).map((i: any) => [i.id, i.texto]))
  const objetivos = (objRes.data ?? []).map((o: any) => ({ id: o.id, nombre: o.nombre, radio_metros: o.radio_metros }))
  const nombre = new Map<string, string>(objetivos.map((o: any) => [o.id, o.nombre]))

  const supervisiones: SupervisionHR[] = (supsRes.data ?? []).map((s: any) => ({
    id: s.id, created_at: s.created_at, objetivo_id: s.objetivo_id, objetivo: nombre.get(s.objetivo_id) ?? null,
  }))

  // Novedades textuales. Clave = supervisión + texto: el mismo texto cargado en
  // la observación general y en un ítem aparece una sola vez.
  const novedades: NovedadHR[] = []
  const respPorSup = new Map<string, any[]>()
  for (const r of respRes.data ?? []) respPorSup.set(r.supervision_id, [...(respPorSup.get(r.supervision_id) ?? []), r])
  for (const s of supsRes.data ?? []) {
    const obj = nombre.get(s.objetivo_id) ?? null
    if ((s.observaciones ?? '').trim()) {
      novedades.push({ clave: `${s.id}:${s.observaciones.trim()}`, created_at: s.created_at, objetivo_id: s.objetivo_id,
        objetivo: obj, origen: 'Supervisión', texto: s.observaciones })
    }
    for (const r of (respPorSup.get(s.id) ?? []).sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)))) {
      if (!(r.observacion ?? '').trim()) continue
      novedades.push({ clave: `${s.id}:${r.observacion.trim()}`, created_at: r.created_at ?? s.created_at, objetivo_id: s.objetivo_id,
        objetivo: obj, origen: itemTexto.get(r.item_id) ?? 'Ítem del checklist', texto: r.observacion })
    }
  }

  const puntos: PuntoHR[] = puntosFiltrados.map((p: any) => ({
    ts: p.ts, precision_m: p.precision_m, objetivo_cercano_id: p.objetivo_cercano_id, objetivo_distancia_m: p.objetivo_distancia_m,
  }))

  const reemplaza = g.supervisor_original_id && g.supervisor_original_id !== g.supervisor_id ? nombrePersona(g.supervisor_original_id) : null
  return {
    guardia: { id: g.id, supervisor_id: g.supervisor_id, supervisor: nombrePersona(g.supervisor_id) ?? 'Supervisor', fecha: g.fecha,
      inicio, fin, zona: g.zona, reemplaza_a: reemplaza },
    supervisiones, novedades, puntos, objetivos,
  }
}
