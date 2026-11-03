// Importaciones en revisión:
//   tipo=arca     → CSV (o ZIP con el CSV) de "Mis Comprobantes – Emitidos".
//   tipo=extracto → extracto bancario CSV de la cuenta indicada.
// El hash se calcula sobre el CSV: copias del mismo ZIP no se multiplican.
import type { NextRequest } from 'next/server'
import { clientesDelPedido } from '@/app/api/documentacion/_clientes'
import { cuentaEnExtracto, leerCsvArcaEmitidos, leerExtracto } from '@/lib/facturacion/importadores'
import { CUIT_EMPRESA, errorRpc, responder, sha256Hex } from '../_comun'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function decodificar(bytes: Uint8Array): string {
  const utf8 = new TextDecoder('utf-8').decode(bytes)
  return utf8.includes('�') ? new TextDecoder('windows-1252').decode(bytes) : utf8
}

async function csvDe(archivo: File): Promise<{ nombre: string; bytes: Uint8Array }[]> {
  const bytes = new Uint8Array(await archivo.arrayBuffer())
  if (!/\.zip$/i.test(archivo.name)) return [{ nombre: archivo.name, bytes }]
  const JSZip = (await import('jszip')).default
  const zip = await JSZip.loadAsync(bytes)
  const out: { nombre: string; bytes: Uint8Array }[] = []
  for (const f of Object.values(zip.files)) {
    if (!f.dir && /\.csv$/i.test(f.name)) out.push({ nombre: f.name, bytes: await f.async('uint8array') })
  }
  return out
}

export async function POST(req: NextRequest) {
  const c = await clientesDelPedido(req)
  if ('error' in c) return responder({ error: c.error }, c.status)
  const { data: puede } = await c.usuario.rpc('facturacion_puede_actual')
  if (!puede) return responder({ error: 'Sólo Gerencia o Administración' }, 403)
  const form = await req.formData().catch(() => null)
  const archivo = form?.get('archivo')
  const tipo = String(form?.get('tipo') ?? '')
  if (!(archivo instanceof File)) return responder({ error: 'Falta el archivo' }, 400)
  if (archivo.size > 20 * 1024 * 1024) return responder({ error: 'El archivo supera 20 MB' }, 400)
  let csvs: { nombre: string; bytes: Uint8Array }[]
  try { csvs = await csvDe(archivo) } catch { return responder({ error: 'No se pudo abrir el ZIP' }, 400) }
  if (csvs.length !== 1) return responder({ error: `Se esperaba un CSV y hay ${csvs.length}` }, 400)
  const { nombre, bytes } = csvs[0]
  const sha = await sha256Hex(bytes)
  const texto = decodificar(bytes)

  if (tipo === 'arca') {
    const l = leerCsvArcaEmitidos(texto)
    if (!l.filas.length) return responder({ error: 'No se leyó ningún comprobante', errores: l.errores }, 400)
    const { data, error } = await c.usuario.rpc('fact_importacion_arca_crear', { p_nombre: nombre, p_sha256: sha, p_documento_id: null, p_filas: l.filas })
    if (error) return errorRpc(error)
    return responder({ ...(data as object), leidas: l.filas.length, repetidas_en_archivo: l.repetidas, errores: l.errores })
  }
  if (tipo === 'extracto') {
    const cuentaId = String(form?.get('cuenta_id') ?? '').trim()
    if (!cuentaId) return responder({ error: 'Elegí la cuenta bancaria' }, 400)
    const { data: cuenta } = await c.usuario.from('fact_cuentas_bancarias').select('id, banco, numero').eq('id', cuentaId).maybeSingle()
    if (!cuenta) return responder({ error: 'Cuenta bancaria inexistente o sin acceso' }, 400)
    // Un extracto de otra cuenta no se mezcla: si el nombre o el encabezado traen un número de cuenta, tiene que ser éste.
    const numeroEnArchivo = cuentaEnExtracto(`${archivo.name}\n${texto.slice(0, 600)}`)
    const propia = String(cuenta.numero).replace(/\D/g, '')
    if (numeroEnArchivo && !numeroEnArchivo.includes(propia) && !propia.includes(numeroEnArchivo)) {
      return responder({ error: `El archivo parece de la cuenta ${numeroEnArchivo}, no de ${cuenta.numero}` }, 400)
    }
    const l = leerExtracto(texto, CUIT_EMPRESA)
    if (!l.filas.length) return responder({ error: 'No se leyó ningún movimiento', errores: l.errores }, 400)
    const { data, error } = await c.usuario.rpc('fact_extracto_importar', { p_cuenta_id: cuentaId, p_nombre: nombre, p_sha256: sha, p_documento_id: null, p_filas: l.filas })
    if (error) return errorRpc(error)
    return responder({ ...(data as object), errores: l.errores })
  }
  return responder({ error: 'Tipo de importación inválido' }, 400)
}
