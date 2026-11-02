// Hoja de ruta del supervisor de guardia: lista de prioridades por riesgo.
//
// ── Qué es y qué NO ─────────────────────────────────────────────────────────
// Función PURA que ordena lo que ya existe (puestos descubiertos, alertas
// abiertas, supervisiones exigibles por vencer, relevos con hueco) para el
// supervisor que está de guardia AHORA, dentro de sus zonas. No crea tareas
// obligatorias, no escribe nada, no decide si un puesto está descubierto (eso
// es lib/turnos y las alertas) ni si una supervisión es exigible (eso es
// lib/supervisiones.exigibilidadSupervision). Nunca toca fichajes, horas ni
// planillas.
//
// ── Quién es responsable ────────────────────────────────────────────────────
// La misma resolución que usan push y WhatsApp (lib/responsables-operativos):
// guardia efectiva en el instante; sin guardia, responsable único de zona. En
// el cambio de guardia la hoja pasa entera al entrante: el saliente ve su hoja
// vacía con motivo `sin_guardia_vigente`.
//
// ── Zonas ───────────────────────────────────────────────────────────────────
// Un objetivo entra sólo si el supervisor es responsable de su zona en este
// instante Y la zona está en su alcance (supervisor_zonas), salvo alcance
// 'todas'. Lo que queda afuera se cuenta en `fueraDeZona` y no se muestra.
// Esto es la vista: las mutaciones siguen validando alcance en el servidor
// (save-supervision → alcanza_objetivo, turnos/editar, rondas/evidencia,
// resolver_ronda_alerta → puede_administrar_rondas_objetivo).

import {
  exigibilidadSupervision, frecuenciaSupervision, horasParaVencimiento, estadoSupervision,
  supervisionProximaAVencer,
} from '@/lib/supervisiones'
import type { ContextoExigibilidad, ObjetivoServicio } from '@/lib/supervisiones'
import { resolverResponsablesOperativos, instanteLocal } from '@/lib/responsables-operativos'
import type { AsignacionZona, GuardiaOperativa, UsuarioBasico } from '@/lib/responsables-operativos'
import type { AlcanceOperativo } from '@/lib/capacidades'

export type TipoPrioridad = 'servicio_sin_cobertura' | 'alerta_critica' | 'relevo_pendiente' | 'supervision_exigible'

export interface ObjetivoRuta extends ObjetivoServicio {
  zona_id?: string | null
}

export interface PuestoDescubierto {
  turno_id: string
  objetivo_id: string
  puesto?: string | null
  /** Minutos desde el inicio del turno sin fichaje (lo decide lib/turnos). */
  minutosDescubierto: number
}

export interface AlertaAbierta {
  id: string
  objetivo_id: string
  tipo: string
  severidad: 'critica' | 'alta' | 'media'
  detectada_at: string
  /** Ya intervenida por un supervisor (cualquier acción o resultado). */
  intervenida?: boolean
  /** Seguimiento vigente hasta (ISO). Vencido = vuelve a pedir atención. */
  seguimiento_hasta?: string | null
}

export interface RelevoPendiente {
  objetivo_id: string
  turno_id: string
  /** Hora (ISO) en que debería entrar el relevo. */
  relevo_at: string
  clase: 'hueco' | 'sin_relevo' | 'solapamiento'
  minutos?: number
}

export interface EntradaHojaDeRuta {
  supervisorId: string
  alcance: AlcanceOperativo
  ahora: Date
  objetivos: ObjetivoRuta[]
  zonas: Array<{ id: string; nombre: string }>
  guardias: GuardiaOperativa[]
  supervisorZonas: AsignacionZona[]
  usuarios?: UsuarioBasico[]
  puestosDescubiertos?: PuestoDescubierto[]
  alertas?: AlertaAbierta[]
  relevos?: RelevoPendiente[]
  /** objetivo_id → ISO de la última supervisión válida (no incompleta). */
  ultimaSupervision?: Map<string, string>
  contextoExigibilidad?: ContextoExigibilidad
  /** Horizonte para relevos (min). Por defecto 90. */
  horizonteRelevoMin?: number
}

export interface ItemHojaDeRuta {
  tipo: TipoPrioridad
  objetivo_id: string
  objetivo: string
  puntaje: number
  motivo: string
  /** Referencia al hecho de origen (turno, alerta). */
  ref?: string
  /** Vencimiento o momento crítico (ISO), si aplica. */
  limite?: string | null
}

export interface ParadaHojaDeRuta {
  objetivo_id: string
  objetivo: string
  puntaje: number
  items: ItemHojaDeRuta[]
}

