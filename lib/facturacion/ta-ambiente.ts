import type { TAStore } from '@/lib/afip/wsaa'

/** El TA de homologación y el de producción no comparten clave en la caché. */
export function storeAmbiente(base: TAStore, homo: boolean): TAStore {
  const k = (s: string) => (homo ? `${s}_homo` : s)
  return { get: s => base.get(k(s)), set: (s, ta) => base.set(k(s), ta) }
}

/** CBU para FCE: vive en fact_config 'emisor' (pantalla Datos del emisor). */
export function cbuFceDe(filas: { clave: string; valor: any }[] | null | undefined): string | null {
  const v = filas?.find(f => f.clave === 'emisor')?.valor?.cbu_fce
  const cbu = typeof v === 'string' ? v.replace(/\D/g, '') : ''
  return cbu.length === 22 ? cbu : null
}
