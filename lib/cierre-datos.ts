// Cierre Operativo Diario — de las fuentes reales a los items del agregador.
//
// NO detecta nada por su cuenta ni define pendientes nuevos. Traduce lo que ya
// producen las fuentes existentes al tipo ItemCierre, y el que decide qué
// cuenta y cómo se separa hoy del arrastre es lib/cierre-operativo.
//
// Fuentes, todas preexistentes:
//   Planillas   cargarFilasBandeja + requiereRevision   (Revisión de planillas)
//   Rondas      ronda_alertas estado = 'pendiente'
//   Fotos IA    evidencia_analisis observadas sin decisión humana
//   Operación   detectarAlertasOperativas               (Revisión Operativa)

import { supabase } from '@/lib/supabase'
import { cargarFilasBandeja, limitesDelMesDesempeno } from '@/lib/bandeja-datos'
import { requiereRevision } from '@/lib/bandeja-planillas'
import type { FilaBandejaMensual } from '@/lib/bandeja-planillas'
import {
  alertaEstaIntervenida, claveOcurrenciaAlerta, detectarAlertasOperativas,
} from '@/lib/revision-operativa'
import type {
  AlertaOperativaDetectada, IntervencionOperativaBase, RegistroDetectorOperativo,
  TipoAlertaOperativa, TurnoDetectorOperativo,
} from '@/lib/revision-operativa'
import type { ItemCierre } from '@/lib/cierre-operativo'

/** Los tres tipos de evidencia que se revisan. Ni más ni menos. */
export const TIPOS_EVIDENCIA_IA = ['punto_control', 'uniforme', 'libro_guardia'] as const
export type TipoEvidenciaIA = typeof TIPOS_EVIDENCIA_IA[number]

export const ETIQUETA_EVIDENCIA_IA: Record<TipoEvidenciaIA, string> = {
  punto_control: 'foto de ronda',
  uniforme:      'foto de uniforme',
  libro_guardia: 'foto del libro de guardia',
}

// ── Planillas ────────────────────────────────────────────────────────────────

/**
 * Una planilla es pendiente del supervisor cuando `requiereRevision` lo dice.
 * Esa función ya sabe que una confirmación de supervisor aceptada por el
 * vigilador NO pide otra revisión, y que una derivación correcta a
 * Administración sigue el circuito administrativo.
 */
export function itemsDePlanillas(filas: FilaBandejaMensual[]): ItemCierre[] {
  return filas.filter(requiereRevision).map(f => ({
    id: `planilla:${f.turnoId}:${f.empleadoId}`,
    categoria: 'planillas' as const,
    fecha: f.fecha.slice(0, 10),
    hora: f.horaInicioProg || '00:00',
    objetivoId: f.objetivoId,
    zonaId: null,
    etiqueta: `${f.vigilador} · ${f.objetivo} · ${f.horario}`,
    // Derivada a Administración: sigue abierta para ellos, no para el supervisor.
    resueltoPorSupervisor: f.derivado,
  }))
}

// ── Rondas ───────────────────────────────────────────────────────────────────

export interface AlertaRondaCierre {
  id: string
  objetivo_id: string
  objetivo_nombre?: string | null
  ronda_nombre?: string | null
  guardia_nombre?: string | null
  tipo: string
  estado: string
  ventana_inicio: string
  comentario?: string | null
}

/** Una alerta saneada administrativamente no vuelve a pedir intervención. */
export function esSaneada(comentario?: string | null): boolean {
  return String(comentario || '').startsWith('Saneamiento administrativo')
}

export function itemsDeRondas(alertas: AlertaRondaCierre[], tz = 'America/Argentina/Buenos_Aires'): ItemCierre[] {
  return alertas
    .filter(a => !esSaneada(a.comentario))
    .map(a => {
      const { fecha, hora } = partirInstante(a.ventana_inicio, tz)
      return {
        id: `ronda:${a.id}`,
        categoria: 'rondas' as const,
        fecha,
        hora,
        objetivoId: a.objetivo_id,
        zonaId: null,
        etiqueta: [a.objetivo_nombre, a.ronda_nombre, a.guardia_nombre]
          .filter(Boolean).join(' · ') || 'Ronda',
        resueltoPorSupervisor: a.estado === 'resuelta',
      }
    })
}

// ── Fotos IA ─────────────────────────────────────────────────────────────────

export interface EvidenciaIACierre {
  id: string
  analisis_tipo: string
  objetivo_id: string
  objetivo_nombre?: string | null
  guardia_nombre?: string | null
  revision_estado: string
  clasificacion_efectiva?: string | null
  evidencia_created_at: string
  motivos?: string[] | null
  resumen?: string | null
}

