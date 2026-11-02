// Hoja de ruta de cierre de turno de supervisores: generación y envío de UN
// mensaje de WhatsApp por destinatario (inicialmente Aldo Monzón y Rodolfo
// Romero; los define Gerencia).
//
// ── NO es una alerta ─────────────────────────────────────────────────────────
// No comparte ruta, tablas, plantillas ni lógica con el escalamiento de puesto
// descubierto ni con las rondas.
//
// ── Cuándo ───────────────────────────────────────────────────────────────────
// Cada guardia de supervisor (supervisores_guardia), al pasar su fin (cruza
// medianoche si corresponde) más el margen de cierre (app_config.
// hoja_ruta_margen_cierre_min, 30). Una sola hoja por guardia (unique) y queda
// congelada: lo que se cargue después no dispara otro envío.
//
// ── Envío (app_config.hoja_ruta_modo) ────────────────────────────────────────
//   desactivado (por defecto): genera y guarda; no envía.
//   prueba:      solo a hoja_ruta_destinatario_prueba.
//   automatico:  a hoja_ruta_destinatarios activos.
// Si el mensaje supera el límite de Meta no se manda (ni recortado ni en
// partes): la hoja queda con envio_bloqueado = 'excede_longitud'.
// Antes de llamar a Meta se reserva el intento; la base no admite dos intentos
// vivos/enviados/inciertos por hoja y destinatario. Sin respuesta de Meta →
// 'incierto', que no se reintenta solo. Máximo 3 intentos.
//
// ── Por defecto NO escribe ni envía ─────────────────────────────────────────
// Sin `?enviar=1` es una vista previa (admin). Con `?enviar=1`, solo el cron
// con su secreto. `?guardia_id=` muestra la vista previa de una guardia.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../_lib/employee-auth'
import { normalizarTelefonoAr } from '@/lib/telefono-ar'
import { proveedorPorDefecto, proveedorSimulado } from '@/lib/whatsapp'
import {
  PLANTILLA_HOJA_RUTA, actividadSinGuardia, armarHojaRuta, leerModo, listaParaGenerar, mensajeWhatsApp,
  planEnvios, textoHojaRuta,
} from '@/lib/hoja-ruta'
import { cargarDatosHojaRuta, guardiaCubre, ventanaGuardia, type GuardiaSupervisorFila } from '@/lib/hoja-ruta-datos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'
export const maxDuration = 60

const PLANTILLA = process.env.WHATSAPP_PLANTILLA_HOJA_RUTA || PLANTILLA_HOJA_RUTA
/** Pasado esto desde el fin, la guardia ya no se procesa (no se manda una hoja vieja). */
const VENTANA_HORAS = 8

