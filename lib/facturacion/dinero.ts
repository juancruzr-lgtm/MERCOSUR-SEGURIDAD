/**
 * lib/facturacion/dinero.ts
 *
 * Importes de facturación en CENTAVOS enteros. Nunca se suma ni multiplica
 * con float: las tarifas reales traen muchos decimales (p. ej. 14853,2033…)
 * y un float acumulado sobre cientos de horas corre el centavo.
 *
 * Tratamiento de IVA de una tarifa: es un dato del contrato y se declara
 * explícitamente. `sin_definir` NO se interpreta: el cálculo devuelve error y
 * la prefactura queda con el requisito pendiente.
 */

export type TratamientoIva = 'adicional' | 'incluido' | 'exento' | 'sin_definir'

export const ALICUOTA_IVA_GENERAL = '21'

/** 10^n como bigint (sin `**`: el tsconfig apunta a ES5). */
function pot10(n: number): bigint {
  let r = BigInt(1)
  for (let i = 0; i < n; i++) r *= BigInt(10)
  return r
}

/** Número decimal exacto: valor = entero / 10^escala. */
type Decimal = { entero: bigint; escala: number }

/**
 * Lee un decimal desde number o string. Acepta '14853.2', '14853,20' y el
 * formato argentino con miles '9.776.970,37'. Lanza si no es un número.
 */
export function parseDecimal(valor: number | string): Decimal {
  let s = typeof valor === 'number' ? String(valor) : String(valor ?? '').trim().replace(/\s|\$/g, '')
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) throw new Error(`Importe inválido: ${valor}`)
    // number → notación sin exponente
    if (/e/i.test(s)) s = valor.toFixed(12)
  } else if (s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) {
    s = s.replace(/\./g, '') // '1.000.000' sin decimales
  }
  const m = /^(-?)(\d*)(?:\.(\d*))?$/.exec(s)
  if (!m || (m[2] === '' && (m[3] ?? '') === '')) throw new Error(`Importe inválido: "${valor}"`)
  const dec = m[3] ?? ''
  const entero = BigInt(`${m[1]}${m[2] || '0'}${dec}`)
  return { entero, escala: dec.length }
}

/** Redondeo a `escala` decimales, mitad lejos de cero (criterio de ARCA). */
function redondearA(d: Decimal, escala: number): bigint {
  if (d.escala <= escala) return d.entero * pot10(escala - d.escala)
  const div = pot10(d.escala - escala)
  const neg = d.entero < BigInt(0)
  const abs = neg ? -d.entero : d.entero
  let q = abs / div
  if ((abs % div) * BigInt(2) >= div) q += BigInt(1)
  return neg ? -q : q
}

function multiplicar(a: Decimal, b: Decimal): Decimal {
  return { entero: a.entero * b.entero, escala: a.escala + b.escala }
}

/** Convierte a centavos (redondeando). */
export function aCentavos(valor: number | string): number {
  return Number(redondearA(parseDecimal(valor), 2))
}

/** cantidad × precio unitario, redondeado al centavo. */
export function productoCentavos(cantidad: number | string, precio: number | string): number {
  return Number(redondearA(multiplicar(parseDecimal(cantidad), parseDecimal(precio)), 2))
}

/** centavos × porcentaje (p. ej. '21' o '10.5'), redondeado al centavo. */
export function porcentajeCentavos(centavos: number, porcentaje: number | string): number {
  const p = parseDecimal(porcentaje)
  const prod: Decimal = { entero: BigInt(centavos) * p.entero, escala: p.escala + 2 }
  return Number(redondearA(prod, 0))
}

export type Importes = { neto: number; iva: number; total: number }

export type ResultadoImporte =
  | { ok: true; importes: Importes }
  | { ok: false; motivo: string }

/**
 * Neto / IVA / total a partir de un importe bruto ya calculado en centavos
 * (horas × tarifa, o abono), según cómo esté declarada la tarifa.
 */
export function desglosarIva(
  brutoCentavos: number,
  tratamiento: TratamientoIva,
  alicuota: number | string = ALICUOTA_IVA_GENERAL,
): ResultadoImporte {
  switch (tratamiento) {
    case 'adicional': {
      const iva = porcentajeCentavos(brutoCentavos, alicuota)
      return { ok: true, importes: { neto: brutoCentavos, iva, total: brutoCentavos + iva } }
    }
    case 'incluido': {
      // neto = total / (1 + alícuota/100), redondeado; el IVA es la diferencia
      // para que neto + iva == total sin perder el centavo.
      const a = parseDecimal(alicuota)
      const den = pot10(a.escala) * BigInt(100) + a.entero
      const num = BigInt(brutoCentavos) * pot10(a.escala) * BigInt(100)
      const neto = Number(redondearA({ entero: (num * BigInt(1000)) / den, escala: 3 }, 0))
      return { ok: true, importes: { neto, iva: brutoCentavos - neto, total: brutoCentavos } }
    }
    case 'exento':
      return { ok: true, importes: { neto: brutoCentavos, iva: 0, total: brutoCentavos } }
    case 'sin_definir':
    default:
      return { ok: false, motivo: 'La tarifa no declara si el IVA está incluido o es adicional.' }
  }
}

export function sumarImportes(lista: Importes[]): Importes {
  return lista.reduce(
    (acc, x) => ({ neto: acc.neto + x.neto, iva: acc.iva + x.iva, total: acc.total + x.total }),
    { neto: 0, iva: 0, total: 0 },
  )
}

/** '9.776.970,37' para mostrar. */
export function formatoPesos(centavos: number): string {
  const neg = centavos < 0
  const abs = Math.abs(centavos)
  const ent = Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const dec = String(abs % 100).padStart(2, '0')
  return `${neg ? '-' : ''}$ ${ent},${dec}`
}

/** Centavos a string decimal con punto ('9776970.37') para ARCA / SQL numeric. */
export function centavosADecimal(centavos: number): string {
  const neg = centavos < 0
  const abs = Math.abs(centavos)
  return `${neg ? '-' : ''}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
}

/** minutos × precio por HORA, en centavos, sin pasar por horas en float (7 h 20 min no es 7,333…). */
export function importePorMinutos(minutos: number, precioHora: number | string): number {
  if (!Number.isInteger(minutos) || minutos < 0) throw new Error(`Minutos inválidos: ${minutos}`)
  const p = parseDecimal(precioHora)
  // minutos/60 × precio, llevado a centavos: minutos × entero × 100 / (60 × 10^escala)
  const num = BigInt(minutos) * p.entero * BigInt(100) * BigInt(1000)
  const den = BigInt(60) * pot10(p.escala)
  return Number(redondearA({ entero: num / den, escala: 3 }, 0))
}
