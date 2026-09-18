/**
 * /api/afip/wsccomu-spike — PRUEBA TÉCNICA controlada de WSCCOMU (veconsumerws).
 *
 * Herramienta temporal (NO va al menú): sólo administración/gerencia. Permite
 * correr las operaciones de Ventanilla Electrónica / DFE para determinar si la
 * comunicación de "Relaciones Laborales Activas" puede leerse por web service y
 * si trae adjunto con la nómina. Reutiliza WSAA/TA existente.
 *
 * Uso (GET, con Bearer del usuario):
 *   ?op=dummy
 *   ?op=sistemas
 *   ?op=comunicaciones&fechaDesde=2026-09-01&conAdjunto=1
 *   ?op=consumir&id=<idComunicacion>[&full=1]
 *   &cuit=30710705417   (cuitRepresentada; por defecto AFIP_CUIT_REPRESENTADA)
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin, requireCapacidad } from '../../_lib/employee-auth'
import { afipConfigDesdeEnv } from '@/lib/afip/config'
import { obtenerTA } from '@/lib/afip/wsaa'
import { taStoreSupabase } from '@/lib/afip/ta-store-supabase'
import {
  SERVICIO_WSCCOMU, dummy, consultarSistemasPublicadores, consultarComunicaciones, consumirComunicacion,
} from '@/lib/afip/wsccomu'

export const runtime = 'nodejs'
export const maxDuration = 60
export const fetchCache = 'force-no-store'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const denegado = await requireCapacidad(req, admin.client, 'gestionar_personal')
  if (denegado) return denegado

  const cfg = afipConfigDesdeEnv()
  if (cfg.error || !cfg.config) return NextResponse.json({ error: cfg.error }, { status: 400 })

  const q = req.nextUrl.searchParams
  const op = q.get('op') || 'dummy'
  const cuit = (q.get('cuit') || cfg.config.cuitRepresentada).replace(/\D/g, '')

  // dummy no necesita TA.
  if (op === 'dummy') return NextResponse.json({ op, resultado: await dummy() })

  // El resto necesita TA de veconsumerws. Si WSAA rechaza (servicio no
  // autorizado al computador fiscal), se devuelve el error tal cual, SIN rodearlo.
  let ta
  try {
    ta = await obtenerTA(SERVICIO_WSCCOMU, cfg.config, taStoreSupabase(admin.client))
  } catch (e: any) {
    return NextResponse.json({ op, cuit, error: `WSAA (${SERVICIO_WSCCOMU}): ${e?.message || e}`, hint: 'Probablemente falta autorizar veconsumerws al computador fiscal en el Administrador de Relaciones.' }, { status: 502 })
  }

  if (op === 'sistemas') {
    return NextResponse.json({ op, cuit, resultado: await consultarSistemasPublicadores(ta, cuit) })
  }

  if (op === 'comunicaciones') {
    const fechaDesde = q.get('fechaDesde') || new Date(Date.now() - 30 * 864e5).toISOString().slice(0, 10)
    const r = await consultarComunicaciones(ta, cuit, {
      fechaDesde,
      fechaHasta: q.get('fechaHasta') || undefined,
      sistemaPublicadorId: q.get('sistema') || undefined,
      tieneAdjunto: q.get('conAdjunto') === '1' ? true : undefined,
      pagina: q.get('pagina') ? Number(q.get('pagina')) : 1,
      resultadosPorPagina: q.get('porPagina') ? Number(q.get('porPagina')) : undefined,
    })
    return NextResponse.json({ op, cuit, fechaDesde, resultado: r })
  }

  if (op === 'consumir') {
    const id = q.get('id')
    if (!id) return NextResponse.json({ error: 'Falta ?id=<idComunicacion>' }, { status: 400 })
    const r = await consumirComunicacion(ta, cuit, id, true)
    // Por defecto NO devolvemos el base64 completo (puede ser enorme): metadata +
    // preview. Con ?full=1 se incluye el contenido para bajarlo.
    if (r.ok && q.get('full') !== '1') {
      r.comunicacion.adjuntos = r.comunicacion.adjuntos.map(a => {
        const preview = a.contentBase64 ? previewTexto(a.contentBase64) : undefined
        const { contentBase64, ...resto } = a
        return { ...resto, preview } as any
      })
    }
    return NextResponse.json({ op, cuit, id, resultado: r })
  }

  return NextResponse.json({ error: `op desconocida: ${op}`, ops: ['dummy', 'sistemas', 'comunicaciones', 'consumir'] }, { status: 400 })
}

/** Primeros ~800 caracteres del adjunto decodificado, si parece texto. */
function previewTexto(base64: string): string {
  try {
    const buf = Buffer.from(base64, 'base64')
    const txt = buf.slice(0, 800).toString('utf8')
    const imprimibles = txt.replace(/[^\x09\x0a\x0d\x20-\x7e\xa0-\xff]/g, '').length
    if (imprimibles / Math.max(txt.length, 1) > 0.7) return txt
    return `[binario, ${buf.length} bytes]`
  } catch { return '[no decodificable]' }
}