export interface HojaDeRuta {
  supervisorId: string
  responsableAhora: boolean
  motivo: 'ok' | 'sin_guardia_vigente'
  zonasResponsable: string[]
  items: ItemHojaDeRuta[]
  paradas: ParadaHojaDeRuta[]
  fueraDeZona: number
}

const MIN = 60000

/** Pesos: un puesto sin nadie pesa más que cualquier trámite. */
export const PESO: Record<TipoPrioridad, number> = {
  servicio_sin_cobertura: 100,
  alerta_critica: 70,
  relevo_pendiente: 60,
  supervision_exigible: 30,
}

/**
 * Zonas de las que `supervisorId` es responsable en este instante, con la
 * misma resolución que push/WhatsApp.
 */
export function zonasResponsableAhora(
  e: Pick<EntradaHojaDeRuta, 'supervisorId' | 'ahora' | 'zonas' | 'guardias' | 'supervisorZonas' | 'usuarios'>,
): string[] {
  const { fecha, hora } = instanteLocal(e.ahora)
  return e.zonas
    .filter(z => resolverResponsablesOperativos({
      zonaId: z.id, fecha, hora, guardias: e.guardias, supervisorZonas: e.supervisorZonas,
      zonas: e.zonas, usuarios: e.usuarios,
    }).responsables.includes(e.supervisorId))
    .map(z => z.id)
}

/**
 * ¿Puede este supervisor operar sobre el objetivo? Espejo de alcanza_objetivo
 * para la vista: 'todas' sí; 'zonas_asignadas' sólo con la zona asignada;
 * 'propio' nunca. NO reemplaza la validación del servidor.
 */
export function puedeOperarObjetivo(
  supervisorId: string,
  alcance: AlcanceOperativo,
  objetivo: { zona_id?: string | null } | null | undefined,
  supervisorZonas: AsignacionZona[],
): boolean {
  if (!objetivo) return false
  if (alcance === 'todas') return true
  if (alcance !== 'zonas_asignadas' || !objetivo.zona_id) return false
  return supervisorZonas.some(a => a.supervisor_id === supervisorId && a.zona_id === objetivo.zona_id)
}

function alertaPideAtencion(a: AlertaAbierta, ahoraMs: number): boolean {
  if (a.seguimiento_hasta) {
    const t = Date.parse(a.seguimiento_hasta)
    if (Number.isFinite(t)) return t <= ahoraMs // seguimiento vencido
  }
  return !a.intervenida
}

