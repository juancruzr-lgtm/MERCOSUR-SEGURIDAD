// Prueba controlada del WhatsApp al VIGILADOR (template `ronda_pendiente_vigilador`).
//
// Manda UN mensaje al número indicado para ver cómo llega —con su botón de URL—
// sin seleccionar candidatos, sin leer la base y sin auditar. No toca el
// escalamiento a supervisores, ni el push, ni el cron. Es la versión "vigilador"
// del endpoint de prueba de supervisores (escalamiento-whatsapp/prueba).
//
// Autorización: SOLO el cron secret (Bearer push_cron_secret / CRON_SECRET), igual
// que el de supervisores. No hay ruta por sesión de navegador: un WhatsApp real
// nunca sale de un clic sin el secreto del servidor.

import { NextResponse } from 'next/server'
import { proveedorPorDefecto } from '@/lib/whatsapp'
import { normalizarTelefonoAr } from '@/lib/telefono-ar'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const secreto = process.env.push_cron_secret || process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  if (!secreto || auth !== `Bearer ${secreto}`) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
  }

  // Número de prueba: por defecto el del solicitante; se puede pasar ?telefono=.
  const url = new URL(req.url)
  const crudo = url.searchParams.get('telefono') || '3413914544'
  const tel = normalizarTelefonoAr(crudo)
  if (!tel.e164) {
    return NextResponse.json({ error: `Telefono de prueba invalido: ${tel.motivo}` }, { status: 400 })
  }

  const proveedor = proveedorPorDefecto()
  if (!proveedor.configurado) {
    return NextResponse.json({ error: 'Proveedor WhatsApp no configurado' }, { status: 503 })
  }

  // Mismo contrato que el endpoint real: 3 variables de cuerpo + botón de URL
  // dinámica (índice 0). Valores de ejemplo; el deep link va a un id inexistente
  // (TEST) a propósito: la app abre el dashboard y no encuentra ronda, inocuo.
  // El sufijo arranca con `?` porque el template quedó con la URL base sin `?`
  // (`.../dashboard{{1}}`). Cuando se corrija el template, quitar el `?` (ver el
  // endpoint real).
  const plantilla = process.env.WHATSAPP_PLANTILLA_RONDA_VIGILADOR || 'ronda_pendiente_vigilador'
  const resultado = await proveedor.enviar({
    telefono: tel.e164,
    plantilla,
    variables: ['DEPOSITO CENTRAL', 'Ronda perimetral', '06:00'],
    boton: { urlSuffix: '?ronda=TEST&turno=TEST&objetivo=TEST&ventana=0' },
  })

  return NextResponse.json({
    prueba: true,
    plantilla,
    telefonoUltimos4: tel.e164.slice(-4),
    ok: resultado.ok,
    idProveedor: resultado.idProveedor ?? null,
    error: resultado.error ?? null,
  }, { status: resultado.ok ? 200 : 502 })
}
