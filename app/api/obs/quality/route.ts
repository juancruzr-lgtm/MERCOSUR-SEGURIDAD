import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, isObsAuthErr } from '../../_lib/obs-auth'

const LIMIT_REGISTROS = 5000
const LIMIT_EVIDENCIAS = 5000

// ── GET /api/obs/quality ───────────────────────────────────────────────────────
// Chequeos de calidad de datos sobre las tablas operativas existentes.
// Se ejecuta on-demand desde el panel de Observación.
export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (isObsAuthErr(auth)) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const { client } = auth

  const inicio = Date.now()

  const [
    usuariosRes,
    objetivosRes,
    turnosRes,
    registrosRes,
    supervisionesRes,
    novedadesRes,
    evidenciasRes,
    puestosRes,
  ] = await Promise.all([
    client.from('usuarios').select('id, nombre, apellido, email, dni, legajo, rol, estado, auth_user_id, foto_url'),
    client.from('objetivos').select('id, nombre, cliente, direccion, lat, lng, radio_metros, checklist_plantilla_id, frecuencia_supervision_horas, zona_id, estado'),
    client.from('turnos').select('id, guardia_id, objetivo_id, fecha, hora_inicio, hora_fin, estado')
      .gte('fecha', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
      .lte('fecha', new Date().toISOString().slice(0, 10)),
    client.from('registros_asistencia').select('id, turno_id, guardia_id, hora_entrada_real, hora_salida_real, lat_entrada, lng_entrada, foto_entrada_url, tipo_registro').order('created_at', { ascending: false }).limit(LIMIT_REGISTROS),
    client.from('supervisiones').select('id, objetivo_id, supervisor_id, lat, lng, precision_gps, estado').order('created_at', { ascending: false }).limit(2000),
    client.from('novedades').select('id, guardia_id, objetivo_id, tipo, descripcion, prioridad, estado, created_at'),
    client.from('evidencias').select('id, proceso_tipo, proceso_id, guardia_id, objetivo_id, tipo_evidencia').limit(LIMIT_EVIDENCIAS),
    client.from('puestos').select('id, objetivo_id, nombre, activo'),
  ])

  const usuarios     = usuariosRes.data ?? []
  const objetivos    = objetivosRes.data ?? []
  const turnos       = turnosRes.data ?? []
  const registros    = registrosRes.data ?? []
  const supervisiones = supervisionesRes.data ?? []
  const novedades    = novedadesRes.data ?? []
  const evidencias   = evidenciasRes.data ?? []
  const puestos      = puestosRes.data ?? []

  const usuarioPorId = new Map(usuarios.map((u: any) => [u.id, u]))
  const objetivoPorId = new Map(objetivos.map((o: any) => [o.id, o]))
  const turnoPorId = new Map(turnos.map((t: any) => [t.id, t]))

  const nombreUsuario = (usuario?: any) => {
    if (!usuario) return 'Usuario sin nombre'
    return [usuario.apellido, usuario.nombre].filter(Boolean).join(', ') || usuario.legajo || 'Usuario sin nombre'
  }

  const nombreObjetivo = (objetivo?: any) => {
    if (!objetivo) return 'Objetivo sin nombre'
    return [objetivo.nombre, objetivo.cliente].filter(Boolean).join(' · ') || 'Objetivo sin nombre'
  }

  const ejemploEntidad = (entidad: string, item: any): string => {
    if (entidad === 'usuarios') return nombreUsuario(item)
    if (entidad === 'objetivos') return nombreObjetivo(item)
    if (entidad === 'turnos') {
      const objetivo = objetivoPorId.get(item.objetivo_id)
      return `${item.fecha ?? 'Sin fecha'} ${String(item.hora_inicio ?? '').slice(0, 5)} · ${nombreObjetivo(objetivo)}`
    }
    if (entidad === 'registros_asistencia' || entidad === 'evidencias') {
      const guardia = usuarioPorId.get(item.guardia_id)
      const turno = turnoPorId.get(item.turno_id)
      const objetivo = objetivoPorId.get(item.objetivo_id ?? turno?.objetivo_id)
      return `${nombreUsuario(guardia)} · ${turno?.fecha ?? 'Sin turno'} · ${nombreObjetivo(objetivo)}`
    }
    if (entidad === 'supervisiones') {
      const objetivo = objetivoPorId.get(item.objetivo_id)
      const supervisor = usuarioPorId.get(item.supervisor_id)
      return `${nombreObjetivo(objetivo)} · ${nombreUsuario(supervisor)}`
    }
    if (entidad === 'novedades') {
      const objetivo = objetivoPorId.get(item.objetivo_id)
      const guardia = usuarioPorId.get(item.guardia_id)
      return `${item.tipo ?? 'Novedad'} · ${nombreObjetivo(objetivo)} · ${nombreUsuario(guardia)}`
    }
    return item.nombre || item.descripcion || 'Registro sin nombre'
  }

  const checks: Array<{
    nombre: string
    tipo: string
    entidad: string
    cantidad: number
    ids_afectados: string[]
    ids_ejemplo: string[]
    ejemplos: string[]
    descripcion: string
    estado: 'ok' | 'advertencia' | 'critico'
  }> = []

  const check = (nombre: string, tipo: string, entidad: string, items: any[], descripcion: string, umbralAdv = 1, umbralCrit = 10) => {
    const ids = items.map((i: any) => i.id).filter(Boolean).map(String)
    const ejemplos = items.slice(0, 5).map((i: any) => ejemploEntidad(entidad, i)).filter(Boolean)
    const estado = items.length === 0 ? 'ok' : items.length < umbralCrit ? 'advertencia' : 'critico'
    checks.push({ nombre, tipo, entidad, cantidad: items.length, ids_afectados: ids, ids_ejemplo: ids.slice(0, 5), ejemplos, descripcion, estado })
  }

  // ── Usuarios ─────────────────────────────────────────────────────────────────
  check('Usuarios sin email', 'completeness', 'usuarios',
    usuarios.filter((u: any) => u.rol !== 'admin' && (!u.email || u.email.trim() === '')),
    'Guardias y supervisores sin email no pueden iniciar sesión.',
    1, 5)

  check('Usuarios sin DNI', 'completeness', 'usuarios',
    usuarios.filter((u: any) => !u.dni || u.dni.trim() === ''),
    'Usuarios sin DNI pueden tener inconvenientes con el legajo.',
    3, 10)

  check('Usuarios sin auth vinculado', 'integrity', 'usuarios',
    usuarios.filter((u: any) => u.rol !== 'admin' && !u.auth_user_id),
    'Usuarios activos que no pueden iniciar sesión porque no tienen cuenta auth.',
    1, 5)

  check('Usuarios inactivos con auth vinculado', 'consistency', 'usuarios',
    usuarios.filter((u: any) => u.estado === 'inactivo' && u.auth_user_id),
    'Usuarios dados de baja que aún conservan acceso activo a la aplicación.',
    1, 3)

  // ── Objetivos ─────────────────────────────────────────────────────────────────
  check('Objetivos sin GPS configurado', 'completeness', 'objetivos',
    objetivos.filter((o: any) => !o.lat || !o.lng),
    'Sin coordenadas GPS el sistema no puede validar fichajes por radio.',
    1, 3)

  check('Objetivos sin dirección', 'completeness', 'objetivos',
    objetivos.filter((o: any) => !o.direccion || o.direccion.trim() === ''),
    'Objetivos sin dirección registrada.',
    1, 5)

  check('Objetivos sin zona operativa', 'completeness', 'objetivos',
    objetivos.filter((o: any) => o.estado === 'activo' && !o.zona_id),
    'Objetivos activos sin zona asignada — los supervisores no podrán verlos según su zona.',
    1, 5)

  check('Objetivos sin checklist asignado', 'completeness', 'objetivos',
    objetivos.filter((o: any) => o.estado === 'activo' && !o.checklist_plantilla_id),
    'Objetivos activos sin plantilla de supervisión asignada.',
    2, 10)

  check('Objetivos sin frecuencia de supervisión', 'completeness', 'objetivos',
    objetivos.filter((o: any) => o.estado === 'activo' && !o.frecuencia_supervision_horas),
    'Sin frecuencia configurada el sistema no puede detectar supervisiones vencidas.',
    1, 5)

  // ── Turnos ───────────────────────────────────────────────────────────────────
  // La query ya filtra los últimos 30 días en DB — no se necesita filtro JS.
  check('Turnos sin guardia asignado (últimos 30 días)', 'completeness', 'turnos',
    turnos.filter((t: any) => !t.guardia_id),
    'Turnos programados sin guardia — aparecerán como "Descubiertos".',
    1, 5)

  // ── Registros de asistencia ───────────────────────────────────────────────────
  const registrosRecientes = registros.slice(0, 2000)

  check('Fichajes sin foto de entrada', 'completeness', 'registros_asistencia',
    registrosRecientes.filter((r: any) => r.hora_entrada_real && !r.foto_entrada_url),
    'Ingresos registrados sin foto de entrada (verificar si es intencional o falla).',
    5, 20)

  check('Fichajes sin GPS de entrada', 'completeness', 'registros_asistencia',
    registrosRecientes.filter((r: any) => r.hora_entrada_real && (!r.lat_entrada && !r.latitud_ingreso)),
    'Ingresos sin coordenadas GPS — imposible validar presencia en el objetivo.',
    5, 15)

  check('Fichajes sin turno vinculado', 'integrity', 'registros_asistencia',
    registrosRecientes.filter((r: any) => !r.turno_id),
    'Registros de asistencia sin turno asociado — pueden ser registros huérfanos.',
    1, 5)

  // ── Supervisiones ─────────────────────────────────────────────────────────────
  const supervisionesRecientes = supervisiones.slice(0, 500)

  check('Supervisiones sin GPS registrado', 'completeness', 'supervisiones',
    supervisionesRecientes.filter((s: any) => !s.lat && !s.lng),
    'Supervisiones sin coordenadas — no se puede verificar que ocurrieron en el objetivo.',
    2, 10)

  check('Supervisiones en estado crítico sin seguimiento', 'operativo', 'supervisiones',
    supervisiones.filter((s: any) => s.estado === 'critico'),
    'Supervisiones registradas como críticas — requieren atención del administrador.',
    1, 3)

  // ── Novedades ─────────────────────────────────────────────────────────────────
  const novedadesViejas = novedades.filter((n: any) => {
    const hace72h = new Date(Date.now() - 72 * 60 * 60 * 1000)
    return n.prioridad === 'urgente' && n.estado === 'pendiente' && new Date(n.created_at) < hace72h
  })
  check('Novedades urgentes sin resolver (más de 72h)', 'operativo', 'novedades',
    novedadesViejas,
    'Novedades urgentes abiertas hace más de 72 horas sin resolución.',
    1, 3)

  // ── Evidencias ────────────────────────────────────────────────────────────────
  const procesoIds = new Set([
    ...registros.filter((r: any) => r.hora_entrada_real).map((r: any) => r.id),
  ])
  const evidenciasXProceso = evidencias.reduce((acc: Record<string, string[]>, e: any) => {
    if (!acc[e.proceso_id]) acc[e.proceso_id] = []
    acc[e.proceso_id].push(e.tipo_evidencia)
    return acc
  }, {})
  const ingresosSinEvidencia = registros
    .filter((r: any) => r.hora_entrada_real && r.tipo_registro === 'fichaje_gps')
    .filter((r: any) => !evidenciasXProceso[r.id]?.includes('foto_entrada'))
    .slice(0, 100)
  check('Ingresos GPS sin evidencia en tabla evidencias', 'integrity', 'evidencias',
    ingresosSinEvidencia,
    'Fichajes GPS recientes sin registro en la tabla de evidencias unificada.',
    5, 20)

  // ── Resumen final ─────────────────────────────────────────────────────────────
  const criticos     = checks.filter(c => c.estado === 'critico').length
  const advertencias = checks.filter(c => c.estado === 'advertencia').length
  const ok           = checks.filter(c => c.estado === 'ok').length

  // Advertencia de análisis parcial cuando alguna tabla fue truncada
  const analisisParcial = registros.length >= LIMIT_REGISTROS || evidencias.length >= LIMIT_EVIDENCIAS

  return NextResponse.json({
    ejecutado_en: new Date().toISOString(),
    duracion_ms: Date.now() - inicio,
    analisis_parcial: analisisParcial,
    analisis_parcial_detalle: analisisParcial
      ? [
          registros.length >= LIMIT_REGISTROS ? `registros_asistencia limitado a ${LIMIT_REGISTROS}` : null,
          evidencias.length >= LIMIT_EVIDENCIAS ? `evidencias limitado a ${LIMIT_EVIDENCIAS}` : null,
        ].filter(Boolean)
      : [],
    resumen: { total_checks: checks.length, criticos, advertencias, ok },
    checks: checks.sort((a, b) => {
      const orden = { critico: 0, advertencia: 1, ok: 2 }
      return orden[a.estado] - orden[b.estado]
    }),
  })
}
