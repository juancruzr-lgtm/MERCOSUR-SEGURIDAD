// Edición de empleados sin pérdida de datos (defecto encontrado el 05/11/2026).
//
// CAUSA: varias respuestas traen la fila del empleado INCOMPLETA (por ejemplo
// /api/sync-auth-emails, que corre sola al abrir Guardias, devuelve 12 columnas
// sin cuenta_bancaria, cuil ni legajo_visual). La pantalla reemplazaba la fila
// completa por esa versión parcial; al editar, el formulario arrancaba con esos
// campos vacíos y el guardado mandaba TODOS los campos, así que los "vacíos"
// borraban en la base el CBU, el CUIL y el legajo de Visual.
//
// CORRECCIÓN, en tres capas:
//   1. fusionarFila / fusionarLista: una respuesta parcial sólo pisa las columnas
//      que trae; nunca borra las que no trae.
//   2. cambiosDeFormulario: al editar se envía sólo lo que el usuario cambió
//      respecto de lo que se le mostró. "No cargado" y "sin cambios" no viajan.
//   3. protegerVaciadoReservado (servidor): vaciar CBU, CUIL o legajo de Visual
//      que tienen valor exige confirmarlo explícitamente (confirmar_vaciar).

/** Datos de liquidación: no se vacían por accidente. */
export const CAMPOS_RESERVADOS = ['cuenta_bancaria', 'cuil', 'legajo_visual'] as const
export type CampoReservado = (typeof CAMPOS_RESERVADOS)[number]

type Fila = { id: string } & Record<string, unknown>

const texto = (v: unknown): string => (v == null ? '' : String(v).trim())

/**
 * Fila completa + versión parcial → fila completa actualizada. Sólo se toman de
 * `parcial` las claves que trae con valor definido; lo que no trae se conserva.
 */
export function fusionarFila<T extends Fila>(previa: T | null | undefined, parcial: Partial<T> | null | undefined): T {
  const base = (previa ?? {}) as T
  if (!parcial) return base
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(parcial)) if (v !== undefined) out[k] = v
  return out as T
}

/**
 * Lista actual + lista parcial (respuesta de una sincronización): cada fila se
 * fusiona por id; las que la respuesta no trae se conservan (antes se perdían) y
 * las nuevas se agregan al final.
 */
export function fusionarLista<T extends Fila>(actual: T[], parciales: Array<Partial<T> & { id: string }> | null | undefined): T[] {
  if (!Array.isArray(parciales)) return actual
  const porId = new Map(parciales.filter(p => p && p.id).map(p => [p.id, p]))
  const vistos = new Set<string>()
  const out = actual.map(f => {
    const p = porId.get(f.id)
    if (!p) return f
    vistos.add(f.id)
    return fusionarFila(f, p as Partial<T>)
  })
  for (const p of parciales) if (p && p.id && !vistos.has(p.id) && !actual.some(f => f.id === p.id)) out.push(p as T)
  return out
}

export type ValorFormulario = string | boolean | null | undefined

/**
 * Diferencia entre lo que el formulario mostró al abrirse (`inicial`) y lo que
 * tiene al guardar (`actual`). Devuelve sólo los cambios, con el texto recortado
 * (vacío → null), y la lista de campos RESERVADOS que el usuario vació a
 * propósito (tenían valor y ahora están vacíos), para confirmarlos en el servidor.
 */
export function cambiosDeFormulario(
  inicial: Record<string, ValorFormulario>,
  actual: Record<string, ValorFormulario>,
  opciones: { minusculas?: string[] } = {},
): { cambios: Record<string, string | boolean | null>; vaciados: CampoReservado[] } {
  const minus = new Set(opciones.minusculas ?? [])
  const norm = (k: string, v: ValorFormulario) => {
    if (typeof v === 'boolean') return v
    const t = texto(v)
    return minus.has(k) ? t.toLowerCase() : t
  }
  const cambios: Record<string, string | boolean | null> = {}
  const vaciados: CampoReservado[] = []
  for (const k of Object.keys(actual)) {
    const a = norm(k, actual[k])
    const i = norm(k, inicial[k])
    if (a === i) continue
    cambios[k] = typeof a === 'boolean' ? a : (a === '' ? null : a)
    if (a === '' && i !== '' && (CAMPOS_RESERVADOS as readonly string[]).includes(k)) vaciados.push(k as CampoReservado)
  }
  return { cambios, vaciados }
}

/**
 * Servidor: quita del payload el vaciado de un campo reservado que hoy tiene
 * valor, salvo que venga confirmado en `confirmar_vaciar`. Devuelve los campos
 * protegidos para avisarlo en la respuesta.
 */
export function protegerVaciadoReservado(
  payload: Record<string, unknown>,
  actual: Record<string, unknown> | null | undefined,
  confirmados: unknown,
): { payload: Record<string, unknown>; protegidos: CampoReservado[] } {
  const ok = new Set(Array.isArray(confirmados) ? confirmados.map(String) : [])
  const out = { ...payload }
  const protegidos: CampoReservado[] = []
  for (const campo of CAMPOS_RESERVADOS) {
    if (!(campo in out)) continue
    if (texto(out[campo]) !== '') continue
    if (texto(actual?.[campo]) === '') continue
    if (ok.has(campo)) continue
    delete out[campo]
    protegidos.push(campo)
  }
  return { payload: out, protegidos }
}
