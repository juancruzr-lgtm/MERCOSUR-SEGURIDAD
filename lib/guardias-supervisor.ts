/**
 * lib/guardias-supervisor.ts
 *
 * Generación por rango de guardias de supervisor (tabla `supervisores_guardia`).
 *
 * La pantalla "Supervisores de Guardia" cargaba una fila por día, a mano. Para
 * programar una zona completa había que repetir la misma carga decenas de
 * veces. Acá vive la parte pura de la generación masiva: expandir
 * (fecha desde, fecha hasta, días de semana) en filas concretas, descartar las
 * que ya existen y contar todo ANTES de escribir nada. La pantalla consulta,
 * muestra el resumen y recién entonces inserta.
 *
 * Decisiones que conviene tener a la vista:
 *
 *   · La zona se guarda con el nombre canónico de `zonas_operativas`. La
 *     comparación, en cambio, va normalizada (trim + minúsculas) porque en
 *     producción conviven 'rafaela' y 'Rafaela'. Mismo criterio que usan
 *     AppClient y SupervisorMobile para buscar al supervisor de guardia.
 *
 *   · En los nocturnos (hora_fin <= hora_inicio) la fila se guarda con la
 *     fecha de INICIO. Un "viernes 19:00 a sábado 07:00" es una fila del
 *     viernes: al elegir los días de semana se eligen días de comienzo, no de
 *     cobertura. La tabla ya funcionaba así; la generación no lo cambia.
 *
 *   · Duplicado exacto = mismo supervisor, misma zona (normalizada), misma
 *     fecha y mismo horario. El rol operativo queda fuera de la clave a
 *     propósito: dos filas iguales con distinto rol son una carga repetida,
 *     no dos guardias distintas.
 *
 * No genera nada retroactivo ni lo prohíbe: si el rango incluye días pasados
 * se generan igual, porque cargar una guardia ya cumplida es una corrección
 * administrativa legítima.
 */

// ── Constantes ───────────────────────────────────────────────────────────────

/**
 * Tope de días del rango. Un año alcanza de sobra y evita un insert absurdo.
 * Con esto la cantidad de filas queda acotada sola: como máximo una por día.
 */
export const MAX_DIAS_RANGO = 366

export const MENSAJE_RANGO_INVERTIDO = 'La fecha "hasta" no puede ser anterior a la fecha "desde".'
export const MENSAJE_SIN_DIAS = 'Seleccioná al menos un día de la semana.'
export const MENSAJE_RANGO_LARGO = `El rango supera ${MAX_DIAS_RANGO} días. Generá por tramos más cortos.`
export const MENSAJE_SIN_SUPERVISOR = 'Elegí el supervisor asignado.'
export const MENSAJE_SIN_ZONA = 'Elegí la zona operativa.'
export const MENSAJE_SIN_HORARIO = 'Completá hora de inicio y hora de fin.'
export const MENSAJE_FECHAS_INCOMPLETAS = 'Completá la fecha desde y la fecha hasta.'

// ── Entradas y salidas ───────────────────────────────────────────────────────

export interface ParametrosGeneracion {
  supervisor_id: string
  /** Nombre canónico tal como figura en zonas_operativas. */
  zona: string
  /** YYYY-MM-DD */
  desde: string
  /** YYYY-MM-DD */
  hasta: string
  /** 1=Lun … 7=Dom */
  dias_semana: number[]
  hora_inicio: string
  hora_fin: string
  rol_operativo?: string
  estado?: string
  observacion?: string | null
}

/** Fila ya existente en supervisores_guardia, para descartar duplicados. */
export interface GuardiaExistente {
  supervisor_id?: string | null
  zona?: string | null
  fecha?: string | null
  hora_inicio?: string | null
  hora_fin?: string | null
  /** Regla de la que salió la fila. Null en las cargas manuales. */
  regla_id?: string | null
}

export interface FilaGuardiaGenerada {
  supervisor_id: string
  fecha: string
  hora_inicio: string
  hora_fin: string
  zona: string
  rol_operativo: string
  estado: string
  observacion: string | null
  regla_id?: string | null
  origen?: string
  tipo_evento?: string
}

export interface PrevisionGeneracion {
  /** Todas las fechas del rango que caen en los días elegidos. */
  fechas: string[]
  /** Filas que se van a insertar. */
  aCrear: FilaGuardiaGenerada[]
  /** Fechas descartadas por existir ya una fila idéntica. */
  duplicadas: string[]
  /** Errores de configuración. Con al menos uno, aCrear queda vacío. */
  errores: string[]
  /** true si el horario cruza la medianoche. */
  nocturno: boolean
}

