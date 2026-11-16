/**
 * lib/tablero-gerencia/mensajes.ts
 *
 * Preparación de comunicaciones desde el Tablero de Gerencia.
 *
 * Este módulo NO ENVÍA. Arma un lote revisable (vista previa, teléfono,
 * destinatario, exclusiones) que Gerencia autoriza. El envío real, cuando se
 * apruebe, reutiliza la infraestructura existente:
 *   lib/whatsapp.ts (proveedor Meta, sólo plantillas)
 *   lib/whatsapp-envio-seguro.ts (reclamar_envio_whatsapp: clave única,
 *     topes por destinatario/día, reintentos acotados, falla cerrado)
 *   app/api/whatsapp/webhook (estados sent/delivered/read → whatsapp_mensaje_estados)
 *
 * Restricciones del canal (verificadas en el código, 16/11/2026):
 *  - Todo envío es una PLANTILLA aprobada por Meta (`type: 'template'`).
 *    No hay texto libre: fuera de la ventana de 24 h Meta lo rechaza.
 *  - Las variables no pueden tener saltos de línea ni tabulaciones.
 *  - Los mensajes entrantes los atiende el bot comercial del número: el
 *    webhook los ignora. Por eso la RESPUESTA del vigilador/supervisor se
 *    registra en la app (botón con enlace al caso), no respondiendo el WhatsApp.
 */

import { normalizarTelefonoAr } from '@/lib/telefono-ar'

export type DestinoPlantilla = 'vigilador' | 'supervisor'
export type EstadoPlantillaMeta = 'pendiente_aprobacion' | 'aprobada' | 'rechazada'

export interface PlantillaGestion {
  codigo: string
  /** Nombre a registrar en Meta (minúsculas y guion bajo). */
  nombreMeta: string
  destino: DestinoPlantilla
  /** Categoría Meta: UTILITY (aviso operativo transaccional). */
  categoria: 'UTILITY'
  estadoMeta: EstadoPlantillaMeta
  cuerpo: string
  variables: string[]
  /** Botón URL dinámico: abre el caso en la app para responder. */
  botonResponder: boolean
  tiposCaso: string[]
}

/**
 * Plantillas nuevas: TODAS en `pendiente_aprobacion` hasta que Meta las apruebe.
 * Mientras tanto `prepararLote` bloquea el lote completo.
 */
export const PLANTILLAS_GESTION: readonly PlantillaGestion[] = [
  {
    codigo: 'VIG_FICHAJE_PENDIENTE', nombreMeta: 'gestion_fichaje_pendiente_vigilador',
    destino: 'vigilador', categoria: 'UTILITY', estadoMeta: 'pendiente_aprobacion',
    cuerpo: 'MERCOSUR SEGURIDAD: Detectamos que no se encuentra registrado tu fichaje correspondiente al turno del {{1}} en {{2}}. Por favor, verificá la situación e informá el motivo.',
    variables: ['fecha_turno', 'objetivo'], botonResponder: true,
    tiposCaso: ['sin_fichaje', 'sin_salida'],
  },
  {
    codigo: 'VIG_EXPLICACION', nombreMeta: 'gestion_solicitud_explicacion_vigilador',
    destino: 'vigilador', categoria: 'UTILITY', estadoMeta: 'pendiente_aprobacion',
    cuerpo: 'MERCOSUR SEGURIDAD: Registramos una novedad de {{1}} en tu turno del {{2}} en {{3}}. Por favor, ingresá a la aplicación e informá el motivo.',
    variables: ['tipo_novedad', 'fecha_turno', 'objetivo'], botonResponder: true,
    tiposCaso: ['ingreso_tardio', 'salida_anticipada', 'ronda_incumplida', 'gps_fuera_radio'],
  },
  {
    codigo: 'SUP_INCIDENCIA_FICHAJE', nombreMeta: 'gestion_incidencia_fichaje_supervisor',
    destino: 'supervisor', categoria: 'UTILITY', estadoMeta: 'pendiente_aprobacion',
    cuerpo: 'MERCOSUR SEGURIDAD: Se detectó una incidencia de fichaje correspondiente a {{1}}, turno {{2}}, objetivo {{3}}. Solicitamos verificar la situación e informar el resultado.',
    variables: ['empleado', 'fecha_horario', 'objetivo'], botonResponder: true,
    tiposCaso: ['sin_fichaje', 'sin_salida', 'ingreso_tardio', 'salida_anticipada', 'gps_fuera_radio', 'diferencia_horas'],
  },
  {
    codigo: 'SUP_SUPERVISIONES_PENDIENTES', nombreMeta: 'gestion_supervisiones_pendientes',
    destino: 'supervisor', categoria: 'UTILITY', estadoMeta: 'pendiente_aprobacion',
    cuerpo: 'MERCOSUR SEGURIDAD: Se registran supervisiones pendientes en los objetivos bajo tu responsabilidad. Ingresá a la aplicación para consultar el detalle y regularizar las situaciones correspondientes.',
    variables: [], botonResponder: true,
    tiposCaso: ['supervision_vencida'],
  },
  {
    codigo: 'SUP_CASO_ASIGNADO', nombreMeta: 'gestion_caso_asignado',
    destino: 'supervisor', categoria: 'UTILITY', estadoMeta: 'pendiente_aprobacion',
    cuerpo: 'MERCOSUR SEGURIDAD: Se te asignó el seguimiento de {{1}} en {{2}}, con plazo hasta el {{3}}. Ingresá a la aplicación para ver el detalle.',
    variables: ['tipo_novedad', 'objetivo', 'plazo'], botonResponder: true,
    tiposCaso: ['*'],
  },
]

