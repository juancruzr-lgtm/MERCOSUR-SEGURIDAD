// WhatsApp como SOPORTE del supervisor de guardia — esqueleto en seco.
//
// Diseño: docs/auditoria-2026-10/hoja_de_ruta_supervisores.md (sección E).
//
// ── Estado ──────────────────────────────────────────────────────────────────
// DESHABILITADO. Sin `WHATSAPP_SOPORTE_SUPERVISOR=dry-run` no hace nada; con
// el flag sólo ARMA los payloads (plantilla + variables + clave estable) y los
// devuelve. No importa ningún proveedor, no llama a Meta, no escribe en la
// base. Para enviar de verdad hace falta: plantillas aprobadas en Meta,
// aprobación de Gerencia, y pasar cada payload por reclamarEnvio
// (lib/whatsapp-envio-seguro) — eso NO está implementado a propósito.
//
// ── Límites que no se negocian ──────────────────────────────────────────────
// · WhatsApp informa: nunca modifica fichajes, horas, turnos ni planillas, y
//   nunca acepta una respuesta del supervisor como acción operativa (la acción
//   se registra en la app, con su validación de rol y zona).
// · Sólo plantillas Utility aprobadas (fuera de la ventana de 24 h no se puede
//   mandar texto libre).
// · Destinatario: el supervisor de guardia AHORA (misma resolución que push).

import type { HojaDeRuta, ItemHojaDeRuta } from '@/lib/hoja-de-ruta'

export type TipoMensajeSoporte = 'inicio_guardia' | 'incidente_critico' | 'pendientes_relevo' | 'resumen'

/** Plantillas a aprobar en Meta (categoría Utility, es_AR). */
export const PLANTILLAS_SOPORTE: Record<TipoMensajeSoporte, { nombre: string; variables: string[] }> = {
  inicio_guardia: { nombre: 'sup_inicio_guardia_v1', variables: ['supervisor', 'zona', 'horario', 'cantidad', 'prioridades'] },
  incidente_critico: { nombre: 'sup_incidente_critico_v1', variables: ['objetivo', 'detalle', 'desde'] },
  pendientes_relevo: { nombre: 'sup_pendientes_relevo_v1', variables: ['cantidad', 'detalle'] },
  resumen: { nombre: 'sup_resumen_guardia_v1', variables: ['cantidad', 'detalle', 'omitidos'] },
}

/** Topes de diseño (a confirmar con Gerencia). */
export const LIMITES_SOPORTE = {
  /** Incidentes críticos sueltos por supervisor y hora; el resto va al resumen. */
  incidentesPorHora: 4,
  /** Mensajes de soporte por supervisor y guardia (todos los tipos). */
  mensajesPorGuardia: 12,
  /** Ítems listados dentro de una variable. */
  itemsPorMensaje: 3,
  /** Largo máximo de una variable (Meta rechaza saltos de línea y textos largos). */
  largoVariable: 120,
} as const

export interface PayloadSoporte {
  tipo: TipoMensajeSoporte
  clave: string
  plantilla: string
  variables: string[]
  destinatarioId: string
}

export interface EntradaSoporte {
  hoja: HojaDeRuta
  supervisorNombre: string
  zonaNombre: string
  /** Identificador estable de la guardia (p. ej. `${fecha}T${hora_inicio}`). */
  guardiaId: string
  horario: string
  ahora: Date
  /** Incidentes críticos ya avisados en la última hora (para el tope). */
  incidentesUltimaHora?: number
  /** Mensajes de soporte ya generados en esta guardia. */
  mensajesEnGuardia?: number
  /** ¿Ya se mandó el inicio de esta guardia? */
  inicioEnviado?: boolean
  /** Refs (turno/alerta) ya avisadas como incidente. */
  incidentesAvisados?: Set<string>
  /** Momento del resumen pedido (bloque de 4 h). */
  pedirResumen?: boolean
}

/** Meta: sin saltos de línea, sin tabs, sin 4+ espacios seguidos, acotado. */
export function variableSegura(texto: string, largo: number = LIMITES_SOPORTE.largoVariable): string {
  const limpio = String(texto ?? '').replace(/[\r\n\t]+/g, ' · ').replace(/ {2,}/g, ' ').trim()
  return limpio.length > largo ? `${limpio.slice(0, largo - 1)}…` : (limpio || '-')
}

const listar = (items: ItemHojaDeRuta[]) =>
  items.slice(0, LIMITES_SOPORTE.itemsPorMensaje).map((i, n) => `${n + 1}) ${i.objetivo}: ${i.motivo}`).join(' ; ')