// ── Utilidades ───────────────────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Normaliza zona/estado/rol para comparar texto libre contra el catálogo. */
export const normalizarTextoGuardia = (value?: string | null) =>
  (value ?? '').trim().toLowerCase()

/** Recorta 'HH:MM:SS' a 'HH:MM'. La base guarda time, el formulario manda HH:MM. */
export const hora5 = (hora?: string | null) => (hora ?? '').slice(0, 5)

const FECHA_VALIDA = /^\d{4}-\d{2}-\d{2}$/
const HORA_VALIDA = /^\d{1,2}:\d{2}/

/** Día de semana 1=Lun … 7=Dom, sin depender del huso horario. */
export function diaSemanaIso(fecha: string): number {
  const [anio, mes, dia] = fecha.split('-').map(Number)
  const dow = new Date(anio, mes - 1, dia).getDay()
  return dow === 0 ? 7 : dow
}

/**
 * Fechas entre `desde` y `hasta` (ambas incluidas) que caen en `diasSemana`.
 * Devuelve [] si el rango está invertido o mal formado; la validación de esos
 * casos es responsabilidad de previsualizarGeneracion.
 */
export function fechasEnRango(desde: string, hasta: string, diasSemana: number[]): string[] {
  if (!FECHA_VALIDA.test(desde) || !FECHA_VALIDA.test(hasta)) return []
  if (hasta < desde) return []
  if (!diasSemana.length) return []

  const [anioD, mesD, diaD] = desde.split('-').map(Number)
  const cursor = new Date(anioD, mesD - 1, diaD)
  const fechas: string[] = []

  // El corte es por string: las fechas ISO ordenan lexicográficamente y así no
  // hay que construir un Date de comparación por vuelta.
  for (let i = 0; i <= MAX_DIAS_RANGO; i++) {
    const fecha = `${cursor.getFullYear()}-${pad2(cursor.getMonth() + 1)}-${pad2(cursor.getDate())}`
    if (fecha > hasta) break
    if (diasSemana.includes(diaSemanaIso(fecha))) fechas.push(fecha)
    cursor.setDate(cursor.getDate() + 1)
  }

  return fechas
}

/** Días calendario que abarca el rango, extremos incluidos. */
export function diasDelRango(desde: string, hasta: string): number {
  if (!FECHA_VALIDA.test(desde) || !FECHA_VALIDA.test(hasta)) return 0
  const [a1, m1, d1] = desde.split('-').map(Number)
  const [a2, m2, d2] = hasta.split('-').map(Number)
  const ms = Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)
  return Math.floor(ms / 86_400_000) + 1
}

/** true si el horario cruza la medianoche (18:00 a 06:00). */
export function esNocturno(horaInicio: string, horaFin: string): boolean {
  const inicio = hora5(horaInicio)
  const fin = hora5(horaFin)
  if (!HORA_VALIDA.test(inicio) || !HORA_VALIDA.test(fin)) return false
  return fin <= inicio
}

/**
 * Clave de duplicado exacto: supervisor + zona normalizada + fecha + horario.
 * El rol operativo queda afuera a propósito (ver cabecera del módulo).
 */
export function claveGuardia(fila: GuardiaExistente): string {
  return [
    fila.supervisor_id ?? '',
    normalizarTextoGuardia(fila.zona),
    String(fila.fecha ?? '').slice(0, 10),
    hora5(fila.hora_inicio),
    hora5(fila.hora_fin),
  ].join('|')
}

// ── Vista previa ─────────────────────────────────────────────────────────────

/**
 * Expande los parámetros en filas concretas sin escribir nada.
 *
 * `existentes` son las filas que ya están en la base para ese rango. La
 * pantalla las consulta acotadas por fecha; pasarlas todas también funciona,
 * la clave descarta lo que no corresponde.
 */