/**
 * Sólo lo que la IA marcó Y todavía no tiene decisión humana.
 *
 * La observación cruda NO es una falta de nadie: es una propuesta que espera
 * que una persona la confirme o la descarte. Por eso entra al cierre como
 * trabajo del supervisor, no como incidencia del vigilador.
 */
export function itemsDeFotosIA(evidencias: EvidenciaIACierre[], tz = 'America/Argentina/Buenos_Aires'): ItemCierre[] {
  return evidencias
    .filter(e => (TIPOS_EVIDENCIA_IA as readonly string[]).indexOf(e.analisis_tipo) >= 0)
    .filter(e => e.clasificacion_efectiva === 'REVISAR')
    .map(e => {
      const { fecha, hora } = partirInstante(e.evidencia_created_at, tz)
      const tipo = ETIQUETA_EVIDENCIA_IA[e.analisis_tipo as TipoEvidenciaIA] ?? 'evidencia'
      return {
        id: `ia:${e.id}`,
        categoria: 'fotos_ia' as const,
        fecha,
        hora,
        objetivoId: e.objetivo_id,
        zonaId: null,
        etiqueta: [tipo, e.objetivo_nombre, e.guardia_nombre].filter(Boolean).join(' · '),
        // Confirmar o descartar: cualquiera de las dos la saca del pendiente.
        resueltoPorSupervisor: e.revision_estado !== 'PENDIENTE',
      }
    })
}

// ── Operación / turnos ───────────────────────────────────────────────────────
//
// Las alertas operativas —descubierto, sin fichar, tardanza, fuera de radio,
// salida pendiente— las detecta lib/revision-operativa. Acá NO se redetecta
// nada: se le pasan los turnos y registros del día que se está cerrando y se
// traduce lo que devuelve.
//
// Por qué sólo el día operativo y no el mes entero: el detector responde "esto
// está pasando ahora". Corrido sobre un mes, un puesto que quedó descubierto el
// 3 seguiría gritando el 25, y el arrastre se llenaría de ruido que ya no se
// puede atender. Lo del pasado que sí queda por decidir llega por Planillas,
// que es el circuito que corresponde para revisar un turno cerrado.

export interface AlertaOperativaCierre {
  clave: string
  tipo: string
  turno_id: string
  objetivo_id: string
  etiqueta: string
  fecha: string
  hora: string
  resuelta: boolean
}

export const ETIQUETA_ALERTA_OPERATIVA: Record<string, string> = {
  descubierto:      'Puesto sin cobertura',
  sin_fichar:       'Sin fichar',
  tardanza:         'Tardanza',
  fuera_radio:      'Fichaje fuera de radio',
  salida_pendiente: 'Salida pendiente',
}

export function itemsDeOperacion(alertas: AlertaOperativaCierre[]): ItemCierre[] {
  return alertas.map(a => ({
    id: `operacion:${a.clave}`,
    categoria: 'operacion' as const,
    fecha: a.fecha.slice(0, 10),
    hora: a.hora,
    objetivoId: a.objetivo_id,
    zonaId: null,
    etiqueta: a.etiqueta,
    resueltoPorSupervisor: a.resuelta,
  }))
}

export interface ContextoOperativo {
  turnos: TurnoDetectorOperativo[]
  registros: RegistroDetectorOperativo[]
  intervenciones: IntervencionOperativaBase[]
  objetivos: Array<{ id: string; nombre?: string | null; estado?: string | null }>
  nombrePorGuardia?: Record<string, string>
  ahora?: Date
}

/**
 * Traduce lo que detectó `detectarAlertasOperativas` a items del cierre.
 *
 * `resueltoPorSupervisor` sale de `alertaEstaIntervenida`, la misma función que
 * usa Revisión Operativa para decidir si una alerta sigue abierta. Si las dos
 * pantallas no coincidieran, el supervisor cerraría una alerta en una y la
 * vería viva en la otra.
 */
