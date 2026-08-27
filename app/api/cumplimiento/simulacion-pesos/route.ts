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

  // ?detalle=1 devuelve el puntaje y las dimensiones de CADA persona.
  //
  // Sirve para simular sobre los números reales cualquier cosa que se derive
  // del puntaje —una escala escolar, un corte, una agrupación— sin volver a
  // calcularlo por fuera. Recalcular en otro lado es exactamente cómo aparecen
  // dos números distintos para la misma persona.
  const detalle = req.nextUrl.searchParams.get('detalle') === '1'
  const porPersona: any[] = []

  porEmpleado.forEach((filas, empleadoId) => {
    const jornadas = filas.map(jornadaCumplimientoDesdeFila)
    const medido = fuentesDeEmpleado(
      porRondas.get(empleadoId) ?? null,
      porEvidencia.get(empleadoId) ?? [],
      curva,
    )
    const nombre = filas[0]?.vigilador ?? empleadoId
    const base = calcularCumplimiento(jornadas, medido.fuentes, VARIANTES_PESOS.actual)

    if (detalle) {
      const rProd = calcularCumplimiento(jornadas, medido.fuentes)
      const dims: Record<string, any> = {}
      for (const d of rProd.dimensiones) {
        dims[d.clave] = d.estado === 'puntuable' ? d.nota
          : d.estado === 'no_aplica' ? 'no aplica'
          : d.estado === 'datos_insuficientes' ? 'datos insuficientes'
          : d.estado === 'en_validacion' ? `${d.nota} (en validación)`
          : 'sin datos'
      }
      // El estado de cada dimensión, para poder contar el universo sin
      // reimplementar la regla en SQL.
      const estados: Record<string, string> = {}
      for (const d of rProd.dimensiones) estados[d.clave] = d.estado
      const notas: Record<string, number | null> = {}
      for (const d of rProd.dimensiones) notas[d.clave] = d.nota

      // El puntaje bajo CADA modelo de pesos, para poder cruzar pesos × escala
      // sin volver a pedir los datos.
      const porModelo: Record<string, number | null> = {}
      for (const v of variantes) {
        porModelo[v] = calcularCumplimiento(jornadas, medido.fuentes, VARIANTES_PESOS[v]).puntaje
      }

      porPersona.push({
        empleado: nombre,
        puntaje: rProd.puntaje,
        estado: ETIQUETA_ESTADO[rProd.estado],
        jornadas: rProd.base.observacionesValidas,
        dimensiones: dims,
        estados,
        notas,
        por_modelo: porModelo,
        // Requerido válido / cumplido de cada dimensión, tal como lo cuenta el
        // motor. Es lo que permite reconciliar el universo sin aproximar.
        req: {
          asistencia: { req: rProd.base.observacionesValidas, inc: rProd.base.ausencias },
          puntualidad: { req: rProd.puntualidad.evaluadas, inc: rProd.puntualidad.impuntuales },
          procedimiento: {
            req: rProd.base.observacionesValidas,
            inc: rProd.base.incidencias.sin_registro_propio + rProd.base.incidencias.entrada_sin_salida,
            sin_registro: rProd.base.incidencias.sin_registro_propio,
            entrada_sin_salida: rProd.base.incidencias.entrada_sin_salida,
          },
          rondas: {
            req: medido.rondas.medicion.validos, inc: medido.rondas.medicion.incidencias,
            excluidas: medido.rondas.medicion.excluidos,
            saneadas: medido.rondas.saneadas, sin_causa: medido.rondas.pausaSinClasificar,
          },
          uniforme: {
            req: medido.uniforme.medicion.validos, inc: medido.uniforme.medicion.incidencias,
            excluidas: medido.uniforme.medicion.excluidos, ilegibles: medido.uniforme.noEvaluables,
          },
          libro_guardia: {
            req: medido.libro.medicion.validos, inc: medido.libro.medicion.incidencias,
            excluidas: medido.libro.medicion.excluidos, ilegibles: medido.libro.noEvaluables,
          },
          evidencias: {
            req: medido.calidad.medicion.validos, inc: medido.calidad.medicion.incidencias,
          },
        },
      })
    }

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
    ...(detalle ? { personas: porPersona.sort((a, b) => (b.puntaje ?? -1) - (a.puntaje ?? -1)) } : {}),
  })
}