export function plantillaPorCodigo(codigo: string): PlantillaGestion | undefined {
  return PLANTILLAS_GESTION.find(p => p.codigo === codigo)
}

export function plantillasParaCaso(tipoCaso: string, destino: DestinoPlantilla): PlantillaGestion[] {
  return PLANTILLAS_GESTION.filter(p => p.destino === destino && (p.tiposCaso.includes('*') || p.tiposCaso.includes(tipoCaso)))
}

/** Limpia una variable como lo exige Meta: sin saltos ni tabulaciones, sin espacios dobles. */
export function limpiarVariable(v: string): string {
  return v.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim()
}

export interface ErrorVariables { faltantes: string[]; demasiadoLargas: string[] }

export function validarVariables(p: PlantillaGestion, valores: Record<string, string>): ErrorVariables | null {
  const faltantes = p.variables.filter(v => !limpiarVariable(valores[v] ?? ''))
  const demasiadoLargas = p.variables.filter(v => limpiarVariable(valores[v] ?? '').length > 200)
  return faltantes.length || demasiadoLargas.length ? { faltantes, demasiadoLargas } : null
}

/** Texto exacto que verá el destinatario (vista previa). */
export function vistaPrevia(p: PlantillaGestion, valores: Record<string, string>): string {
  return p.cuerpo.replace(/\{\{(\d+)\}\}/g, (_, n) => limpiarVariable(valores[p.variables[Number(n) - 1]] ?? `[${p.variables[Number(n) - 1]}]`))
}

/** Clave estable, compatible con lib/whatsapp-envio-seguro.ts (`wa|etapa|evento|destinatario`). */
export function claveEnvioGestion(casoIds: string[], plantilla: string, destinatarioId: string): string {
  return `wa|gestion_${plantilla.toLowerCase()}|${[...casoIds].sort().join('+')}|${destinatarioId}`
}

export interface DestinatarioPropuesto {
  usuarioId: string
  nombre: string
  telefono: string | null
  /** Casos que motivan el mensaje a esta persona (uno o varios). */
  casoIds: string[]
  valores: Record<string, string>
}

export interface EnvioPrevio {
  clave: string
  /** ISO del envío previo con resultado 'enviado'. */
  at: string
}

export type MotivoExclusion =
  | 'sin_telefono'
  | 'telefono_invalido'
  | 'duplicado_en_lote'
  | 'ya_enviado_recientemente'
  | 'variables_invalidas'

export interface ItemLote {
  usuarioId: string
  nombre: string
  telefonoE164: string
  casoIds: string[]
  clave: string
  texto: string
}

export interface LotePreparado {
  plantilla: string
  nombreMeta: string
  items: ItemLote[]
  excluidos: { usuarioId: string; nombre: string; motivo: MotivoExclusion; detalle?: string }[]
  /** Si hay bloqueos, nada del lote se puede enviar. */
  bloqueos: string[]
  /** Más de `umbralConfirmacion` destinatarios: pedir confirmación reforzada. */
  requiereConfirmacionReforzada: boolean
  autorizadoPor: string
  preparadoAt: string
}

