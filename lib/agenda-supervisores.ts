/**
 * lib/agenda-supervisores.ts — ¿qué franjas de un día quedan SIN supervisor de
 * guardia según la programación (supervisores_guardia)?
 *
 * Es la lógica pura del aviso preventivo de agenda: la ruta
 * /api/push/agenda-supervisores la consume con la fecha de MAÑANA para avisar
 * hoy que falta completar la programación. Nació del hueco de octubre 2026:
 * el 03/10 quedó todo el día sin guardia diurna y seis alertas de ronda
 * esperaron hasta 18 horas para escalarse.
 *
 * Convención horaria de la tabla: una fila con hora_fin > hora_inicio cubre esa
 * franja del MISMO día; con hora_fin <= hora_inicio es NOCTURNA: cubre desde
 * hora_inicio hasta medianoche de su fecha, y de 00:00 a hora_fin del día
 * SIGUIENTE. Por eso la cobertura de un día se arma con sus propias filas más
 * las nocturnas del día anterior.
 */

export type GuardiaProgramada = {
  fecha: string
  hora_inicio: string
  hora_fin: string
  estado?: string | null
}

/** Franja en minutos del día: [desde, hasta). 1440 = medianoche siguiente. */
export type Franja = { desde: number; hasta: number }

function minutosDe(hora: string): number {
  const [h, m] = hora.split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

/**
 * Franjas del día `fecha` sin ninguna guardia activa. Ignora huecos menores a
 * `minimoMin` (bordes de carga tipo 19:00/19:05 no son un agujero real).
 */
export function franjasDescubiertas(
  filas: GuardiaProgramada[],
  fecha: string,
  fechaAnterior: string,
  minimoMin = 15,
): Franja[] {
  const cubiertas: Franja[] = []

  for (const g of filas) {
    if ((g.estado ?? 'activo') !== 'activo') continue
    const ini = minutosDe(g.hora_inicio)
    const fin = minutosDe(g.hora_fin)

    if (g.fecha === fecha) {
      if (fin > ini) cubiertas.push({ desde: ini, hasta: fin })
      else cubiertas.push({ desde: ini, hasta: 1440 }) // nocturna: su resto cae en el día siguiente
    } else if (g.fecha === fechaAnterior && fin <= ini) {
      cubiertas.push({ desde: 0, hasta: fin }) // cola de la nocturna de ayer
    }
  }

  cubiertas.sort((a, b) => a.desde - b.desde)

  const huecos: Franja[] = []
  let cursor = 0
  for (const c of cubiertas) {
    if (c.desde > cursor) huecos.push({ desde: cursor, hasta: c.desde })
    cursor = Math.max(cursor, c.hasta)
  }
  if (cursor < 1440) huecos.push({ desde: cursor, hasta: 1440 })

  return huecos.filter(h => h.hasta - h.desde >= minimoMin)
}

export function horaTexto(min: number): string {
  if (min >= 1440) return '24:00'
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

/** "00:00–07:00, 19:00–24:00" — para el cuerpo del aviso. */
export function textoFranjas(franjas: Franja[]): string {
  return franjas.map(f => `${horaTexto(f.desde)}–${horaTexto(f.hasta)}`).join(', ')
}
