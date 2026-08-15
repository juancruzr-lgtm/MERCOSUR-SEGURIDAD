/**
 * lib/responsables-operativos.ts
 *
 * LA resolución de responsables operativos. Una sola, para todos.
 *
 * Antes convivían tres implementaciones distintas de "¿a quién le corresponde
 * este evento?": AppClient y SupervisorMobile buscaban en supervisores_guardia
 * cada uno con su copia de la comparación de rangos, y el módulo de push tenía
 * nombres propios HARDCODEADOS (Aranda/Martínez de día, Fulla de noche) más un
 * ruteo por zona que filtraba por rol === 'supervisor' y dejaba afuera a un
 * admin que trabaja operativamente como supervisor. Este módulo las reemplaza
 * a todas; ninguna pantalla ni ruta debe volver a calcular esto por su cuenta.
 *
 * La regla, en orden:
 *
 *   1. GUARDIA EFECTIVA. Filas de supervisores_guardia cuya zona (normalizada)
 *      es la del objetivo y cuyo rango horario CUBRE el instante del evento,
 *      con nocturnos (hora_fin <= hora_inicio ⇒ termina al día siguiente).
 *      Una guardia vieja de la zona no cuenta: tiene que cubrir ese momento.
 *      Los francos y ausencias no cubren (guardiaCubre), las inactivas tampoco.
 *      Si cubren VARIOS a la vez (Rosario lun-jue de día: Sabino + Sergio),
 *      son TODOS responsables: no se elige uno arbitrariamente.
 *
 *   2. RESPONSABLE ÚNICO DE ZONA. Sin guardia efectiva para ese instante, si
 *      supervisor_zonas tiene EXACTAMENTE un asignado activo en la zona, es el
 *      responsable (hoy: Rafaela → Wilhjelm, Reconquista → Acosta, sin
 *      hardcodear nombres: sale de la tabla).
 *
 *   3. VARIOS SIN GUARDIA. Con varios asignados de zona y ninguna guardia que
 *      decida, NO se elige: se devuelve la lista de candidatos y el motivo,
 *      para que la interfaz muestre que falta definir la guardia.
 *
 * El ROL NO DECIDE QUIÉN RECIBE. La responsabilidad operativa sale de la
 * asignación (guardia o zona), no de la etiqueta del rol: un admin asignado
 * es responsable; un admin no asignado no lo es. La autorización de acciones
 * es otro problema y se resuelve en otro lado. El único filtro de usuario acá
 * es el estado (un usuario inactivo no puede ser responsable).
 *
 * Es una función pura: recibe los datos ya consultados y no toca la red, igual
 * que lib/programacion o lib/guardias-supervisor. Cada consumidor (pantallas,
 * push) trae sus filas y llama.
 */

import { guardiaCubre, hora5, normalizarTextoGuardia } from '@/lib/guardias-supervisor'

// ── Entradas ─────────────────────────────────────────────────────────────────

/** Fila de supervisores_guardia, con lo que la resolución necesita. */
export interface GuardiaOperativa {
  supervisor_id?: string | null
  zona?: string | null
  fecha?: string | null
  hora_inicio?: string | null
  hora_fin?: string | null
  estado?: string | null
  tipo_evento?: string | null
  rol_operativo?: string | null
}

/** Fila de supervisor_zonas. */
export interface AsignacionZona {
  supervisor_id: string
  zona_id: string
}

/** Lo mínimo de un usuario para poder descartarlo si está inactivo. */
export interface UsuarioBasico {
  id: string
  estado?: string | null
}

export interface ParametrosResolucion {
  /** Nombre de la zona del objetivo (como en zonas_operativas.nombre). */
  zonaNombre?: string | null
  /** Id de la zona del objetivo. Con ambos, manda el id. */
  zonaId?: string | null
  /** YYYY-MM-DD del evento. */
  fecha: string
  /** HH:MM del evento. */
  hora: string
  guardias: GuardiaOperativa[]
  supervisorZonas: AsignacionZona[]
  /** Catálogo para traducir zonaId ↔ nombre. */
  zonas: Array<{ id: string; nombre: string }>
  /**
   * Si se pasa, sólo los usuarios activos pueden ser responsables. Sin esta
   * lista no se filtra (el llamador ya trae usuarios activos, como hace push).
   */
  usuarios?: UsuarioBasico[]
}

// ── Salida ───────────────────────────────────────────────────────────────────

export type OrigenResolucion =
  | 'guardia_efectiva'        // prioridad 1: una o varias guardias cubren el instante
  | 'unico_responsable_zona'  // prioridad 2: sin guardia, un solo asignado de zona
  | 'multiples_sin_guardia'   // prioridad 3: varios asignados y ninguna guardia decide
  | 'sin_responsable'         // la zona no tiene ni guardia ni asignados
  | 'sin_zona'                // el objetivo no tiene zona: no se puede atribuir

export interface ResolucionResponsables {
  /** Ids de usuario responsables. Vacío en multiples_sin_guardia/sin_*. */
  responsables: string[]
  origen: OrigenResolucion
  /**
   * En multiples_sin_guardia: quiénes eran los candidatos de zona, para poder
   * mostrarlos sin haberlos elegido.
   */
  candidatosZona: string[]
}

export const TEXTO_ORIGEN: Record<OrigenResolucion, string> = {
  guardia_efectiva: 'Supervisor de guardia',
  unico_responsable_zona: 'Responsable de zona',
  multiples_sin_guardia: 'Falta definir la guardia (varios responsables posibles)',
  sin_responsable: 'Sin responsable asignado en la zona',
  sin_zona: 'Objetivo sin zona: no se puede atribuir responsable',
}