export function previsualizarGeneracion(
  params: ParametrosGeneracion,
  existentes: GuardiaExistente[] = [],
): PrevisionGeneracion {
  const errores: string[] = []

  const supervisorId = (params.supervisor_id ?? '').trim()
  const zona = (params.zona ?? '').trim()
  const desde = (params.desde ?? '').trim()
  const hasta = (params.hasta ?? '').trim()
  const horaInicio = hora5(params.hora_inicio)
  const horaFin = hora5(params.hora_fin)
  const dias = (params.dias_semana ?? [])
    .filter((d, i, todos) => d >= 1 && d <= 7 && todos.indexOf(d) === i)
    .sort((a, b) => a - b)

  if (!supervisorId) errores.push(MENSAJE_SIN_SUPERVISOR)
  if (!zona) errores.push(MENSAJE_SIN_ZONA)
  if (!FECHA_VALIDA.test(desde) || !FECHA_VALIDA.test(hasta)) errores.push(MENSAJE_FECHAS_INCOMPLETAS)
  else if (hasta < desde) errores.push(MENSAJE_RANGO_INVERTIDO)
  else if (diasDelRango(desde, hasta) > MAX_DIAS_RANGO) errores.push(MENSAJE_RANGO_LARGO)
  if (!dias.length) errores.push(MENSAJE_SIN_DIAS)
  if (!HORA_VALIDA.test(horaInicio) || !HORA_VALIDA.test(horaFin)) errores.push(MENSAJE_SIN_HORARIO)

  const nocturno = esNocturno(horaInicio, horaFin)

  if (errores.length) {
    return { fechas: [], aCrear: [], duplicadas: [], errores, nocturno }
  }

  const fechas = fechasEnRango(desde, hasta, dias)

  const yaExisten = new Set(existentes.map(claveGuardia))
  const duplicadas: string[] = []
  const aCrear: FilaGuardiaGenerada[] = []

  // Las repeticiones dentro de la propia tanda también cuentan: el mismo día
  // no puede entrar dos veces aunque la base todavía no lo tenga.
  const enTanda = new Set<string>()

  for (const fecha of fechas) {
    const clave = claveGuardia({
      supervisor_id: supervisorId,
      zona,
      fecha,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
    })

    if (yaExisten.has(clave) || enTanda.has(clave)) {
      duplicadas.push(fecha)
      continue
    }

    enTanda.add(clave)
    aCrear.push({
      supervisor_id: supervisorId,
      fecha,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      zona,
      rol_operativo: params.rol_operativo || 'supervisor',
      estado: params.estado || 'activo',
      observacion: (params.observacion ?? '').trim() || null,
    })
  }

  return { fechas, aCrear, duplicadas, errores, nocturno }
}

/** Resumen en una línea para mostrar antes de insertar. */
export function resumenGeneracion(prevision: PrevisionGeneracion): string {
  if (prevision.errores.length) return prevision.errores.join(' ')
  if (!prevision.fechas.length) return 'Ningún día del rango coincide con los días elegidos.'

  const partes = [`Se van a crear ${prevision.aCrear.length} guardia(s)`]
  if (prevision.duplicadas.length) partes.push(`${prevision.duplicadas.length} ya existen y se omiten`)
  if (prevision.nocturno) partes.push('horario nocturno: la fecha es la de inicio')
  return `${partes.join(' · ')}.`
}

// ── Programación semanal (plantilla) ─────────────────────────────────────────
//
// Una regla es un bloque horario con sus días, NO "el horario del supervisor":
// Sabino son tres reglas (dom-jue 07-19, vie 07-13, vie 19-07 nocturno).
// Generar un mes es expandir todas las reglas activas del período.
//
// La plantilla no es el calendario. Lo que leen las alertas, la Vista
// Supervisor y el reparto de carga es `supervisores_guardia`, porque ahí están
// las excepciones del día. Una excepción NUNCA vuelve hacia la regla.

/** Excepciones que se cargan sobre una guardia ya generada. */
export const TIPOS_EVENTO_GUARDIA = [
  { value: 'normal', label: 'Normal' },
  { value: 'franco', label: 'Franco' },
  { value: 'ausencia', label: 'Ausencia' },
  { value: 'reemplazo', label: 'Reemplazo' },
  { value: 'cobertura', label: 'Cobertura extra' },
  { value: 'cambio_horario', label: 'Cambio de horario' },
] as const

/**
 * Tipos que significan que ese día NO hay cobertura.
 *
 * Quien lea las guardias efectivas —alertas, Vista Supervisor, reparto de
 * carga— tiene que excluirlas, igual que la revisión operativa excluye los
 * turnos reemplazados o anulados. Un franco cargado como excepción sigue
 * siendo una fila de la tabla: si no se lo excluye, se cuenta como cobertura.
 */
export const TIPOS_SIN_COBERTURA = new Set(['franco', 'ausencia'])

/** true si la guardia efectivamente cubre (no es franco ni ausencia, ni está inactiva). */
export function guardiaCubre(guardia: { estado?: string | null; tipo_evento?: string | null }): boolean {
  if (normalizarTextoGuardia(guardia.estado || 'activo') === 'inactivo') return false
  return !TIPOS_SIN_COBERTURA.has(normalizarTextoGuardia(guardia.tipo_evento || 'normal'))
}