const esCritico = (i: ItemHojaDeRuta) => i.tipo === 'servicio_sin_cobertura' || i.tipo === 'alerta_critica'

/**
 * Arma los payloads que HABRÍA que mandar. Puro. Reglas de consolidación:
 *  1. inicio_guardia: uno por guardia, con las 3 primeras prioridades.
 *  2. incidente_critico: uno por hecho nuevo (clave por ref), hasta 4/h;
 *     lo que excede queda para el resumen.
 *  3. pendientes_relevo: UN mensaje con todos los relevos de la hoja.
 *  4. resumen: sólo si se pide (bloque de 4 h) y hay pendientes; nombra cuántos
 *     se omitieron por tope.
 *  Tope general por guardia: lo que no entra, no se arma.
 */
export function armarMensajesSoporte(e: EntradaSoporte): PayloadSoporte[] {
  if (!e.hoja.responsableAhora) return []
  const sup = e.hoja.supervisorId
  const out: PayloadSoporte[] = []
  const P = PLANTILLAS_SOPORTE
  const clave = (tipo: TipoMensajeSoporte, evento: string) => `wa|soporte_${tipo}|${evento}|${sup}`
  let cupo = Math.max(0, LIMITES_SOPORTE.mensajesPorGuardia - (e.mensajesEnGuardia ?? 0))
  const push = (p: PayloadSoporte) => { if (cupo > 0) { out.push(p); cupo -= 1 } }

  if (!e.inicioEnviado) {
    push({
      tipo: 'inicio_guardia', clave: clave('inicio_guardia', `guardia:${e.guardiaId}`), plantilla: P.inicio_guardia.nombre,
      destinatarioId: sup,
      variables: [e.supervisorNombre, e.zonaNombre, e.horario, String(e.hoja.items.length), listar(e.hoja.items) || 'Sin prioridades abiertas']
        .map(v => variableSegura(v)),
    })
  }

  const avisados = e.incidentesAvisados ?? new Set<string>()
  let porHora = Math.max(0, LIMITES_SOPORTE.incidentesPorHora - (e.incidentesUltimaHora ?? 0))
  let omitidos = 0
  for (const i of e.hoja.items.filter(esCritico)) {
    const ref = i.ref ?? `${i.tipo}:${i.objetivo_id}`
    if (avisados.has(ref)) continue
    if (porHora <= 0) { omitidos += 1; continue }
    porHora -= 1
    push({
      tipo: 'incidente_critico', clave: clave('incidente_critico', ref), plantilla: P.incidente_critico.nombre,
      destinatarioId: sup,
      variables: [i.objetivo, i.motivo, i.limite ?? e.ahora.toISOString()].map(v => variableSegura(v)),
    })
  }

  const relevos = e.hoja.items.filter(i => i.tipo === 'relevo_pendiente')
  if (relevos.length > 0) {
    const hora = e.ahora.toISOString().slice(0, 13)
    push({
      tipo: 'pendientes_relevo', clave: clave('pendientes_relevo', `hora:${hora}`), plantilla: P.pendientes_relevo.nombre,
      destinatarioId: sup,
      variables: [String(relevos.length), listar(relevos)].map(v => variableSegura(v)),
    })
  }

  if (e.pedirResumen && e.hoja.items.length > 0) {
    const bloque = `${e.ahora.toISOString().slice(0, 10)}#${Math.floor(e.ahora.getUTCHours() / 4)}`
    push({
      tipo: 'resumen', clave: clave('resumen', `${e.guardiaId}|${bloque}`), plantilla: P.resumen.nombre,
      destinatarioId: sup,
      variables: [String(e.hoja.items.length), listar(e.hoja.items), String(omitidos)].map(v => variableSegura(v)),
    })
  }
  return out
}

export type ModoSoporte = 'deshabilitado' | 'dry_run'

export function modoSoporte(env: Record<string, string | undefined> = process.env): ModoSoporte {
  return env.WHATSAPP_SOPORTE_SUPERVISOR === 'dry-run' ? 'dry_run' : 'deshabilitado'
}

/**
 * Punto de entrada del esqueleto. NUNCA envía: sin flag no arma nada; con
 * flag devuelve los payloads para revisarlos.
 */
export function soporteSupervisorEnSeco(
  e: EntradaSoporte,
  env: Record<string, string | undefined> = process.env,
): { modo: ModoSoporte; enviados: 0; payloads: PayloadSoporte[] } {
  const modo = modoSoporte(env)
  return { modo, enviados: 0, payloads: modo === 'dry_run' ? armarMensajesSoporte(e) : [] }
}
