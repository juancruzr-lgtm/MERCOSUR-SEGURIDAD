/**
 * Utilidades comunes de las rutas de Facturación. Lectura y escritura con la
 * identidad de quien llama (RLS + RPC con gate); service_role sólo para
 * Storage y el ciclo ARCA.
 */
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SIN_CACHE } from '@/app/api/documentacion/_clientes'
import { estadoDelPeriodo, motivoBloqueo } from '@/lib/facturacion/periodo-seguro'

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

/** ¿La base no tiene todavía la función? (migración sin aplicar) */
export const faltaFuncion = (error: { message?: string; code?: string } | null | undefined, nombre: string) =>
  Boolean(error) && (error!.code === 'PGRST202' || error!.code === '42883' || (new RegExp(nombre).test(error!.message ?? '') && /(could not find|does not exist|no existe)/i.test(error!.message ?? '')))

/**
 * Seguro de períodos en el servidor: el mes en curso o futuro no admite escrituras de facturación
 * salvo excepción gerencial vigente. La base lo vuelve a imponer con triggers (20261204120000);
 * esto da un 403 claro antes de empezar. Sin la migración aplicada se usa la misma regla, sin excepciones.
 * Devuelve la respuesta de rechazo, o null si se puede escribir.
 */
export async function rechazoPorPeriodo(db: SupabaseClient, mes: string) {
  const { data, error } = await db.rpc('fact_periodo_estado', { p_mes: mes })
  let habilitado: boolean
  if (error && faltaFuncion(error, 'fact_periodo_estado')) habilitado = estadoDelPeriodo(mes) === 'vencido'
  else if (error) return errorRpc(error)
  else habilitado = Boolean((data as any)?.habilitado)
  if (habilitado) return null
  return responder({ error: motivoBloqueo(mes, null) ?? 'Período protegido', codigo: 'periodo_protegido', mes }, 403)
}

export async function sha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const { createHash } = await import('node:crypto')
  return createHash('sha256').update(Buffer.from(bytes as ArrayBuffer)).digest('hex')
}
