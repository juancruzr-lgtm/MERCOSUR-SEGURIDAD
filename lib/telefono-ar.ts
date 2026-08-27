// Un número argentino, en el formato que WhatsApp necesita.
//
// ── Por qué esto es un módulo y no una línea ────────────────────────────────
// Los teléfonos de `usuarios.telefono` son texto libre cargado a mano durante
// años. En la práctica llegan de todas estas formas, y todas son el mismo
// número:
//
//   3794 123456        11 2345-6789
//   0379 15 123456     (011) 15 2345-6789
//   +54 379 4123456    54 9 11 2345 6789
//   00549379...        379-4-123456
//
// WhatsApp Cloud API quiere un solo formato: dígitos, con código de país, sin
// signos. Para Argentina eso es `549` + área + abonado. El `9` es obligatorio
// para móviles y el `15` NO va: son dos formas de decir lo mismo y ponerlas
// juntas produce un número que no existe.
//
// ── Lo que este módulo NO hace ──────────────────────────────────────────────
// Adivinar. Si un número no alcanza el largo mínimo o tiene un área que no
// existe, devuelve `null` con el motivo. Un WhatsApp mandado a un número
// inventado puede llegarle a un desconocido.

export interface TelefonoNormalizado {
  /** Listo para la API: sólo dígitos, con país. `null` si no se pudo. */
  e164: string | null
  /** Por qué no se pudo, para poder auditarlo. */
  motivo?: 'vacio' | 'muy_corto' | 'muy_largo' | 'area_invalida'
  /** Lo que había cargado, tal cual, para poder corregirlo a mano. */
  original: string
}

/**
 * Los códigos de área argentinos tienen 2, 3 o 4 dígitos, y el número de
 * abonado completa 10 en total (sin el 9 ni el 15). Un móvil argentino
 * marcado desde el exterior es: 54 + 9 + (área + abonado) = 13 dígitos.
 */
const LARGO_NACIONAL = 10
const PAIS = '54'

/** Áreas que empiezan así son las únicas válidas en Argentina. */
const PREFIJOS_VALIDOS = ['11', '2', '3']

export function normalizarTelefonoAr(entrada?: string | null): TelefonoNormalizado {
  const original = (entrada ?? '').trim()
  // Sólo dígitos: se van +, espacios, guiones, paréntesis y puntos.
  let d = original.replace(/\D/g, '')

  if (!d) return { e164: null, motivo: 'vacio', original }

  // Prefijo internacional marcado como 00.
  if (d.startsWith('00')) d = d.slice(2)
  // País ya presente.
  if (d.startsWith(PAIS)) d = d.slice(PAIS.length)
  // El 9 de móvil, si ya venía. Se vuelve a agregar al final: normalizar es
  // llevar todo a UNA forma, no conservar la que vino.
  if (d.length > LARGO_NACIONAL && d.startsWith('9')) d = d.slice(1)
  // Cero inicial de larga distancia nacional: 0379... → 379...
  if (d.startsWith('0')) d = d.slice(1)

  // El 15 va DESPUÉS del área y sólo en marcación local. Se quita únicamente
  // si sacarlo deja el largo correcto: hay áreas que empiezan con 15 y
  // borrarlo a ciegas rompería esos números.
  if (d.length === LARGO_NACIONAL + 2) {
    for (const corte of [2, 3, 4]) {
      if (d.slice(corte, corte + 2) === '15' && d.length - 2 === LARGO_NACIONAL) {
        d = d.slice(0, corte) + d.slice(corte + 2)
        break
      }
    }
  }

  if (d.length < LARGO_NACIONAL) return { e164: null, motivo: 'muy_corto', original }
  if (d.length > LARGO_NACIONAL) return { e164: null, motivo: 'muy_largo', original }
  if (!PREFIJOS_VALIDOS.some(p => d.startsWith(p))) {
    return { e164: null, motivo: 'area_invalida', original }
  }

  return { e164: `${PAIS}9${d}`, original }
}

/** "+54 9 379 4123456", para mostrarle a una persona qué número se va a usar. */
export function mostrarTelefono(e164: string): string {
  if (!e164.startsWith('549') || e164.length !== 13) return e164
  const n = e164.slice(3)
  return `+54 9 ${n.slice(0, 3)} ${n.slice(3)}`
}
