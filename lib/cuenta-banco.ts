// lib/cuenta-banco.ts
//
// El batch de Galicia acredita a CUENTAS de Galicia (numéricas, hasta ~14 dígitos).
// Un CBU (22 dígitos) o cuenta de otro banco NO se puede acreditar por ese archivo
// → se deja afuera y se avisa para pagarla por separado. (Caso ALMARA: CBU 072…)
export const esCuentaGalicia = (c: string): boolean => /^\d{6,18}$/.test(c) && c.length !== 22

// Las cuentas de Galicia van en el archivo con 14 dígitos arrancando en «00».
export const LARGO_CUENTA_GALICIA = 14

// Galicia muestra la cuenta en pantalla SIN los ceros a la izquierda (p. ej.
// 407097512209), así que al cargarla queda corta y el archivo de acreditación
// la rechaza por no ir completa a 14 dígitos (00407097512209). Normaliza
// rellenando con ceros a la izquierda SÓLO las cuentas con forma de Galicia que
// quedaron cortas; deja intactos el CBU de 22 dígitos, otros bancos y el vacío.
export function normalizarCuentaGalicia(c: string | null | undefined): string {
  const s = String(c ?? '').trim()
  if (!esCuentaGalicia(s)) return s
  return s.length < LARGO_CUENTA_GALICIA ? s.padStart(LARGO_CUENTA_GALICIA, '0') : s
}
