import { NextRequest, NextResponse } from 'next/server'
import { getBearerToken, getSupabaseAdmin } from '../../../_lib/employee-auth'
import { puedeVerLegajo } from '@/lib/legajo'

export const runtime = 'nodejs'

const ESTADOS_VALIDOS = new Set(['programado', 'cubierto', 'descubierto'])
const RE_FECHA = /^\d{4}-\d{2}-\d{2}$/
const RE_MES   = /^\d{4}-\d{2}$/
const RE_UUID  = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// ── Clasificación de cobertura ────────────────────────────────────────────────
// Derivada solo para la respuesta del legajo; no se persiste en la base de datos.
//
// 'programado'                — próximos (futuro): guardia_id = empleadoId activo.
// 'programado_y_cubierto'     — historial: el empleado estaba programado Y es el
//                               guardia efectivo en al menos un registro válido.
// 'programado_sin_asistencia' — historial: el empleado está programado pero no
//                               existe ningún registro válido para el turno.
// 'programado_pero_reemplazado' — historial: el empleado estaba programado pero
//                               otro guardia es el efectivo en los registros válidos.
// 'reasignado'                — historial: el empleado era guardia_original_id
//                               pero turnos.guardia_id pasó a otra persona (o null).
// 'reemplazo'                 — historial: el empleado cubrió vía registro sin
//                               haber sido guardia_id ni guardia_original_id.
export type TipoCobertura =
  | 'programado'
  | 'programado_y_cubierto'
  | 'programado_sin_asistencia'
  | 'programado_pero_reemplazado'
  | 'reasignado'
  | 'reemplazo'

// ── Helpers de fecha ──────────────────────────────────────────────────────────

function rangoMes(mes: string): { desde: string; hasta: string } {
  const [y, m] = mes.split('-').map(Number)
  const desde = `${mes}-01`
  const ultimo = new Date(y, m, 0).getDate()
  return { desde, hasta: `${mes}-${String(ultimo).padStart(2, '0')}` }
}