/** La hoja de ruta, ordenada por puntaje (desc), límite (asc) y nombre. */
export function construirHojaDeRuta(e: EntradaHojaDeRuta): HojaDeRuta {
  const ahoraMs = e.ahora.getTime()
  const zonasResp = zonasResponsableAhora(e)
  const base: HojaDeRuta = {
    supervisorId: e.supervisorId, responsableAhora: zonasResp.length > 0,
    motivo: zonasResp.length > 0 ? 'ok' : 'sin_guardia_vigente',
    zonasResponsable: zonasResp, items: [], paradas: [], fueraDeZona: 0,
  }
  if (zonasResp.length === 0) return base

  const zonasSet = new Set(zonasResp)
  const objetivos = new Map(e.objetivos.map(o => [o.id, o]))
  const enRuta = (objetivoId: string): ObjetivoRuta | null => {
    const o = objetivos.get(objetivoId)
    if (!o || !o.zona_id || !zonasSet.has(o.zona_id)) return null
    if (!puedeOperarObjetivo(e.supervisorId, e.alcance, o, e.supervisorZonas)) return null
    return o
  }
  const items: ItemHojaDeRuta[] = []
  const vistos = new Set<string>()
  const contarFuera = (objetivoId: string) => { if (!vistos.has(objetivoId)) { vistos.add(objetivoId); base.fueraDeZona += 1 } }
  const nombre = (o: ObjetivoRuta) => o.nombre ?? o.id

  for (const p of e.puestosDescubiertos ?? []) {
    const o = enRuta(p.objetivo_id)
    if (!o) { contarFuera(p.objetivo_id); continue }
    items.push({
      tipo: 'servicio_sin_cobertura', objetivo_id: o.id, objetivo: nombre(o), ref: p.turno_id,
      puntaje: PESO.servicio_sin_cobertura + Math.min(Math.max(p.minutosDescubierto, 0), 60),
      motivo: `Puesto${p.puesto ? ` ${p.puesto}` : ''} sin fichaje hace ${Math.round(p.minutosDescubierto)} min`,
    })
  }

  for (const a of e.alertas ?? []) {
    if (a.severidad === 'media') continue
    if (!alertaPideAtencion(a, ahoraMs)) continue
    const o = enRuta(a.objetivo_id)
    if (!o) { contarFuera(a.objetivo_id); continue }
    const edadMin = Math.max(0, (ahoraMs - Date.parse(a.detectada_at)) / MIN)
    items.push({
      tipo: 'alerta_critica', objetivo_id: o.id, objetivo: nombre(o), ref: a.id,
      puntaje: PESO.alerta_critica + (a.severidad === 'critica' ? 15 : 0) + Math.min(Math.floor(edadMin / 10), 15),
      motivo: a.seguimiento_hasta ? `Seguimiento vencido: ${a.tipo}` : `Alerta abierta sin intervención: ${a.tipo}`,
      limite: a.seguimiento_hasta ?? null,
    })
  }

  const horizonte = (e.horizonteRelevoMin ?? 90) * MIN
  for (const r of e.relevos ?? []) {
    if (r.clase === 'solapamiento') continue // doble cobertura: no es riesgo de puesto vacío
    const t = Date.parse(r.relevo_at)
    if (!Number.isFinite(t) || t - ahoraMs > horizonte || ahoraMs - t > 4 * 60 * MIN) continue
    const o = enRuta(r.objetivo_id)
    if (!o) { contarFuera(r.objetivo_id); continue }
    const faltan = Math.round((t - ahoraMs) / MIN)
    items.push({
      tipo: 'relevo_pendiente', objetivo_id: o.id, objetivo: nombre(o), ref: r.turno_id, limite: r.relevo_at,
      puntaje: PESO.relevo_pendiente + (r.clase === 'sin_relevo' ? 10 : 0) + (faltan <= 30 ? 10 : 0),
      motivo: r.clase === 'sin_relevo'
        ? `Sin relevo programado (${faltan >= 0 ? `en ${faltan} min` : `hace ${-faltan} min`})`
        : `Hueco de ${r.minutos ?? '?'} min en el relevo (${faltan >= 0 ? `en ${faltan} min` : `hace ${-faltan} min`})`,
    })
  }

  if (e.contextoExigibilidad && e.ultimaSupervision) {
    for (const o of e.objetivos) {
      if (!o.zona_id || !zonasSet.has(o.zona_id)) continue
      if (!puedeOperarObjetivo(e.supervisorId, e.alcance, o, e.supervisorZonas)) { contarFuera(o.id); continue }
      if (!exigibilidadSupervision(o, e.contextoExigibilidad, e.ahora).exige) continue
      const ultima = e.ultimaSupervision.get(o.id) ?? null
      const frec = frecuenciaSupervision(o)
      const estado = estadoSupervision(ultima, frec, ahoraMs)
      const proxima = supervisionProximaAVencer(ultima, frec, ahoraMs)
      if (estado === 'vigente' && !proxima) continue
      const horas = horasParaVencimiento(ultima, frec, ahoraMs)
      const limite = ultima ? new Date(Date.parse(ultima) + frec * 3600000).toISOString() : null
      const puntaje = estado === 'vencida'
        ? PESO.supervision_exigible + 15 + Math.min(Math.floor(-(horas ?? 0) / 24) * 2, 10)
        : estado === 'nunca' ? PESO.supervision_exigible + 12 : PESO.supervision_exigible
      items.push({
        tipo: 'supervision_exigible', objetivo_id: o.id, objetivo: nombre(o), puntaje, limite,
        motivo: estado === 'vencida' ? `Supervisión vencida hace ${Math.round(-(horas ?? 0))} h`
          : estado === 'nunca' ? 'Nunca supervisado'
            : `Supervisión vence en ${Math.max(0, Math.round(horas ?? 0))} h`,
      })
    }
  }

  const porLimite = (x?: string | null) => (x ? Date.parse(x) : Number.POSITIVE_INFINITY)
  items.sort((a, b) => b.puntaje - a.puntaje || porLimite(a.limite) - porLimite(b.limite) || a.objetivo.localeCompare(b.objetivo))

  const paradas = new Map<string, ParadaHojaDeRuta>()
  for (const it of items) {
    const p = paradas.get(it.objetivo_id) ?? { objetivo_id: it.objetivo_id, objetivo: it.objetivo, puntaje: 0, items: [] }
    p.items.push(it)
    p.puntaje = Math.max(p.puntaje, it.puntaje)
    paradas.set(it.objetivo_id, p)
  }
  base.items = items
  base.paradas = Array.from(paradas.values())
    .sort((a, b) => b.puntaje - a.puntaje || b.items.length - a.items.length || a.objetivo.localeCompare(b.objetivo))
  return base
}

/** Feature flag del panel (apagado por defecto). */
export const hojaDeRutaHabilitada = (env: Record<string, string | undefined> = process.env): boolean =>
  env.NEXT_PUBLIC_HOJA_DE_RUTA === '1'