export interface OpcionesLote {
  plantilla: PlantillaGestion
  destinatarios: DestinatarioPropuesto[]
  autorizadoPor: string
  /** Debe ser de Gerencia (o delegación de Gerencia): lo valida la RPC en el servidor. */
  autorizanteEsGerencia: boolean
  ahoraIso: string
  enviosPrevios?: EnvioPrevio[]
  /** No repetir el mismo mensaje del mismo caso a la misma persona dentro de N horas. */
  ventanaAntiDuplicadoHoras?: number
  topeLote?: number
  umbralConfirmacion?: number
  /** Interruptor general. Hoy SIEMPRE false: el envío no está habilitado. */
  envioHabilitado: boolean
}

export function prepararLote(o: OpcionesLote): LotePreparado {
  const ventana = (o.ventanaAntiDuplicadoHoras ?? 24) * 3_600_000
  const tope = o.topeLote ?? 25
  const umbral = o.umbralConfirmacion ?? 5
  const ahora = Date.parse(o.ahoraIso)
  const previos = new Map<string, number>()
  for (const e of o.enviosPrevios ?? []) {
    const t = Date.parse(e.at)
    if (!previos.has(e.clave) || previos.get(e.clave)! < t) previos.set(e.clave, t)
  }

  const bloqueos: string[] = []
  if (!o.envioHabilitado) bloqueos.push('El envío desde el tablero está desactivado hasta la aprobación de Gerencia.')
  if (o.plantilla.estadoMeta !== 'aprobada') bloqueos.push(`La plantilla ${o.plantilla.nombreMeta} no está aprobada por Meta.`)
  if (!o.autorizanteEsGerencia) bloqueos.push('Sólo Gerencia (o su delegación) puede autorizar envíos.')

  const items: ItemLote[] = []
  const excluidos: LotePreparado['excluidos'] = []
  const vistos = new Set<string>()

  for (const d of o.destinatarios) {
    const tel = normalizarTelefonoAr(d.telefono)
    if (!tel.e164) {
      excluidos.push({ usuarioId: d.usuarioId, nombre: d.nombre, motivo: tel.motivo === 'vacio' ? 'sin_telefono' : 'telefono_invalido', detalle: tel.motivo })
      continue
    }
    const err = validarVariables(o.plantilla, d.valores)
    if (err) {
      excluidos.push({ usuarioId: d.usuarioId, nombre: d.nombre, motivo: 'variables_invalidas', detalle: [...err.faltantes, ...err.demasiadoLargas].join(', ') })
      continue
    }
    const clave = claveEnvioGestion(d.casoIds, o.plantilla.codigo, d.usuarioId)
    // Un mismo teléfono recibe un solo mensaje por lote (dos usuarios con el mismo número, o el mismo usuario dos veces).
    const claveTel = `${tel.e164}|${o.plantilla.codigo}`
    if (vistos.has(claveTel)) {
      excluidos.push({ usuarioId: d.usuarioId, nombre: d.nombre, motivo: 'duplicado_en_lote' })
      continue
    }
    const previo = previos.get(clave)
    if (previo !== undefined && ahora - previo < ventana) {
      excluidos.push({ usuarioId: d.usuarioId, nombre: d.nombre, motivo: 'ya_enviado_recientemente', detalle: new Date(previo).toISOString() })
      continue
    }
    vistos.add(claveTel)
    items.push({ usuarioId: d.usuarioId, nombre: d.nombre, telefonoE164: tel.e164, casoIds: d.casoIds, clave, texto: vistaPrevia(o.plantilla, d.valores) })
  }

  if (items.length > tope) bloqueos.push(`El lote tiene ${items.length} destinatarios; el máximo por lote es ${tope}.`)
  if (items.length === 0) bloqueos.push('No queda ningún destinatario válido.')

  return {
    plantilla: o.plantilla.codigo,
    nombreMeta: o.plantilla.nombreMeta,
    items,
    excluidos,
    bloqueos,
    requiereConfirmacionReforzada: items.length > umbral,
    autorizadoPor: o.autorizadoPor,
    preparadoAt: o.ahoraIso,
  }
}

/**
 * Agrupa casos por destinatario para enviar UN mensaje por persona aunque
 * tenga varios casos seleccionados (evita comunicaciones innecesarias).
 */
export function agruparPorDestinatario<T extends { id: string }>(
  casos: T[],
  destinatarioDe: (c: T) => string | null,
): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const c of casos) {
    const d = destinatarioDe(c)
    if (!d) continue
    const arr = m.get(d) ?? []
    arr.push(c)
    m.set(d, arr)
  }
  return m
}