function hoyArg(): string {
  return new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function mesSiguiente(mesStr: string): string {
  const [y, m] = mesStr.split('-').map(Number)
  const d = new Date(y, m, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ── Selects ───────────────────────────────────────────────────────────────────

const TURNO_SELECT =
  'id, fecha, hora_inicio, hora_fin, estado, guardia_id, guardia_original_id,' +
  ' objetivo_id, puesto_id, objetivo:objetivos(nombre, es_prueba), puesto:puestos(nombre)'

// ── Cobertura real ────────────────────────────────────────────────────────────
// Un registro representa cobertura válida si tipo_registro != 'ausencia'.
// La presencia del registro (incluso sin hora_entrada_real) indica que el empleado
// se hizo presente. Si el admin cargó un registro de ausencia, no cuenta como cobertura.
// Regla alineada con el criterio explícito del usuario (excluir ausencias).
//
// Para múltiples registros del mismo turno (AppClient los llama también así):
// todos los registros válidos se consideran; si alguno tiene effective_guardia = empleadoId
// → el empleado cubrió. No se reduce a "principal" porque no se calculan horas aquí.
function esRegistroValido(r: any): boolean {
  return r.tipo_registro !== 'ausencia'
}

function effectiveGuardia(r: any): string | null {
  return r.guardia_final_id ?? r.guardia_id ?? null
}

// ── Handler ───────────────────────────────────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } },
) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })

  const token = getBearerToken(req)
  if (!token) return NextResponse.json({ error: 'Sesión requerida' }, { status: 401 })

  const { data: authData, error: authError } = await admin.client.auth.getUser(token)
  if (authError || !authData.user) {
    return NextResponse.json({ error: 'Sesión inválida' }, { status: 401 })
  }

  const { data: solicitante } = await admin.client
    .from('usuarios').select('id, rol').eq('auth_user_id', authData.user.id).single()
  if (!solicitante) return NextResponse.json({ error: 'Usuario no encontrado' }, { status: 403 })

  const empleadoId = params.id
  if (!puedeVerLegajo({ id: solicitante.id, rol: solicitante.rol }, empleadoId)) {
    return NextResponse.json({ error: 'Sin acceso a este legajo' }, { status: 403 })
  }

  const { data: empleado } = await admin.client
    .from('usuarios').select('id').eq('id', empleadoId).single()
  if (!empleado) return NextResponse.json({ error: 'Empleado no encontrado' }, { status: 404 })

  // ── Parámetros ─────────────────────────────────────────────────────────────
  const sp = req.nextUrl.searchParams
  const mesParam      = sp.get('mes')
  const desdeParam    = sp.get('desde')
  const hastaParam    = sp.get('hasta')
  const estadoParam   = sp.get('estado')
  const objetivoParam = sp.get('objetivo_id')

  if (mesParam && !RE_MES.test(mesParam))
    return NextResponse.json({ error: 'Parámetro mes inválido (esperado YYYY-MM)' }, { status: 400 })
  if (desdeParam && !RE_FECHA.test(desdeParam))
    return NextResponse.json({ error: 'Parámetro desde inválido (esperado YYYY-MM-DD)' }, { status: 400 })
  if (hastaParam && !RE_FECHA.test(hastaParam))
    return NextResponse.json({ error: 'Parámetro hasta inválido (esperado YYYY-MM-DD)' }, { status: 400 })
  if (estadoParam && !ESTADOS_VALIDOS.has(estadoParam))
    return NextResponse.json({ error: `Estado inválido. Permitidos: ${[...ESTADOS_VALIDOS].join(', ')}` }, { status: 400 })
  if (objetivoParam && !RE_UUID.test(objetivoParam))
    return NextResponse.json({ error: 'Parámetro objetivo_id inválido' }, { status: 400 })

  const hoy = hoyArg()
  let desde: string, hasta: string
  if (desdeParam && hastaParam) {
    desde = desdeParam; hasta = hastaParam
  } else if (mesParam) {
    desde = rangoMes(mesParam).desde
    hasta = rangoMes(mesSiguiente(mesParam)).hasta
  } else {
    const mc = hoy.slice(0, 7)
    desde = rangoMes(mc).desde
    hasta = rangoMes(mesSiguiente(mc)).hasta
  }

  const diasRango = (new Date(hasta).getTime() - new Date(desde).getTime()) / 86_400_000
  if (diasRango > 184)
    return NextResponse.json({ error: 'El rango no puede superar 6 meses' }, { status: 400 })

  // ── Paso 1: Fuente 1 — turnos donde el empleado es guardia_id o guardia_original_id ──
  // guardia_id          → actualmente programado (próximos y historial)
  // guardia_original_id → era el programado original, luego reasignado (solo historial)
  const { data: turnosF1, error: errF1 } = await admin.client
    .from('turnos')
    .select(TURNO_SELECT)
    .or(`guardia_id.eq.${empleadoId},guardia_original_id.eq.${empleadoId}`)
    .gte('fecha', desde)
    .lte('fecha', hasta)
    .order('fecha', { ascending: true })
    .order('hora_inicio', { ascending: true })

  if (errF1) return NextResponse.json({ error: 'Error al consultar turnos' }, { status: 500 })

  const f1Ids = (turnosF1 ?? []).map((t: any) => t.id)

  // ── Paso 2: Fuente 2a y 2b en paralelo ────────────────────────────────────
  // 2a — Registros de los turnos de Fuente 1 (para determinar cobertura real).
  //      Solo campos necesarios; no se calculan horas.
  // 2b — Registros donde el empleado es guardia efectivo en turnos que NO
  //      estaban en Fuente 1 (reemplazos puros).
  //      El join !inner con turnos permite traer datos del turno directamente.
  const [res2a, res2b] = await Promise.all([
    f1Ids.length > 0
      ? admin.client
          .from('registros_asistencia')
          .select('turno_id, guardia_id, guardia_final_id, tipo_registro')
          .in('turno_id', f1Ids)
      : Promise.resolve({ data: [] as any[], error: null }),

    admin.client
      .from('registros_asistencia')
      .select(`
        turno_id, guardia_id, guardia_final_id, tipo_registro,
        turno:turnos!inner(
          id, fecha, hora_inicio, hora_fin, estado,
          guardia_id, guardia_original_id,
          objetivo_id, puesto_id,
          objetivo:objetivos(nombre, es_prueba),
          puesto:puestos(nombre)
        )
      `)
      .or(`guardia_id.eq.${empleadoId},guardia_final_id.eq.${empleadoId}`)
      .gte('turno.fecha', desde)
      .lt('turno.fecha', hoy)
      .lte('turno.fecha', hasta),
  ])

  if (res2a.error) return NextResponse.json({ error: 'Error al consultar asistencias' }, { status: 500 })
  if (res2b.error) return NextResponse.json({ error: 'Error al consultar reemplazos' }, { status: 500 })

  // ── Paso 3: Mapa de registros por turno (solo para Fuente 1) ──────────────
  // Agrupa los registros de Fuente 2a por turno_id para clasificar
  // la cobertura de cada turno de Fuente 1.
  const regsPorTurno = new Map<string, any[]>()
  for (const r of (res2a.data ?? [])) {
    if (!regsPorTurno.has(r.turno_id)) regsPorTurno.set(r.turno_id, [])
    regsPorTurno.get(r.turno_id)!.push(r)
  }

  // ── Paso 4: Clasificar y construir mapa de turnos ─────────────────────────
  // El mapa evita duplicados dentro del mismo legajo (un turno puede llegar
  // por Fuente 1 y también aparecer en Fuente 2b si el empleado es programado
  // Y además cubrió como efectivo — en ese caso Fuente 1 tiene prioridad y
  // ya refleja la cobertura mediante la clasificación correcta).
  const turnosMap = new Map<string, { turno: any; tipo: TipoCobertura }>()

  for (const t of (turnosF1 ?? [])) {
    // Excluir objetivos de prueba en todas las fuentes
    if ((t.objetivo as any)?.es_prueba) continue

    const esProgramadoActual = t.guardia_id === empleadoId
    const eraOriginal = (t as any).guardia_original_id === empleadoId

    // ── Reasignado: era guardia_original_id pero turnos.guardia_id cambió ───
    // El empleado ya no es el asignado activo. No importa quién cubrió —
    // la programación original ya no es de este empleado. Solo aplica al
    // historial (turnos futuros reasignados no deben aparecer en próximos).
    if (eraOriginal && !esProgramadoActual) {
      if (t.fecha < hoy) {
        turnosMap.set(t.id, { turno: t, tipo: 'reasignado' })
      }
      // Si fecha >= hoy y fue reasignado: omitir (ya no es responsabilidad del empleado).
      continue
    }

    // ── Programado (guardia_id = empleadoId) ─────────────────────────────────
    if (esProgramadoActual) {
      // Próximos: clasificación simple, sin registros aún
      if (t.fecha >= hoy) {
        turnosMap.set(t.id, { turno: t, tipo: 'programado' })
        continue
      }

      // Historial: determinar cobertura real mediante registros
      const regs = regsPorTurno.get(t.id) ?? []
      const validos = regs.filter(esRegistroValido)

      if (validos.length === 0) {
        // Sin registros válidos: puede ser descubierto o no fichado
        turnosMap.set(t.id, { turno: t, tipo: 'programado_sin_asistencia' })
      } else {
        // ¿Algún registro válido tiene al empleado como guardia efectivo?
        const empleadoCubrió = validos.some(r => effectiveGuardia(r) === empleadoId)
        turnosMap.set(t.id, {
          turno: t,
          tipo: empleadoCubrió ? 'programado_y_cubierto' : 'programado_pero_reemplazado',
        })
      }
    }
  }

  // ── Paso 5: Agregar turnos de reemplazo (Fuente 2b) ───────────────────────
  // Solo los registros donde el empleado ES el guardia efectivo (coalesce).
  // Solo los que apuntan a turnos no presentes en Fuente 1.
  for (const r of (res2b.data ?? [])) {
    // Aplicar coalesce en memoria (la query OR trae ambos lados)
    if (effectiveGuardia(r) !== empleadoId) continue
    if (!esRegistroValido(r)) continue

    const t = (r as any).turno
    if (!t || !t.id) continue
    if ((t.objetivo as any)?.es_prueba) continue
    if (turnosMap.has(t.id)) continue  // ya clasificado por Fuente 1 con mayor detalle

    turnosMap.set(t.id, { turno: t, tipo: 'reemplazo' })
  }

  // ── Paso 6: Filtros opcionales y ordenamiento ──────────────────────────────
  let merged = [...turnosMap.values()]

  if (estadoParam) merged = merged.filter(({ turno }) => turno.estado === estadoParam)
  if (objetivoParam) merged = merged.filter(({ turno }) => turno.objetivo_id === objetivoParam)

  merged.sort((a, b) =>
    `${a.turno.fecha} ${a.turno.hora_inicio}`.localeCompare(
      `${b.turno.fecha} ${b.turno.hora_inicio}`
    )
  )

  // ── Paso 7: Separar próximos / historial ──────────────────────────────────
  // Próximos: solo turnos con tipo 'programado' (guardia_id activo, fecha futura).
  //   Los reasignados no llegan aquí (filtrados en paso 4).
  //   Los reemplazos son siempre pasado.
  // Historial: todos los tipos excepto 'programado'.
  const proximos  = merged.filter(({ tipo })        => tipo === 'programado')
  const historial = merged.filter(({ turno, tipo }) => turno.fecha < hoy && tipo !== 'programado')

  // ── Normalizar respuesta ───────────────────────────────────────────────────
  const normalizar = ({ turno: t, tipo }: { turno: any; tipo: TipoCobertura }) => ({
    id:              t.id,
    fecha:           t.fecha,
    hora_inicio:     t.hora_inicio,
    hora_fin:        t.hora_fin,
    estado:          t.estado,
    objetivo_id:     t.objetivo_id,
    objetivo_nombre: (t.objetivo as any)?.nombre ?? null,
    puesto_id:       t.puesto_id ?? null,
    puesto_nombre:   (t.puesto as any)?.nombre ?? null,
    tipo_cobertura:  tipo,
  })

  return NextResponse.json({
    proximos:  proximos.map(normalizar),
    historial: historial.map(normalizar),
    total:     merged.length,
    rango:     { desde, hasta },
  })
}
