/**
 * /api/cumplimiento/simulacion-pesos — qué pasaría si otra dimensión pesara.
 *
 * SÓLO LECTURA. No escribe una fila, no manda un aviso, no cambia el puntaje de
 * nadie. Existe para poder responder con números —sobre las personas reales de
 * un mes real— antes de mover un peso, en vez de discutirlo en abstracto.
 *
 * POR QUÉ UNA RUTA Y NO UN SCRIPT
 * La simulación tiene que usar `calcularCumplimiento`, la MISMA función que
 * produce el puntaje de producción, con los pesos inyectados. Una simulación
 * que reimplemente el promedio no prueba nada sobre el promedio de produccion:
 * podría dar un número tranquilizador con una fórmula que la app no usa.
 *
 * Y tiene que correr donde están los datos completos: el mes entero, las
 * rondas y las evidencias de las 65 personas, con el cliente de servidor.
 *
 * CÓMO SE ELIGE UN PESO
 * No por cómo queda la distribución. Optimizar para que "quede linda" es
 * fabricar diferencias entre personas. Se elige por si el número que sale se
 * puede sostener frente a la persona que lo recibe — y por eso la respuesta
 * incluye, para cada variante, cuántas dimensiones quedaron EN VALIDACIÓN: una
 * variante que le da peso a algo que todavía no se puede sostener no es una
 * opción, por mejor que se vea el histograma.
 */
import { NextRequest, NextResponse } from 'next/server'
import { getSupabaseAdmin } from '../../_lib/employee-auth'
import { requireAdminIA } from '../../ia/_lib/auth'
import { cargarFilasBandeja } from '@/lib/bandeja-datos'
import { jornadaCumplimientoDesdeFila } from '@/lib/desempeno-datos'
import {
  ETIQUETA_DIMENSION, ETIQUETA_ESTADO, VARIANTES_PESOS, calcularCumplimiento, normalizacion,
} from '@/lib/cumplimiento'
import type { ClaveDimension } from '@/lib/cumplimiento'
import {
  cargarEvidenciasDelMes, cargarRondasDelMes, evidenciasPorEmpleado, fuentesDeEmpleado,
} from '@/lib/cumplimiento-fuentes'
import { CURVAS } from '@/lib/cumplimiento-medicion'
import type { CurvaNota } from '@/lib/cumplimiento-medicion'

export const runtime = 'nodejs'
export const maxDuration = 60
export const fetchCache = 'force-no-store'
export const dynamic = 'force-dynamic'

const DIMENSIONES: ClaveDimension[] = [
  'asistencia', 'puntualidad', 'procedimiento',
  'rondas', 'uniforme', 'libro_guardia', 'evidencias',
]

