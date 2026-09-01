// Escalamiento por WhatsApp de puestos descubiertos.
//
// ── Qué hace y qué NO ───────────────────────────────────────────────────────
// NO decide si un puesto está descubierto. Eso ya lo decide `lib/turnos.ts` y
// lo consumen las alertas push, las pantallas y el historial. Esta ruta toma el
// hecho ya determinado y lo escala por otro canal.
//
// ── Modo por defecto: NO ENVÍA ──────────────────────────────────────────────
// Sin `?enviar=1` corre en seco: evalúa todo, resuelve destinatarios, normaliza
// teléfonos, arma los mensajes, y devuelve lo que HABRÍA mandado. Es el modo
// que hay que usar contra producción antes de encender nada.
//
// El envío real además exige que el proveedor esté configurado
// (WHATSAPP_TOKEN y WHATSAPP_PHONE_ID) y que las plantillas estén aprobadas en
// Meta. Si falta cualquiera de las dos cosas, no manda.

import { NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../_lib/employee-auth'
import {
  NIVEL, PLANTILLA, decidir, textoMensaje, variablesDeMensaje, variablesParaPlantilla,
} from '@/lib/escalamiento-descubierto'
import type { ClaveNivel, TurnoEscalable } from '@/lib/escalamiento-descubierto'
import { normalizarTelefonoAr } from '@/lib/telefono-ar'
import { configuracionMeta, proveedorPorDefecto, proveedorSimulado } from '@/lib/whatsapp'
import { nombreResponsablesOperativos, resolverResponsablesOperativos } from '@/lib/responsables-operativos'
import { sumarDiasFecha } from '@/lib/turnos'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Minutos transcurridos desde el inicio del turno, en hora de la operación. */
function minutosDesdeInicio(fecha: string, horaInicio: string, ahora: Date): number {
  // Mismo criterio que el resto de las alertas: el offset se deriva con Intl,
  // no con `new Date(a, m, d)`, que en Vercel corre en UTC y desplaza el día.
  const tz = 'America/Argentina/Buenos_Aires'
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(ahora)
  const g = (t: string) => partes.find(p => p.type === t)?.value ?? '0'
  const hoy = `${g('year')}-${g('month')}-${g('day')}`
  const minutosAhora = Number(g('hour')) * 60 + Number(g('minute'))

  const [hi, mi] = horaInicio.split(':').map(Number)
  const minutosInicio = hi * 60 + mi
  const diaDiff = Math.round(
    (Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${fecha}T00:00:00Z`)) / 86400000,
  )
  return diaDiff * 1440 + minutosAhora - minutosInicio
}

export async function GET(req: Request) {
  const url = new URL(req.url)
  const enviarDeVerdad = url.searchParams.get('enviar') === '1'

  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })
  const client = admin.client

  // ── Autorización ────────────────────────────────────────────────────────
  // SIEMPRE, incluso en simulación. El dry-run devuelve nombres de vigiladores,
  // objetivos y teléfonos normalizados: dejarlo abierto sería publicar la
  // operación entera. Esta ruta usa service_role, que omite RLS, así que el
  // alcance se valida acá o no se valida en ningún lado.
  //
  // Dos formas válidas: el secreto del cron (para pg_cron) o una sesión de
  // admin (para poder correr el dry-run desde el panel).
  const secreto = process.env.push_cron_secret || process.env.CRON_SECRET
  const auth = req.headers.get('authorization') || ''
  const esCron = Boolean(secreto) && auth === `Bearer ${secreto}`

  if (!esCron) {
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
    if (!token) return NextResponse.json({ error: 'Sesión requerida' }, { status: 401 })
    const { data: authData, error: authError } = await client.auth.getUser(token)
    if (authError || !authData.user) {
      return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 })
    }
    const { data: usuario } = await client.from('usuarios')
      .select('id, rol, estado').eq('auth_user_id', authData.user.id).maybeSingle()
    if (!usuario || usuario.estado !== 'activo' || usuario.rol !== 'admin') {
      return NextResponse.json({ error: 'No autorizado' }, { status: 403 })
    }
    // Y un envío REAL sólo lo dispara el cron, nunca una sesión del navegador:
    // un clic accidental no puede mandarle WhatsApp a la dirección.
    if (enviarDeVerdad) {
      return NextResponse.json(
        { error: 'El envío real sólo se dispara desde el cron con su secreto' },
        { status: 403 },
      )
    }
  }
  const ahora = new Date()

  // Sólo los turnos que pueden estar en alguna de las dos ventanas. El rango de
  // fechas cubre el día anterior por los turnos nocturnos.
  const hoy = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(ahora)
  const ayer = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ahora.getTime() - 86400000))

  const [turnosRes, objetivosRes, usuariosRes, registrosRes, destinatariosRes, zonasRes, svRes, puestosRes, guardiasRes] =
    await Promise.all([
      client.from('turnos')
        .select('id, guardia_id, objetivo_id, puesto_id, fecha, hora_inicio, hora_fin, estado')
        .in('fecha', [ayer, hoy]),
      client.from('objetivos').select('id, nombre, estado, es_prueba, zona_id'),
      client.from('usuarios').select('id, nombre, apellido, telefono, rol, estado'),
      client.from('registros_asistencia').select('turno_id, hora_entrada_real'),
      client.from('escalamiento_destinatarios').select('usuario_id, rol_en_escalamiento, activo'),
      // La tabla se llama zonas_operativas. Con el nombre equivocado la consulta
      // devolvía data: null SIN romper, y todos los casos habrían salido como
      // SIN_SUPERVISOR_RESPONSABLE: un dry-run plausible y completamente falso.
      client.from('zonas_operativas').select('id, nombre'),
      client.from('supervisor_zonas').select('supervisor_id, zona_id'),
      client.from('puestos').select('id, nombre'),
      // LA fuente de responsabilidad horaria. Sin esto la resolución sólo puede
      // caer al fallback "responsable único de zona", y una zona con tres
      // supervisores asignados —Rosario— nunca resuelve: devuelve
      // multiples_sin_guardia y el aviso no sale.
      //
      // Desde ayer-1 porque una guardia nocturna arranca un día y cubre la
      // madrugada del siguiente. Mismo rango que usa push.
      client.from('supervisores_guardia')
        .select('supervisor_id, zona, fecha, hora_inicio, hora_fin, estado, tipo_evento, rol_operativo')
        .gte('fecha', sumarDiasFecha(ayer, -1))
        .lte('fecha', hoy),
    ])

  const turnos = (turnosRes.data ?? []) as TurnoEscalable[]
  const objetivos = objetivosRes.data ?? []
  const usuarios = usuariosRes.data ?? []
  const registros = registrosRes.data ?? []
  const zonas = zonasRes.data ?? []
  const supervisorZonas = svRes.data ?? []
  const guardias = (guardiasRes.data ?? []) as any[]
  const puestos = new Map<string, string>(
    ((puestosRes.data ?? []) as any[]).map(p => [p.id, p.nombre]),
  )

  // Una fuente que falla en silencio es peor que una que rompe: el dry-run
  // seguiría dando un resultado con forma correcta y contenido falso. Los
  // errores viajan en la respuesta para que se vean.
  const fuentesConError = [
    ['turnos', turnosRes], ['objetivos', objetivosRes], ['usuarios', usuariosRes],
    ['registros', registrosRes], ['destinatarios', destinatariosRes],
    ['zonas_operativas', zonasRes], ['supervisor_zonas', svRes], ['puestos', puestosRes],
    ['supervisores_guardia', guardiasRes],
  ].filter(([, r]: any) => r?.error).map(([n, r]: any) => `${n}: ${r.error.message}`)

  const nombreDe = (id?: string | null) => {
    const u = usuarios.find((x: any) => x.id === id)
    return u ? `${u.apellido}, ${u.nombre}` : null
  }

  // Ya avisados: se lee la MISMA tabla que usa el push, con la misma clave.
  const yaAvisados = new Set<string>()
  const enviadosRes = await client.from('notificaciones_enviadas')
    .select('usuario_id, turno_id, tipo')
    .in('tipo', [NIVEL.supervisor, NIVEL.operativo])
  for (const n of (enviadosRes.data ?? []) as any[]) {
    yaAvisados.add(`${n.usuario_id}|${n.turno_id}|${n.tipo}`)
  }

  const proveedor = enviarDeVerdad ? proveedorPorDefecto() : proveedorSimulado()
  const acciones: any[] = []
  const descartes: Record<string, number> = {}
  const filasAuditoria: any[] = []

  for (const t of turnos) {
    const objetivo = objetivos.find((o: any) => o.id === t.objetivo_id)
    const min = minutosDesdeInicio(t.fecha, t.hora_inicio, ahora)
    const tieneEntrada = registros.some((r: any) => r.turno_id === t.id && r.hora_entrada_real)

    const d = decidir(t, { objetivo, tieneEntrada, minutosDesdeInicio: min })
    if (!d.escala) {
      if (d.motivo) descartes[d.motivo] = (descartes[d.motivo] ?? 0) + 1
      continue
    }
    const nivel = d.nivel as ClaveNivel

    // ── Destinatarios ──────────────────────────────────────────────────────
    // Nivel 15: el responsable de la zona del objetivo, con LA resolución que
    // ya usan las pantallas. Si no hay responsable único, no se elige a nadie.
    // Nivel 30: la lista configurada.
    let destinatarios: string[] = []
    let motivoSinDestinatario: string | null = null
    let origenResolucion: string | null = null
    let candidatosZona: string[] = []

    if (nivel === NIVEL.supervisor) {
      const r = resolverResponsablesOperativos({
        zonaId: objetivo?.zona_id ?? null,
        // El instante que decide es el INICIO del turno, no "ahora": es el
        // momento en que el puesto tenía que estar cubierto, y es el que hace
        // que a un turno nocturno le responda quien estaba de guardia esa noche.
        fecha: t.fecha,
        hora: t.hora_inicio.slice(0, 5),
        guardias, supervisorZonas, zonas, usuarios,
      })
      // Si cubren varios a la vez, son TODOS responsables: se le manda a cada
      // uno, individualmente, y la deduplicación por (usuario, turno, tipo)
      // impide que alguno reciba dos veces. No se elige el primero.
      destinatarios = r.responsables ?? []
      origenResolucion = r.origen
      if (destinatarios.length === 0) {
        // El motivo importa: `multiples_sin_guardia` significa que falta cargar
        // la guardia de esa zona, y se arregla en Programación. `sin_zona`
        // significa que el objetivo no tiene zona. No son el mismo problema.
        motivoSinDestinatario = r.origen === 'multiples_sin_guardia'
          ? 'VARIOS_RESPONSABLES_SIN_GUARDIA_DEFINIDA'
          : 'SIN_SUPERVISOR_RESPONSABLE'
        candidatosZona = (r.candidatosZona ?? []).map(id => nombreDe(id)).filter(Boolean) as string[]
      }
    } else {
      destinatarios = (destinatariosRes.data ?? [])
        .filter((x: any) => x.activo)
        .map((x: any) => x.usuario_id)
      if (destinatarios.length === 0) motivoSinDestinatario = 'SIN_LISTA_DE_ESCALAMIENTO'
    }

    // El supervisor que NOMBRA el mensaje de 30 sale de la MISMA resolución
    // que decide los destinatarios del 15: la guardia vigente al INICIO del
    // turno, con el fallback al responsable único de zona. Si cubren varios a
    // la vez, se nombran todos — no se elige uno.
    const supervisorNombre = nivel === NIVEL.operativo
      ? nombreResponsablesOperativos({
        zonaId: objetivo?.zona_id ?? null,
        fecha: t.fecha,
        hora: t.hora_inicio.slice(0, 5),
        guardias, supervisorZonas, zonas, usuarios,
      }, nombreDe)
      : null

    const vars = variablesDeMensaje(t, {
      objetivo: objetivo?.nombre, puesto: puestos.get(t.puesto_id ?? '') ?? null,
      vigilador: nombreDe(t.guardia_id), supervisor: supervisorNombre,
    })
    const texto = textoMensaje(nivel, vars)

    if (motivoSinDestinatario) {
      // Se registra y se sigue. El caso sin supervisor llega igual al nivel 30.
      acciones.push({
        turno: t.id, nivel, descartado: motivoSinDestinatario, objetivo: vars.objetivo,
        puesto: vars.puesto, horario: vars.horario, vigilador: vars.vigilador,
        origenResolucion, candidatosZona,
      })
      filasAuditoria.push({
        turno_id: t.id, objetivo_id: t.objetivo_id, puesto_id: t.puesto_id,
        guardia_id: t.guardia_id, nivel, minutos_descubierto: min,
        resultado: motivoSinDestinatario.toLowerCase(), proveedor: proveedor.nombre,
      })
      continue
    }

    for (const usuarioId of Array.from(new Set(destinatarios))) {
      const clave = `${usuarioId}|${t.id}|${nivel}`
      if (yaAvisados.has(clave)) continue

      const u = usuarios.find((x: any) => x.id === usuarioId)
      const tel = normalizarTelefonoAr(u?.telefono)

      if (!tel.e164) {
        // Un número mal cargado no puede cortar la corrida.
        acciones.push({
          turno: t.id, nivel, destinatario: nombreDe(usuarioId),
          descartado: tel.motivo === 'vacio' ? 'SIN_TELEFONO' : 'TELEFONO_INVALIDO',
          telefonoCargado: tel.original,
        })
        filasAuditoria.push({
          turno_id: t.id, objetivo_id: t.objetivo_id, puesto_id: t.puesto_id,
          guardia_id: t.guardia_id, nivel, destinatario_id: usuarioId,
          minutos_descubierto: min, proveedor: proveedor.nombre,
          resultado: tel.motivo === 'vacio' ? 'sin_telefono' : 'telefono_invalido',
          error: `teléfono cargado: ${tel.original || '(vacío)'}`,
        })
        continue
      }

      // Cada plantilla recibe exactamente las variables que su texto usa: 4 el
      // nivel 15, 5 el 30. Meta rechaza el envío si la cantidad no coincide.
      const destino = {
        telefono: tel.e164,
        plantilla: PLANTILLA[nivel],
        variables: variablesParaPlantilla(nivel, vars),
      }

      if (!enviarDeVerdad || !proveedor.configurado) {
        acciones.push({
          turno: t.id, nivel, objetivo: vars.objetivo, puesto: vars.puesto,
          horario: vars.horario, vigilador: vars.vigilador,
          destinatario: nombreDe(usuarioId), telefono: tel.e164,
          plantilla: destino.plantilla, minutos: min,
          enviaria: true, texto,
        })
        continue
      }

      const r = await proveedor.enviar(destino)
      acciones.push({
        turno: t.id, nivel, destinatario: nombreDe(usuarioId),
        telefono: tel.e164, ok: r.ok, error: r.error,
      })
      filasAuditoria.push({
        turno_id: t.id, objetivo_id: t.objetivo_id, puesto_id: t.puesto_id,
        guardia_id: t.guardia_id, nivel, destinatario_id: usuarioId,
        telefono: tel.e164, plantilla: destino.plantilla, minutos_descubierto: min,
        resultado: r.ok ? 'enviado' : 'fallido', id_proveedor: r.idProveedor,
        proveedor: proveedor.nombre, error: r.error,
      })

      // Sólo se marca como avisado si el proveedor lo aceptó: un rechazo se
      // reintenta en la próxima corrida, igual que hace el push.
      if (r.ok) {
        await client.from('notificaciones_enviadas')
          .insert({ usuario_id: usuarioId, turno_id: t.id, tipo: nivel })
          .then(() => {}, () => {})
      }
    }
  }

  if (enviarDeVerdad && filasAuditoria.length > 0) {
    await client.from('escalamiento_whatsapp_envios').insert(filasAuditoria)
      .then(() => {}, (e: any) => console.error('[escalamiento] auditoría', e?.message))
  }

  return NextResponse.json({
    modo: enviarDeVerdad ? (proveedor.configurado ? 'ENVIO_REAL' : 'SIN_PROVEEDOR_NO_ENVIA') : 'SIMULACION',
    meta: configuracionMeta(),
    ...(fuentesConError.length > 0 ? { FUENTES_CON_ERROR: fuentesConError } : {}),
    proveedor: proveedor.nombre,
    proveedorConfigurado: proveedor.configurado,
    turnosEvaluados: turnos.length,
    accionesNivel15: acciones.filter(a => a.nivel === NIVEL.supervisor).length,
    accionesNivel30: acciones.filter(a => a.nivel === NIVEL.operativo).length,
    descartes,
    acciones,
  })
}