export function alertasOperativasParaCierre(ctx: ContextoOperativo): AlertaOperativaCierre[] {
  const detectadas: AlertaOperativaDetectada[] = detectarAlertasOperativas({
    turnos:    ctx.turnos,
    registros: ctx.registros,
    objetivos: ctx.objetivos,
    ...(ctx.ahora ? { ahora: ctx.ahora } : {}),
  })

  const turnoPorId = new Map(ctx.turnos.map(t => [t.id, t]))
  const nombreObjetivo = new Map(ctx.objetivos.map(o => [o.id, o.nombre || '']))

  return detectadas.map(a => {
    const turno = turnoPorId.get(a.turno_id)
    const guardia = a.guardia_id ? ctx.nombrePorGuardia?.[a.guardia_id] : null
    return {
      clave: claveOcurrenciaAlerta(a.turno_id, a.tipo_alerta, a.registro_asistencia_id),
      tipo: a.tipo_alerta,
      turno_id: a.turno_id,
      objetivo_id: a.objetivo_id,
      etiqueta: [
        ETIQUETA_ALERTA_OPERATIVA[a.tipo_alerta] || a.tipo_alerta,
        nombreObjetivo.get(a.objetivo_id) || null,
        guardia,
      ].filter(Boolean).join(' · '),
      // La fecha del TURNO, no la del reloj: un nocturno que arrancó ayer sigue
      // siendo del día de ayer, igual que en Planillas.
      fecha: String(turno?.fecha || '').slice(0, 10),
      hora: String(turno?.hora_inicio || '00:00').slice(0, 5),
      resuelta: alertaEstaIntervenida(
        ctx.intervenciones, a.turno_id,
        a.tipo_alerta as TipoAlertaOperativa, a.registro_asistencia_id,
      ),
    }
  })
}

// ── Utilidades ───────────────────────────────────────────────────────────────

/**
 * Parte un instante ISO en fecha y hora LOCALES.
 *
 * Importa: una alerta de las 23:40 de Buenos Aires es del día que termina, no
 * del siguiente. Usar UTC movería medio turno nocturno al día equivocado y el
 * arrastre diría cosas falsas.
 */
