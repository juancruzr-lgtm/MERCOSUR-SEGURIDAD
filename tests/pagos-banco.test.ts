import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import { escribirBancoXLSX, CONCEPTO_BANCO, type FilaBanco } from '@/lib/pagos-banco'

const rows: FilaBanco[] = [
  { cuenta: '00404906522208', nombre: 'ALMADA, ESTANISLAO', importe: 1378690.86 },
  { cuenta: '00417505691117', nombre: 'BARETTA, FRANCISCO CARLOS', importe: 952971.58 },
]

async function leer(buf: ArrayBuffer) {
  const wb = XLSX.read(new Uint8Array(buf), { type: 'array' })
  const ws = wb.Sheets[wb.SheetNames[0]]
  return { wb, ws, aoa: XLSX.utils.sheet_to_json(ws, { header: 1, raw: true }) as any[][] }
}

describe('escribirBancoXLSX (formato Galicia con Concepto)', () => {
  it('sueldos: encabezado Cuenta|Nombre|Importe|Concepto y Concepto = 1', async () => {
    const { wb, ws, aoa } = await leer(await escribirBancoXLSX(rows, CONCEPTO_BANCO.sueldos))
    expect(wb.SheetNames).toEqual(['Empleados'])
    expect(aoa[0]).toEqual(['Cuenta', 'Nombre', 'Importe', 'Concepto'])
    expect(aoa[1]).toEqual(['00404906522208', 'ALMADA, ESTANISLAO', 1378690.86, 1])
    expect(aoa[2][3]).toBe(1)
    // Cuenta como TEXTO (conserva ceros a la izquierda)
    expect(ws['A2'].t).toBe('s')
    expect(ws['A2'].v).toBe('00404906522208')
    // Importe numérico, Concepto numérico
    expect(ws['C2'].t).toBe('n')
    expect(ws['D2'].t).toBe('n')
  })

  it('extras: Concepto = 11', async () => {
    const { aoa } = await leer(await escribirBancoXLSX(rows, CONCEPTO_BANCO.extras))
    expect(aoa[0][3]).toBe('Concepto')
    expect(aoa[1][3]).toBe(11)
    expect(aoa[2][3]).toBe(11)
  })

  it('CONCEPTO_BANCO: 1 sueldos / 11 extras', () => {
    expect(CONCEPTO_BANCO.sueldos).toBe(1)
    expect(CONCEPTO_BANCO.extras).toBe(11)
  })
})
