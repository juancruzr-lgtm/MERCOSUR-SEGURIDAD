// lib/cuenta-banco.ts
//
// El batch de Galicia acredita a CUENTAS de Galicia (numéricas, hasta ~14 dígitos).
// Un CBU (22 dígitos) o cuenta de otro banco NO se puede acreditar por ese archivo
// → se deja afuera y se avisa para pagarla por separado. (Caso ALMARA: CBU 072…)
export const esCuentaGalicia = (c: string): boolean => /^\d{6,18}$/.test(c) && c.length !== 22