export interface ReglaSemanal {
  id: string
  supervisor_id: string
  zona_id: string
  /** Nombre canónico de la zona, resuelto contra zonas_operativas. */
  zona_nombre: string
  /** 1=Lun … 7=Dom */
  dias_semana: number[]
  hora_inicio: string
  hora_fin: string
  rol_operativo?: string | null
  observacion?: string | null
  activo?: boolean | null
  vigencia_desde?: string | null
  vigencia_hasta?: string | null
}

export interface PrevisionRegla {
  regla: ReglaSemanal
  aCrear: FilaGuardiaGenerada[]
  duplicadas: string[]
  /** Motivo por el que la regla no aportó nada. */
  omitida?: string
}

export interface PrevisionMes {
  desde: string
  hasta: string
  aCrear: FilaGuardiaGenerada[]
  duplicadas: number
  porRegla: PrevisionRegla[]
  errores: string[]
}

export const MENSAJE_SIN_REGLAS = 'No hay reglas semanales activas para ese período.'
export const MOTIVO_REGLA_INACTIVA = 'Regla inactiva'
export const MOTIVO_FUERA_DE_VIGENCIA = 'Fuera de vigencia para ese período'
export const MOTIVO_REGLA_INCOMPLETA = 'Regla incompleta (falta zona, horario o días)'
export const MOTIVO_SIN_FECHAS = 'Ningún día del período coincide con la regla'
export const MOTIVO_TODO_EXISTE = 'Ya estaba generado por completo'

/**
 * Clave de una fila generada por regla: la regla y la fecha, nada más.
 *
 * Esto es lo que hace idempotente la regeneración de un mes ya editado. Si el
 * 10/09 de Sergio se cambió de 07:00-19:00 a 07:00-13:00, la clave por horario
 * no lo encontraría y volvería a crear la fila original: el mes quedaría con la
 * guardia corregida Y la original. Con la regla como clave, ese día ya está
 * cubierto y no se toca. Por eso un franco se carga como excepción sobre la
 * fila y no borrándola: una fila borrada vuelve en la próxima generación.
 */
export function claveReglaFecha(reglaId: string, fecha: string): string {
  return `regla:${reglaId}|${String(fecha).slice(0, 10)}`
}

const reglaEsUsable = (regla: ReglaSemanal): string | null => {
  if (regla.activo === false) return MOTIVO_REGLA_INACTIVA
  if (!regla.supervisor_id || !regla.zona_nombre?.trim()) return MOTIVO_REGLA_INCOMPLETA
  if (!HORA_VALIDA.test(hora5(regla.hora_inicio)) || !HORA_VALIDA.test(hora5(regla.hora_fin))) return MOTIVO_REGLA_INCOMPLETA
  if (!regla.dias_semana?.length) return MOTIVO_REGLA_INCOMPLETA
  return null
}

/**
 * Expande todas las reglas en las filas diarias de un período.
 *
 * `existentes` son las guardias ya cargadas en ese rango. Se descarta una
 * fecha si ya hay una fila de la misma regla (aunque esté editada) o una fila
 * idéntica cargada a mano: generar el mes nunca pisa lo que ya está.
 */