export async function GET(req: NextRequest) {
  const ctx = await requireAdminIA(req)
  if (!ctx.ok) return (ctx as { respuesta: NextResponse }).respuesta

  const admin = getSupabaseAdmin()
  if (admin.error) return NextResponse.json({ error: admin.error }, { status: 500 })
  const client = admin.client

  const mes = req.nextUrl.searchParams.get('mes') || new Date().toISOString().slice(0, 7)
  const curva = (req.nextUrl.searchParams.get('curva') || 'proporcional') as CurvaNota
  if (CURVAS.indexOf(curva) < 0) {
    return NextResponse.json({ error: `Curva desconocida. Válidas: ${CURVAS.join(', ')}` }, { status: 400 })
  }

  const bandeja = await cargarFilasBandeja({ mes, esAdmin: true, usuarioId: null, client })
  if (bandeja.error) return NextResponse.json({ error: bandeja.error }, { status: 500 })

  const [rr, ee] = await Promise.all([
    cargarRondasDelMes(mes, client, true),
    cargarEvidenciasDelMes(mes, client),
  ])
  const fallo = [rr.error, ee.error].filter(Boolean).join(' · ')
  if (fallo) return NextResponse.json({ error: fallo }, { status: 500 })

  const porRondas = new Map(rr.datos.map(d => [d.guardiaId, d]))
  const porEvidencia = evidenciasPorEmpleado(ee.evidencias)

  // Agrupar por empleado, igual que la lista.
  const porEmpleado = new Map<string, typeof bandeja.filas>()
  for (const f of bandeja.filas) {
    const arr = porEmpleado.get(f.empleadoId) ?? []
    arr.push(f)
    porEmpleado.set(f.empleadoId, arr)
  }

  const variantes = Object.keys(VARIANTES_PESOS)
  const resultado: Record<string, any> = {}
  for (const v of variantes) {
    resultado[v] = {
      pesos: VARIANTES_PESOS[v],
      distribucion: {} as Record<string, number>,
      puntuables: {} as Record<string, number>,
      en_validacion: {} as Record<string, number>,
      no_aplica: {} as Record<string, number>,
      suma_puntajes: 0,
      con_puntaje: 0,
      puntajes: [] as number[],
      cambian_de_categoria: 0,
      // Quien cambia y HACIA DONDE. Es lo que decide: si encender una dimension
      // rescata de "requiere intervencion" a alguien cuyo problema sigue ahi,
      // el indicador dejo de senalar justo a quien mas atencion necesita.
      cambios: [] as Array<{
        empleado: string; de: string; a: string
        puntaje_de: number | null; puntaje_a: number | null
        dimensiones: Record<string, string>; pesa_sobre: string; causa: string
      }>,
      mayor_baja: null as null | { empleado: string; de: number; a: number },
      mayor_suba: null as null | { empleado: string; de: number; a: number },
    }
  }

  porEmpleado.forEach((filas, empleadoId) => {
    const jornadas = filas.map(jornadaCumplimientoDesdeFila)
    const medido = fuentesDeEmpleado(
      porRondas.get(empleadoId) ?? null,
      porEvidencia.get(empleadoId) ?? [],
      curva,
    )
    const nombre = filas[0]?.vigilador ?? empleadoId
    const base = calcularCumplimiento(jornadas, medido.fuentes, VARIANTES_PESOS.actual)

    for (const v of variantes) {
      const r = calcularCumplimiento(jornadas, medido.fuentes, VARIANTES_PESOS[v])
      const acc = resultado[v]
      acc.distribucion[r.estado] = (acc.distribucion[r.estado] ?? 0) + 1
      for (const d of r.dimensiones) {
        const donde = d.estado === 'puntuable' ? 'puntuables'
          : d.estado === 'en_validacion' ? 'en_validacion'
          : d.estado === 'no_aplica' ? 'no_aplica' : null
        if (donde) acc[donde][d.clave] = (acc[donde][d.clave] ?? 0) + 1
      }
      if (r.puntaje !== null) {
        acc.suma_puntajes += r.puntaje
        acc.con_puntaje += 1
        acc.puntajes.push(r.puntaje)
      }
      if (r.estado !== base.estado) {
        acc.cambian_de_categoria += 1
        // El detalle completo: sin esto no se puede explicar POR QUE cambió.
        const dims: Record<string, string> = {}
        for (const d of r.dimensiones) {
          if (d.clave === 'evidencias') continue
          dims[d.clave] =
            d.estado === 'puntuable'           ? `${d.nota} (peso ${d.peso})`
            : d.estado === 'no_aplica'          ? 'no aplica'
            : d.estado === 'datos_insuficientes' ? 'datos insuficientes'
            : d.estado === 'en_validacion'      ? `${d.nota} en validación (no suma)`
            :                                     'sin datos'
        }
        const puntuables = r.dimensiones.filter(d => d.estado === 'puntuable')
        acc.cambios.push({
          empleado: nombre,
          de: ETIQUETA_ESTADO[base.estado], a: ETIQUETA_ESTADO[r.estado],
          puntaje_de: base.puntaje, puntaje_a: r.puntaje,
          dimensiones: dims,
          pesa_sobre: puntuables.map(d => d.clave).join('+'),
          causa: (r.puntaje ?? 0) > (base.puntaje ?? 0)
            ? `sube: entran ${puntuables.filter(d => VARIANTES_PESOS.actual[d.clave] === 0).map(d => `${d.clave} ${d.nota}`).join(', ') || 'nada nuevo'} y Procedimiento pasa a pesar ${Math.round(1000 * (puntuables.find(d => d.clave === 'procedimiento')?.peso ?? 0) / puntuables.reduce((s, d) => s + d.peso, 0)) / 10} %`
            : `baja: entran ${puntuables.filter(d => VARIANTES_PESOS.actual[d.clave] === 0).map(d => `${d.clave} ${d.nota}`).join(', ') || 'nada nuevo'}`,
        })
      }
      if (r.puntaje !== null && base.puntaje !== null) {
        const delta = r.puntaje - base.puntaje
        if (delta < -0.001 && (!acc.mayor_baja || delta < acc.mayor_baja.delta)) {
          acc.mayor_baja = { empleado: nombre, de: base.puntaje, a: r.puntaje, delta }
        }
        if (delta > 0.001 && (!acc.mayor_suba || delta > acc.mayor_suba.delta)) {
          acc.mayor_suba = { empleado: nombre, de: base.puntaje, a: r.puntaje, delta }
        }
      }
    }
  })

  for (const v of variantes) {
    const acc = resultado[v]
    const ps: number[] = [...acc.puntajes].sort((a: number, b: number) => a - b)
    acc.promedio = acc.con_puntaje > 0
      ? Math.round((acc.suma_puntajes / acc.con_puntaje) * 100) / 100 : null
    acc.mediana = ps.length === 0 ? null
      : ps.length % 2 === 1 ? ps[(ps.length - 1) / 2]
      : Math.round(((ps[ps.length / 2 - 1] + ps[ps.length / 2]) / 2) * 100) / 100
    acc.minimo = ps.length > 0 ? ps[0] : null
    acc.maximo = ps.length > 0 ? ps[ps.length - 1] : null
    delete acc.suma_puntajes
    delete acc.puntajes
    const puntuables = DIMENSIONES.filter(d => (acc.puntuables[d] ?? 0) > 0)
    acc.normalizacion = normalizacion(VARIANTES_PESOS[v], puntuables)
    acc.dimensiones_que_puntuan = puntuables.map(d => ETIQUETA_DIMENSION[d])
  }

  return NextResponse.json({
    ok: true,
    mes,
    curva,
    empleados: porEmpleado.size,
    etiquetas_estado: ETIQUETA_ESTADO,
    // Lo que decide: una variante que le da peso a algo que sigue en validación
    // no es una opción, se vea como se vea la distribución.
    nota: 'Una dimensión EN VALIDACIÓN no entra al promedio aunque su peso sea > 0. '
      + 'Si una variante muestra peso en una dimensión que sigue en validación, ese peso '
      + 'no está haciendo nada todavía, y encenderla requiere cerrar la ambigüedad primero.',
    variantes: resultado,
  })
}
