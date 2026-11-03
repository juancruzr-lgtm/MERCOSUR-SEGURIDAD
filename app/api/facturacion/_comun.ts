/**
 * Utilidades comunes de las rutas de Facturación. Lectura y escritura con la
 * identidad de quien llama (RLS + RPC con gate); service_role sólo para
 * Storage y el ciclo ARCA.
 */
import { NextResponse } from 'next/server'
import { SIN_CACHE } from '@/app/api/documentacion/_clientes'

export const CUIT_EMPRESA = '30710705417'

export function responder(cuerpo: unknown, status = 200) {
  return NextResponse.json(cuerpo, { status, headers: SIN_CACHE })
}

/** 403 cuando el gate de la base rechaza; 409 conflicto de versión; 400 el resto. */
export function errorRpc(error: { message?: string; code?: string } | null | undefined, porDefecto = 'No se pudo completar') {
  const msg = error?.message ?? porDefecto
  const status = error?.code === '42501' || /Gerencia o Administración/.test(msg) ? 403 : error?.code === '40001' ? 409 : 400
  return responder({ error: msg }, status)
}

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(Buffer.from(bytes as ArrayBuffer)).digest('hex')
}