export function partirInstante(iso: string, tz = 'America/Argentina/Buenos_Aires'): { fecha: string; hora: string } {
  try {
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return { fecha: String(iso).slice(0, 10), hora: '00:00' }
    const partes = new Intl.DateTimeFormat('sv-SE', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(d)
    // 'sv-SE' formatea como "2026-08-25 23:40"
    const [fecha, hora] = partes.split(' ')
    return { fecha, hora: (hora || '00:00').slice(0, 5) }
  } catch {
    return { fecha: String(iso).slice(0, 10), hora: '00:00' }
  }
}

/** Fecha operativa local en YYYY-MM-DD. */
export function fechaOperativaHoy(ahora = new Date(), tz = 'America/Argentina/Buenos_Aires'): string {
  return partirInstante(ahora.toISOString(), tz).fecha
}

/** El día anterior, para arrastrar los nocturnos que cruzan medianoche. */
export function diaAnterior(fecha: string): string {
  const d = new Date(`${fecha}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

/**
 * Le pone zona a cada item a partir de su objetivo.
 *
 * Sin zona no hay responsable: `resolverResponsablesOperativos` devuelve
 * `sin_zona` y el item no se le atribuye a nadie. Es la única vía; el rol del
 * usuario no entra en esta decisión.
 */
export function estamparZonas(
  items: ItemCierre[],
  objetivos: Array<{ id: string; zona_id?: string | null; nombre?: string | null }>,
): ItemCierre[] {
  const zonaPorObjetivo = new Map(objetivos.map(o => [o.id, o.zona_id ?? null]))
  return items.map(i => ({
    ...i,
    zonaId: i.zonaId ?? (i.objetivoId ? zonaPorObjetivo.get(i.objetivoId) ?? null : null),
  }))
}

// ── Carga ────────────────────────────────────────────────────────────────────

export interface CargaCierreParams {
  /** Mes a cargar, 'YYYY-MM'. El arrastre sale del mismo período. */
  mes: string
  /** Día que se está cerrando, 'YYYY-MM-DD'. */
  fechaOperativa: string
  esAdmin: boolean
  usuarioId: string | null
  /** Cliente de Supabase. Ver CargaFilasParams.client. */
  client?: any
}

export interface CargaCierreResultado {
  items: ItemCierre[]
  /** Objetivos vigentes, para zona y nombre. */
  objetivos: Array<{ id: string; nombre: string | null; zona_id: string | null }>
  error: string | null
}

export async function cargarItemsCierre(p: CargaCierreParams): Promise<CargaCierreResultado> {
  const { desde, hasta } = limitesDelMesDesempeno(p.mes)
  const diaDesde = diaAnterior(p.fechaOperativa)
  const db = p.client ?? supabase

  const [bandeja, objetivosR, rondasR, iaR, turnosR, registrosR, intervencionesR, usuariosR] =
    await Promise.all([
      cargarFilasBandeja({ mes: p.mes, esAdmin: p.esAdmin, usuarioId: p.usuarioId, client: db }),
      db.from('objetivos').select('id, nombre, zona_id, estado, es_prueba'),
      db
        .from('ronda_alertas')
        .select('id, objetivo_id, tipo, estado, ventana_inicio, comentario, objetivo:objetivos(nombre, es_prueba), ronda:rondas_base(nombre), guardia:usuarios(nombre, apellido)')
        .gte('ventana_inicio', `${desde}T00:00:00`)
        .lte('ventana_inicio', `${hasta}T23:59:59`)
        .eq('estado', 'pendiente'),
      db
        .from('evidencia_analisis')
        .select('id, analisis_tipo, objetivo_id, revision_estado, clasificacion_efectiva, evidencia_created_at, motivos, resumen, objetivo:objetivos(nombre, es_prueba), guardia:usuarios(nombre, apellido)')
        .gte('evidencia_created_at', `${desde}T00:00:00`)
        .lte('evidencia_created_at', `${hasta}T23:59:59`)
        .eq('revision_estado', 'PENDIENTE')
        .eq('clasificacion_efectiva', 'REVISAR'),
      db
        .from('turnos')
        .select('id, objetivo_id, puesto_id, guardia_id, fecha, hora_inicio, hora_fin, estado')
        .gte('fecha', diaDesde).lte('fecha', p.fechaOperativa),
      db
        .from('registros_asistencia')
        .select('id, turno_id, guardia_id, tipo_registro, hora_entrada_real, hora_entrada_final, hora_salida_real, hora_salida_final, alerta_entrada, gps_ingreso_estado, turno:turnos!inner(fecha)')
        .gte('turno.fecha', diaDesde).lte('turno.fecha', p.fechaOperativa),
      db
        .from('supervisor_intervenciones')
        .select('id, turno_id, tipo_alerta, accion, registro_asistencia_id, created_at, secuencia_evento, turno:turnos!inner(fecha)')
        .gte('turno.fecha', diaDesde).lte('turno.fecha', p.fechaOperativa),
      db.from('usuarios').select('id, nombre, apellido'),
    ])

  if (bandeja.error) return { items: [], objetivos: [], error: bandeja.error }

  // Los objetivos de prueba nunca entran al cierre: Casa Juan no es trabajo de
  // nadie. Planillas ya los excluye por su cuenta; acá se excluyen las otras
  // tres fuentes.
  const objetivosReales = ((objetivosR.data ?? []) as any[]).filter(o => !o.es_prueba)
  const idsReales = new Set(objetivosReales.map(o => o.id))

  const nombre = (u: any) => (u ? `${u.apellido}, ${u.nombre}` : null)
  const nombrePorGuardia: Record<string, string> = {}
  for (const u of ((usuariosR.data ?? []) as any[])) {
    nombrePorGuardia[u.id] = `${u.apellido}, ${u.nombre}`
  }

  const alertas: AlertaRondaCierre[] = ((rondasR.data ?? []) as any[])
    .filter(a => !a.objetivo?.es_prueba)
    .map(a => ({
      id: a.id,
      objetivo_id: a.objetivo_id,
      objetivo_nombre: a.objetivo?.nombre ?? null,
      ronda_nombre: a.ronda?.nombre ?? null,
      guardia_nombre: nombre(a.guardia),
      tipo: a.tipo,
      estado: a.estado,
      ventana_inicio: a.ventana_inicio,
      comentario: a.comentario,
    }))

  const evidencias: EvidenciaIACierre[] = ((iaR.data ?? []) as any[])
    .filter(e => !e.objetivo?.es_prueba)
    .map(e => ({
      id: e.id,
      analisis_tipo: e.analisis_tipo,
      objetivo_id: e.objetivo_id,
      objetivo_nombre: e.objetivo?.nombre ?? null,
      guardia_nombre: nombre(e.guardia),
      revision_estado: e.revision_estado,
      clasificacion_efectiva: e.clasificacion_efectiva,
      evidencia_created_at: e.evidencia_created_at,
      motivos: e.motivos,
      resumen: e.resumen,
    }))

  const operativas = alertasOperativasParaCierre({
    turnos:         ((turnosR.data ?? []) as any[]).filter(t => idsReales.has(t.objetivo_id)),
    registros:      ((registrosR.data ?? []) as any[]),
    intervenciones: ((intervencionesR.data ?? []) as any[]),
    objetivos:      objetivosReales,
    nombrePorGuardia,
  })

  const items = estamparZonas([
    ...itemsDePlanillas(bandeja.filas),
    ...itemsDeRondas(alertas),
    ...itemsDeFotosIA(evidencias),
    ...itemsDeOperacion(operativas),
  ], objetivosReales)

  return {
    items,
    objetivos: objetivosReales.map(o => ({ id: o.id, nombre: o.nombre ?? null, zona_id: o.zona_id ?? null })),
    error: null,
  }
}