export async function GET(req: Request) {
  const url = new URL(req.url)
  const enviarDeVerdad = url.searchParams.get('enviar') === '1'
  const guardiaPuntual = url.searchParams.get('guardia_id')

  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })
  const db = admin.client

  // ── Autorización: cron con secreto; un admin solo en vista previa ─────────
  const secreto = process.env.push_cron_secret || process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const esCron = Boolean(secreto) && auth === `Bearer ${secreto}`
  if (!esCron) {
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!token) return NextResponse.json({ error: 'Sesión requerida' }, { status: 401 })
    const { data: authData, error: authError } = await db.auth.getUser(token)
    if (authError || !authData.user) return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 })
    const { data: u } = await db.from('usuarios').select('id, rol, estado').eq('auth_user_id', authData.user.id).maybeSingle()
    if (!u || u.estado !== 'activo' || u.rol !== 'admin') return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    if (enviarDeVerdad) return NextResponse.json({ error: 'El envío real sólo se dispara desde el cron con su secreto' }, { status: 403 })
  }

  // ── Configuración ──────────────────────────────────────────────────────────
  const cfgRes = await db.from('app_config').select('key, value')
    .in('key', ['hoja_ruta_modo', 'hoja_ruta_destinatario_prueba', 'hoja_ruta_margen_cierre_min'])
  if (cfgRes.error) return NextResponse.json({ error: `app_config: ${cfgRes.error.message}` }, { status: 502 })
  const cfg = new Map<string, string>((cfgRes.data ?? []).map((r: any) => [r.key, r.value]))
  const modo = leerModo(cfg.get('hoja_ruta_modo'))
  const destinatarioPrueba = (cfg.get('hoja_ruta_destinatario_prueba') || '').trim() || null
  const margenMin = Math.min(180, Math.max(10, Number(cfg.get('hoja_ruta_margen_cierre_min')) || 30))

  // ── Guardias terminadas ───────────────────────────────────────────────────
  const ahora = Date.now()
  const hoy = new Date(ahora - 3 * 3600_000).toISOString().slice(0, 10)
  const ayer = new Date(ahora - 27 * 3600_000).toISOString().slice(0, 10)
  const sel = 'id, supervisor_id, supervisor_original_id, fecha, hora_inicio, hora_fin, zona, estado, tipo_evento, rol_operativo'
  const gRes = guardiaPuntual
    ? await db.from('supervisores_guardia').select(sel).eq('id', guardiaPuntual)
    : await db.from('supervisores_guardia').select(sel).in('fecha', [ayer, hoy])
  if (gRes.error) return NextResponse.json({ error: `supervisores_guardia: ${gRes.error.message}` }, { status: 502 })
  const todas = (gRes.data ?? []) as GuardiaSupervisorFila[]
  const guardias = todas.filter(g => guardiaCubre(g) && (guardiaPuntual ? true : listaParaGenerar(ventanaGuardia(g).fin, ahora, margenMin, VENTANA_HORAS)))

  // Supervisiones de las últimas 24 h sin guardia registrada: no se inventa una
  // hoja; se informa para que Administración corrija la programación.
  let sinGuardia: string[] = []
  if (!guardiaPuntual) {
    const sRes = await db.from('supervisiones').select('supervisor_id, created_at')
      .gte('created_at', new Date(ahora - 24 * 3600_000).toISOString())
    if (!sRes.error) {
      sinGuardia = actividadSinGuardia(sRes.data ?? [], todas.filter(guardiaCubre).map(g => ({ supervisor_id: g.supervisor_id, ...ventanaGuardia(g) })))
    }
  }

  const proveedor = enviarDeVerdad ? proveedorPorDefecto() : proveedorSimulado()
  const resultados: any[] = []

  for (const g of guardias) {
    const fila: any = { guardia_id: g.id, supervisor_id: g.supervisor_id }
    try {
      let hojaId: string
      let variables: string[]
      let bloqueado: string | null

      // Si ya existe, NO se regenera: se usa la congelada.
      const previa = enviarDeVerdad
        ? await db.from('hojas_ruta').select('id, mensaje_variables, envio_bloqueado').eq('supervisor_guardia_id', g.id).maybeSingle()
        : { data: null, error: null }
      if (previa.error) throw new Error(`hojas_ruta: ${previa.error.message}`)

      if (previa.data) {
        hojaId = previa.data.id
        variables = previa.data.mensaje_variables
        bloqueado = previa.data.envio_bloqueado
      } else {
        const datos = await cargarDatosHojaRuta(db, g)
        const contenido = armarHojaRuta(datos)
        const texto = textoHojaRuta(contenido)
        const m = mensajeWhatsApp(contenido)
        variables = m.variables
        bloqueado = m.bloqueado
        fila.texto = texto
        fila.mensaje = m.mensaje
        fila.longitud = m.longitud
        fila.bloqueado = m.bloqueado
        if (!enviarDeVerdad) { resultados.push(fila); continue }
        // Unique por guardia: si otra corrida la generó primero, gana esa.
        const ins = await db.from('hojas_ruta').upsert({
          supervisor_guardia_id: g.id, supervisor_id: g.supervisor_id, fecha: g.fecha,
          inicio: datos.guardia.inicio, fin: datos.guardia.fin, contenido, texto,
          mensaje: m.mensaje, mensaje_variables: m.variables, mensaje_longitud: m.longitud, envio_bloqueado: m.bloqueado,
        }, { onConflict: 'supervisor_guardia_id', ignoreDuplicates: true }).select('id')
        if (ins.error) throw new Error(`hojas_ruta insert: ${ins.error.message}`)
        if (!ins.data || ins.data.length === 0) { fila.omitida = 'generada por otra corrida'; resultados.push(fila); continue }
        hojaId = ins.data[0].id
        fila.generada = true
      }
      fila.hoja_id = hojaId

      if (modo === 'desactivado') { fila.envios = 'modo desactivado: no se envía'; resultados.push(fila); continue }
      if (bloqueado) { fila.envios = 'pendiente por longitud: supera el límite de Meta; completa en la app'; resultados.push(fila); continue }

      const [destRes, prevRes] = await Promise.all([
        db.from('hoja_ruta_destinatarios').select('usuario_id').eq('activo', true),
        db.from('hoja_ruta_envios').select('destinatario_id, estado, intento').eq('hoja_id', hojaId),
      ])
      if (destRes.error) throw new Error(`destinatarios: ${destRes.error.message}`)
      if (prevRes.error) throw new Error(`envíos previos: ${prevRes.error.message}`)
      const plan = planEnvios(modo, (destRes.data ?? []).map((d: any) => d.usuario_id), destinatarioPrueba, prevRes.data ?? [], bloqueado)
      fila.envios = []
      if (plan.length === 0) { resultados.push(fila); continue }

      const telRes = await db.from('usuarios').select('id, telefono, estado').in('id', plan.map(p => p.destinatario_id))
      if (telRes.error) throw new Error(`teléfonos: ${telRes.error.message}`)
      const tels = new Map<string, any>((telRes.data ?? []).map((u: any) => [u.id, u]))

      for (const p of plan) {
        const u = tels.get(p.destinatario_id)
        const tel = normalizarTelefonoAr(u?.estado === 'activo' ? u?.telefono : null)
        const base = { hoja_id: hojaId, destinatario_id: p.destinatario_id, intento: p.intento, modo, plantilla: PLANTILLA, proveedor: proveedor.nombre }
        if (!tel.e164) {
          await db.from('hoja_ruta_envios').insert({ ...base, telefono: null, estado: 'sin_telefono',
            error: `teléfono no válido o faltante (${tel.motivo ?? 'sin dato'}): pendiente de configuración`, terminado_at: new Date().toISOString() })
          fila.envios.push({ destinatario_id: p.destinatario_id, resultado: 'sin_telefono' })
          continue
        }
        // Reserva ANTES de llamar a Meta. Si otra corrida ya reservó, la base
        // lo rechaza (unique) y acá no se manda nada.
        const reserva = await db.from('hoja_ruta_envios').insert({ ...base, telefono: tel.e164, estado: 'enviando' }).select('id').single()
        if (reserva.error) { fila.envios.push({ destinatario_id: p.destinatario_id, resultado: 'omitido (reservado por otra corrida)' }); continue }

        let estado: 'enviado' | 'error' | 'incierto'
        let r: { ok: boolean; idProveedor?: string; error?: string; sinRespuesta?: boolean }
        if (!proveedor.configurado) r = { ok: false, error: 'WhatsApp sin configurar' }
        else r = await proveedor.enviar({ telefono: tel.e164, plantilla: PLANTILLA, variables })
        estado = r.ok ? 'enviado' : r.sinRespuesta ? 'incierto' : 'error'
        await db.from('hoja_ruta_envios').update({
          estado, id_proveedor: r.idProveedor ?? null, error: r.error ?? null, terminado_at: new Date().toISOString(),
        }).eq('id', reserva.data.id)
        fila.envios.push({ destinatario_id: p.destinatario_id, intento: p.intento, resultado: estado, error: r.error })
      }
    } catch (e) {
      fila.error = e instanceof Error ? e.message : String(e)
    }
    resultados.push(fila)
  }

  // Un intento que quedó 'enviando' más de 15 minutos (la función se cortó)
  // pasa a 'incierto': no se reintenta solo, para no repetir mensajes.
  if (enviarDeVerdad) {
    await db.from('hoja_ruta_envios').update({ estado: 'incierto', error: 'el envío quedó a medias; revisar antes de reenviar' })
      .eq('estado', 'enviando').lt('created_at', new Date(ahora - 15 * 60_000).toISOString())
  }

  return NextResponse.json({
    modo: enviarDeVerdad ? 'GENERACION_Y_ENVIO' : 'VISTA_PREVIA',
    hoja_ruta_modo: modo,
    margen_cierre_min: margenMin,
    destinatario_prueba_configurado: Boolean(destinatarioPrueba),
    plantilla: PLANTILLA,
    proveedor: proveedor.nombre,
    guardias: guardias.length,
    supervisores_con_actividad_sin_guardia: sinGuardia,
    resultados,
  })
}