export function previsualizarDesdeReglas(
  reglas: ReglaSemanal[],
  rango: { desde: string; hasta: string },
  existentes: GuardiaExistente[] = [],
): PrevisionMes {
  const desde = (rango.desde ?? '').trim()
  const hasta = (rango.hasta ?? '').trim()
  const errores: string[] = []

  if (!FECHA_VALIDA.test(desde) || !FECHA_VALIDA.test(hasta)) errores.push(MENSAJE_FECHAS_INCOMPLETAS)
  else if (hasta < desde) errores.push(MENSAJE_RANGO_INVERTIDO)
  else if (diasDelRango(desde, hasta) > MAX_DIAS_RANGO) errores.push(MENSAJE_RANGO_LARGO)
  if (!reglas.length) errores.push(MENSAJE_SIN_REGLAS)

  if (errores.length) {
    return { desde, hasta, aCrear: [], duplicadas: 0, porRegla: [], errores }
  }

  // Dos claves distintas contra lo ya cargado: por regla (sobrevive a los
  // cambios de horario) y por slot exacto (atrapa lo cargado a mano).
  const porRegla = new Set<string>()
  const porSlot = new Set<string>()
  for (const fila of existentes) {
    if (fila.regla_id) porRegla.add(claveReglaFecha(fila.regla_id, String(fila.fecha ?? '')))
    porSlot.add(claveGuardia(fila))
  }

  const resultado: PrevisionRegla[] = []
  const todas: FilaGuardiaGenerada[] = []
  let duplicadas = 0

  for (const regla of reglas) {
    const inutilizable = reglaEsUsable(regla)
    if (inutilizable) {
      resultado.push({ regla, aCrear: [], duplicadas: [], omitida: inutilizable })
      continue
    }

    // La vigencia recorta el período pedido, no lo reemplaza.
    const inicio = regla.vigencia_desde && regla.vigencia_desde > desde ? regla.vigencia_desde : desde
    const fin = regla.vigencia_hasta && regla.vigencia_hasta < hasta ? regla.vigencia_hasta : hasta

    if (fin < inicio) {
      resultado.push({ regla, aCrear: [], duplicadas: [], omitida: MOTIVO_FUERA_DE_VIGENCIA })
      continue
    }

    const fechas = fechasEnRango(inicio, fin, regla.dias_semana)
    if (!fechas.length) {
      resultado.push({ regla, aCrear: [], duplicadas: [], omitida: MOTIVO_SIN_FECHAS })
      continue
    }

    const zona = regla.zona_nombre.trim()
    const horaInicio = hora5(regla.hora_inicio)
    const horaFin = hora5(regla.hora_fin)
    const deLaRegla: FilaGuardiaGenerada[] = []
    const repetidas: string[] = []

    for (const fecha of fechas) {
      const claveR = claveReglaFecha(regla.id, fecha)
      const claveS = claveGuardia({
        supervisor_id: regla.supervisor_id,
        zona,
        fecha,
        hora_inicio: horaInicio,
        hora_fin: horaFin,
      })

      if (porRegla.has(claveR) || porSlot.has(claveS)) {
        repetidas.push(fecha)
        continue
      }

      porRegla.add(claveR)
      porSlot.add(claveS)
      deLaRegla.push({
        supervisor_id: regla.supervisor_id,
        fecha,
        hora_inicio: horaInicio,
        hora_fin: horaFin,
        zona,
        rol_operativo: regla.rol_operativo || 'supervisor',
        estado: 'activo',
        observacion: (regla.observacion ?? '').trim() || null,
        regla_id: regla.id,
        origen: 'regla',
        tipo_evento: 'normal',
      })
    }

    duplicadas += repetidas.length
    todas.push(...deLaRegla)
    resultado.push({
      regla,
      aCrear: deLaRegla,
      duplicadas: repetidas,
      omitida: deLaRegla.length === 0 ? MOTIVO_TODO_EXISTE : undefined,
    })
  }

  return { desde, hasta, aCrear: todas, duplicadas, porRegla: resultado, errores }
}

/** Resumen en una línea de la generación desde reglas. */
export function resumenMes(prevision: PrevisionMes): string {
  if (prevision.errores.length) return prevision.errores.join(' ')
  if (!prevision.aCrear.length && !prevision.duplicadas) {
    return 'Ninguna regla activa produce guardias en ese período.'
  }

  const reglasQueAportan = prevision.porRegla.filter(r => r.aCrear.length).length
  const partes = [`Se van a crear ${prevision.aCrear.length} guardia(s) desde ${reglasQueAportan} regla(s)`]
  if (prevision.duplicadas) partes.push(`${prevision.duplicadas} ya existen y se omiten`)
  return `${partes.join(' · ')}.`
}

/** Primer y último día del mes 'YYYY-MM'. */
export function rangoDelMes(mes: string): { desde: string; hasta: string } {
  const [anio, numeroMes] = mes.split('-').map(Number)
  if (!anio || !numeroMes) return { desde: '', hasta: '' }
  const ultimo = new Date(anio, numeroMes, 0).getDate()
  return { desde: `${anio}-${pad2(numeroMes)}-01`, hasta: `${anio}-${pad2(numeroMes)}-${pad2(ultimo)}` }
}

/** Etiqueta de los días de una regla: [1,2,3,4,5] → 'Lun a Vie'. */
export function etiquetaDias(dias: number[]): string {
  const nombres = ['', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']
  const ordenados = dias.filter((d, i, todos) => d >= 1 && d <= 7 && todos.indexOf(d) === i).sort((a, b) => a - b)
  if (!ordenados.length) return '—'
  if (ordenados.length === 7) return 'Todos los días'

  // Se muestra como rango sólo si los días son consecutivos. 'dom a jue' no lo
  // es en esta numeración (7,1,2,3,4) y se lista tal cual, que es más honesto
  // que inventar un rango que cruza el fin de semana.
  const consecutivos = ordenados.every((d, i) => i === 0 || d === ordenados[i - 1] + 1)
  if (consecutivos && ordenados.length > 2) return `${nombres[ordenados[0]]} a ${nombres[ordenados[ordenados.length - 1]]}`
  return ordenados.map(d => nombres[d]).join(' · ')
}