// ── Cobertura de un instante ─────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Minutos absolutos de (fecha, hora), sin pasar por huso horario. */
function minutosAbsolutos(fecha: string, hora: string): number | null {
  const [anio, mes, dia] = String(fecha).slice(0, 10).split('-').map(Number)
  const [hh, mm] = hora5(hora).split(':').map(Number)
  if (!anio || !mes || !dia || !Number.isFinite(hh) || !Number.isFinite(mm)) return null
  return Date.UTC(anio, mes - 1, dia, hh, mm) / 60000
}

/**
 * true si la guardia cubre el instante (fecha, hora) del evento.
 *
 * El rango es [inicio, fin): una guardia de 07:00 a 19:00 cubre las 07:00 en
 * punto y NO las 19:00, que ya pertenecen al turno siguiente — así dos guardias
 * contiguas no se superponen en el minuto de cambio. En las nocturnas
 * (hora_fin <= hora_inicio) el fin cae al día siguiente de `guardia.fecha`.
 */
export function guardiaCubreInstante(guardia: GuardiaOperativa, fecha: string, hora: string): boolean {
  if (!guardia.fecha || !guardia.hora_inicio || !guardia.hora_fin) return false

  const valor = minutosAbsolutos(fecha, hora)
  const inicio = minutosAbsolutos(String(guardia.fecha), String(guardia.hora_inicio))
  let fin = minutosAbsolutos(String(guardia.fecha), String(guardia.hora_fin))
  if (valor === null || inicio === null || fin === null) return false

  if (fin <= inicio) fin += 1440
  return valor >= inicio && valor < fin
}

// ── Resolución ───────────────────────────────────────────────────────────────

/**
 * Resuelve los responsables operativos de un evento (zona + fecha/hora).
 * Devuelve cero, uno o varios; nunca elige arbitrariamente.
 */
export function resolverResponsablesOperativos(params: ParametrosResolucion): ResolucionResponsables {
  const { guardias, supervisorZonas, zonas, usuarios } = params

  // Con lista de usuarios, sólo los activos pueden ser responsables. La regla
  // de "usuario sin dato de estado cuenta como activo" replica lo que ya hacen
  // las pantallas con datos parciales.
  const usuarioActivo = (id?: string | null): boolean => {
    if (!id) return false
    if (!usuarios) return true
    const usuario = usuarios.find(u => u.id === id)
    return Boolean(usuario) && normalizarTextoGuardia(usuario!.estado || 'activo') === 'activo'
  }

  // Zona por id o por nombre, la que venga.
  const zonaCatalogo = params.zonaId
    ? zonas.find(z => z.id === params.zonaId)
    : params.zonaNombre
      ? zonas.find(z => normalizarTextoGuardia(z.nombre) === normalizarTextoGuardia(params.zonaNombre))
      : undefined
  const zonaNombre = zonaCatalogo?.nombre ?? params.zonaNombre ?? null
  const zonaId = zonaCatalogo?.id ?? params.zonaId ?? null

  if (!zonaNombre && !zonaId) {
    return { responsables: [], origen: 'sin_zona', candidatosZona: [] }
  }

  // Prioridad 1 — guardias que CUBREN el instante. rol_operativo distinto de
  // 'supervisor' (jefe operativo, director técnico) no recibe alertas
  // operativas de primera línea: mismo criterio que ya usaban las pantallas.
  const zonaNorm = normalizarTextoGuardia(zonaNombre)
  const efectivas = guardias.filter(guardia =>
    normalizarTextoGuardia(guardia.zona) === zonaNorm &&
    normalizarTextoGuardia(guardia.rol_operativo || 'supervisor') === 'supervisor' &&
    guardiaCubre(guardia) &&
    guardiaCubreInstante(guardia, params.fecha, params.hora) &&
    usuarioActivo(guardia.supervisor_id),
  )

  if (efectivas.length > 0) {
    const ids = efectivas
      .map(g => g.supervisor_id as string)
      .filter((id, i, todos) => todos.indexOf(id) === i)
    return { responsables: ids, origen: 'guardia_efectiva', candidatosZona: [] }
  }

  // Prioridad 2 — responsable único de supervisor_zonas. Sin zonaId no hay
  // cómo cruzar (supervisor_zonas referencia por id).
  const candidatos = zonaId
    ? supervisorZonas
        .filter(asignacion => asignacion.zona_id === zonaId && usuarioActivo(asignacion.supervisor_id))
        .map(asignacion => asignacion.supervisor_id)
        .filter((id, i, todos) => todos.indexOf(id) === i)
    : []

  if (candidatos.length === 1) {
    return { responsables: candidatos, origen: 'unico_responsable_zona', candidatosZona: candidatos }
  }

  if (candidatos.length > 1) {
    return { responsables: [], origen: 'multiples_sin_guardia', candidatosZona: candidatos }
  }

  return { responsables: [], origen: 'sin_responsable', candidatosZona: [] }
}

/** Fecha (YYYY-MM-DD) y hora (HH:MM) locales de un Date, para eventos "ahora". */
export function instanteLocal(ahora: Date = new Date(), timeZone = 'America/Argentina/Buenos_Aires'): { fecha: string; hora: string } {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(ahora)
  const valor = (tipo: string) => partes.find(p => p.type === tipo)?.value ?? '00'
  // Intl puede devolver la hora 24 en el límite del día; 24:xx → 00:xx.
  const hora = valor('hour') === '24' ? '00' : valor('hour')
  return {
    fecha: `${valor('year')}-${pad2(Number(valor('month')))}-${pad2(Number(valor('day')))}`,
    hora: `${hora}:${valor('minute')}`,
  }
}
