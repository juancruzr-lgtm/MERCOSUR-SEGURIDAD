// Selección de rondas candidatas a WhatsApp al VIGILADOR (refuerzo a +10 min).
//
// ── Qué es y qué NO es ──────────────────────────────────────────────────────
// Función PURA: recibe los datos ya consultados (acotados por turno/estado, sin
// lecturas amplias que puedan truncarse a 1000 filas — ver Issue #166) y decide
// qué ventanas de ronda ameritan UN WhatsApp al vigilador. No consulta la red,
// no manda nada, no escribe.
//
// ── La regla ────────────────────────────────────────────────────────────────
// El vigilador ya recibe push 15' antes y push "pendiente" desde el inicio de
// la ventana. El WhatsApp es un REFUERZO único: sale sólo si pasaron
// `avisoMin` (10) minutos del INICIO de la ventana y la ronda sigue sin
// iniciarse, y todavía dentro de la ventana (antes de que cierre). Máximo uno
// por (ronda_base, turno, ventana): la clave de deduplicación lo garantiza.
//
// No recalcula cobertura ni cumplimiento: sólo mira si HAY una ejecución que
// satisface la ventana, con el mismo criterio de matching que el push.

/** Ventana de gracia de matching de ejecución, igual que el push. */
const GRACIA_MATCH_MIN = 15

export interface TurnoVigente {
  id: string
  guardia_id: string
  puesto_id: string
  objetivo_id: string
  fecha: string        // YYYY-MM-DD
  hora_inicio: string  // HH:MM[:SS]
  hora_fin: string     // HH:MM[:SS]
}

export interface RondaBaseVig {
  id: string
  puesto_id: string
  nombre: string
  hora_inicio: string | null // HH:MM[:SS] o null (ancla al inicio del turno)
  intervalo_minutos: number
}

/** Ejecución ya normalizada por el llamador: iniciadaMin en minutos absolutos. */
export interface EjecucionMin {
  ronda_base_id: string
  turno_id: string
  iniciadaMin: number
}

/** Pausa ya normalizada por el llamador (minutos absolutos; hastaMin null = abierta). */
export interface PausaMin {
  ronda_base_id: string
  desdeMin: number
  hastaMin: number | null
}

export interface ObjetivoVig {
  id: string
  nombre: string
  estado?: string | null
  es_prueba?: boolean | null
}

export interface CandidatoRondaVig {
  turno_id: string
  guardia_id: string
  objetivo_id: string
  ronda_base_id: string
  ventana_inicio_min: number
  objetivo_nombre: string
  ronda_nombre: string
  horario: string   // HH:MM del inicio de la ventana, hora de la operación
  clave_dedup: string
}

/** Minutos absolutos de (fecha, hora) tratando los componentes como locales. */
export function minutosAbs(fecha: string, hora: string): number {
  const [y, m, d] = String(fecha).slice(0, 10).split('-').map(Number)
  const [hh, mm] = String(hora).slice(0, 5).split(':').map(Number)
  return Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0) / 60000
}

/** HH:MM de un valor en minutos absolutos. */
export function horaDeMinutosAbs(min: number): string {
  const d = new Date(min * 60000)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`
}

/** La clave de dedup, ligada a la ventana programada concreta. */
export function claveDedupRondaVig(rondaBaseId: string, ventanaInicioMin: number): string {
  return `wa_ronda_pendiente:${rondaBaseId}:${ventanaInicioMin}`
}

export interface ParametrosSeleccion {
  ahoraMin: number
  turnosVigentes: TurnoVigente[]
  rondasBase: RondaBaseVig[]
  ejecuciones: EjecucionMin[]
  pausas: PausaMin[]
  objetivos: ObjetivoVig[]
  /** Minutos desde el inicio de la ventana para recién mandar WhatsApp (10). */
  avisoMin: number
  /** created_at de la ronda_base en minutos abs, para no exigir antes de existir. */
  rondaCreadaMin?: Record<string, number>
  /**
   * Claves `${ronda_base_id}:${turno_id}` con una suspensión declarada por el
   * vigilador (alerta ronda_alertas tipo 'suspendida' pendiente). El vigilador
   * ya informó que no puede hacerla: no se le manda WhatsApp. La suspensión NO
   * crea pausa, así que hay que pasarla explícitamente.
   */
  suspendidasClaves?: Set<string>
}

const objetivoOperativo = (o?: ObjetivoVig | null): boolean =>
  Boolean(o) && (o!.estado ?? 'activo') === 'activo' && o!.es_prueba !== true

export function seleccionarCandidatosRondaVigilador(p: ParametrosSeleccion): CandidatoRondaVig[] {
  const { ahoraMin, turnosVigentes, rondasBase, ejecuciones, pausas, objetivos, avisoMin } = p
  const objPorId = new Map(objetivos.map(o => [o.id, o]))
  const salida: CandidatoRondaVig[] = []

  for (const t of turnosVigentes) {
    const objetivo = objPorId.get(t.objetivo_id)
    // Objetivo pausado/inactivo o de prueba: no genera obligación ni aviso.
    if (!objetivoOperativo(objetivo)) continue

    const tIni = minutosAbs(t.fecha, t.hora_inicio)
    const nocturno = minutosAbs(t.fecha, t.hora_fin) <= tIni
    const tFin = minutosAbs(t.fecha, t.hora_fin) + (nocturno ? 1440 : 0)

    for (const rb of rondasBase.filter(r => r.puesto_id === t.puesto_id)) {
      const interv = rb.intervalo_minutos
      if (!interv || interv <= 0) continue

      // El vigilador ya declaró que no puede hacer esta ronda en este turno.
      if (p.suspendidasClaves?.has(`${rb.id}:${t.id}`)) continue

      let base = rb.hora_inicio ? minutosAbs(t.fecha, rb.hora_inicio) : tIni
      while (base < tIni) base += 1440

      const creadaMin = p.rondaCreadaMin?.[rb.id]

      for (let n = 0; n <= 10000; n++) {
        const vi = base + n * interv
        if (vi >= tFin) break
        const vf = Math.min(vi + interv, tFin)

        // Sólo la ventana en la que estamos AHORA, pasados los +avisoMin y antes
        // del cierre. Las demás ventanas del turno no se consideran acá.
        if (!(ahoraMin >= vi + avisoMin && ahoraMin < vf)) continue

        // No exigir una ronda antes de que la ronda_base existiera.
        if (creadaMin != null && vi < creadaMin) continue

        // ¿Ya iniciada esta ventana? Mismo matching que el push:
        // [vi - gracia, vi + interv - gracia).
        const yaIniciada = ejecuciones.some(e =>
          e.ronda_base_id === rb.id && e.turno_id === t.id
          && e.iniciadaMin >= vi - GRACIA_MATCH_MIN
          && e.iniciadaMin < vi + interv - GRACIA_MATCH_MIN)
        if (yaIniciada) continue

        // ¿Pausa que cubre el inicio de la ventana?
        const pausada = pausas.some(pa =>
          pa.ronda_base_id === rb.id
          && pa.desdeMin <= vi
          && (pa.hastaMin === null || vi < pa.hastaMin))
        if (pausada) continue

        salida.push({
          turno_id: t.id,
          guardia_id: t.guardia_id,
          objetivo_id: t.objetivo_id,
          ronda_base_id: rb.id,
          ventana_inicio_min: vi,
          objetivo_nombre: objetivo!.nombre,
          ronda_nombre: rb.nombre,
          horario: horaDeMinutosAbs(vi),
          clave_dedup: claveDedupRondaVig(rb.id, vi),
        })
      }
    }
  }

  return salida
}
