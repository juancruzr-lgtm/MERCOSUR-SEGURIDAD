/**
 * lib/legajo-diferencias.ts
 *
 * Diferencias con ARCA (migración 20261017120000). Administración carga la
 * «Consulta de Relaciones Laborales» de ARCA (Mi Simplificación → archivo .txt)
 * y la base compara en el momento contra los usuarios activos y el legajo:
 * contratos con fecha de fin, activos que no figuran en ARCA, relaciones vigentes
 * sin usuario activo, CUIL faltante, identidad distinta, DNI repetido e ingreso.
 * Nada se corrige ni se da de baja solo: cada diferencia se resuelve a mano
 * (o se marca «revisada» con una nota) y queda registrada.
 */

import { supabase } from '@/lib/supabase'
import type { RelacionGuardada } from '@/lib/arca-txt-visual'

export type TipoDiferencia =
  | 'contrato_con_fin' | 'activo_sin_relacion' | 'relacion_sin_usuario' | 'sin_cuil'
  | 'identidad_difiere' | 'dni_repetido' | 'ingreso_difiere' | 'sin_fecha_ingreso'

export interface Diferencia {
  clave: string
  tipo: TipoDiferencia
  gravedad: 'alta' | 'media' | 'baja'
  empleado_id: string | null
  persona: string
  cuil: string | null
  detalle: Record<string, unknown>
  revisada: boolean
  nota: string | null
  revisado_at: string | null
  revisado_por: string | null
}

export interface ResumenDiferencias {
  consulta: string | null
  relaciones: number
  /** Relaciones vigentes sumando todas las consultas (cada una trae movimientos). */
  vigentes?: number
  consultas: { fecha: string; relaciones: number; cargada_at: string }[]
  correcciones: { persona: string; empleado_id: string; campo: string; anterior: string | null; nuevo: string | null; fuente: string; at: string }[]
}

export const TEXTO_TIPO: Record<TipoDiferencia, { titulo: string; ayuda: string }> = {
  contrato_con_fin: { titulo: 'Contrato con fecha de fin', ayuda: 'ARCA registra la relación con fecha de finalización (p. ej. trabajo eventual). Decidir si se renueva, se pasa a permanente o termina.' },
  activo_sin_relacion: { titulo: 'Activo en la app, con baja en ARCA', ayuda: 'ARCA informó la baja de la relación laboral, pero en la app la persona sigue activa. Registrar la baja en la app o verificar en ARCA.' },
  relacion_sin_usuario: { titulo: 'Relación vigente en ARCA sin usuario activo', ayuda: 'ARCA sigue registrando la relación laboral, pero en la app la persona no está activa. Verificar si corresponde la baja en ARCA.' },
  sin_cuil: { titulo: 'Sin CUIL en la app', ayuda: 'Sin CUIL no se puede cruzar con ARCA ni con Visual. Si ARCA lo trae (por DNI), se puede cargar desde acá.' },
  identidad_difiere: { titulo: 'Nombre o DNI distinto de ARCA', ayuda: 'El nombre o el DNI registrado no coincide con ARCA para el mismo CUIL.' },
  dni_repetido: { titulo: 'DNI repetido', ayuda: 'Dos usuarios activos tienen el mismo DNI: al menos uno está mal cargado.' },
  ingreso_difiere: { titulo: 'Fecha de ingreso distinta de ARCA', ayuda: 'Puede ser un reingreso con antigüedad anterior. Revisar cuál corresponde.' },
  sin_fecha_ingreso: { titulo: 'Sin fecha de ingreso', ayuda: 'Falta la fecha de ingreso en el legajo.' },
}

export const ORDEN_TIPOS: TipoDiferencia[] = [
  'contrato_con_fin', 'activo_sin_relacion', 'relacion_sin_usuario', 'dni_repetido', 'identidad_difiere', 'sin_cuil', 'ingreso_difiere', 'sin_fecha_ingreso',
]

// ── Lectura del archivo de ARCA (ancho fijo) ─────────────────────────────────
export interface RelacionArca {
  cuil: string; nombre: string; modalidad: string | null; inicio: string; fin: string | null; baja: string | null; obra_social: string | null
  /** La línea tal cual vino de ARCA: se guarda para regenerar el .txt idéntico (Importar AFIP de Visual). */
  linea?: string
}

const COLUMNAS = ['CUIL', 'APELLIDO Y NOMBRE', 'OBRA SOCIAL', 'MODAL. CONTRATO', 'ACTIVIDAD LABORAL', 'PUESTO DESEMP.', 'RETRIB. PACTADA', 'MOD. LIQ.',
  'TRAB. AGROP.', 'FECHA INICIO', 'FECHA DE FIN', 'SITUACION De BAJA', 'CONVENIO COLECTIVO', 'CATEGORIA', 'TIPO SERVICIO'] as const

const fechaIso = (s: string): string | null => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim())
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

/** Lee una «Consulta de Relaciones Laborales» de ARCA. Devuelve error si el formato no es el esperado. */
export function leerConsultaArca(texto: string): { filas: RelacionArca[]; error: string | null } {
  const lineas = texto.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim())
  if (!lineas.length) return { filas: [], error: 'El archivo está vacío' }
  const cab = lineas[0]
  const pos = COLUMNAS.map(c => cab.indexOf(c))
  if (pos.some(p => p < 0)) return { filas: [], error: 'No es una Consulta de Relaciones Laborales de ARCA (faltan columnas)' }
  const filas: RelacionArca[] = []
  for (const l of lineas.slice(1)) {
    const col = (k: number) => l.slice(pos[k], k + 1 < pos.length ? pos[k + 1] : undefined).trim()
    const cuil = col(0).replace(/\D/g, '')
    const inicio = fechaIso(col(9))
    if (!/^\d{11}$/.test(cuil) || !inicio) return { filas: [], error: `Fila ilegible: ${l.slice(0, 40)}…` }
    filas.push({
      cuil, nombre: col(1).replace(/\s+/g, ' '), modalidad: col(3) || null, inicio, fin: fechaIso(col(10)),
      baja: col(11) || null, obra_social: col(2) || null, linea: l,
    })
  }
  if (!filas.length) return { filas: [], error: 'El archivo no tiene relaciones laborales' }
  return { filas, error: null }
}

/** «ConsRelLab13102026 (1).txt» → 2026-10-13 (la fecha de la consulta va en el nombre). */
export function fechaDeArchivo(nombre: string): string | null {
  const m = /ConsRelLab(\d{2})(\d{2})(\d{4})/i.exec(nombre)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

/** Une varios archivos de la misma consulta sin repetir relaciones. */
export function unirRelaciones(listas: RelacionArca[][]): RelacionArca[] {
  const vistos = new Map<string, RelacionArca>()
  for (const l of listas) for (const r of l) vistos.set(`${r.cuil}|${r.inicio}`, r)
  return Array.from(vistos.values())
}

// ── Textos ───────────────────────────────────────────────────────────────────
export const fechaCorta = (iso: unknown): string => {
  if (typeof iso !== 'string' || !iso) return '—'
  const d = iso.slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : iso
}

export function diasTexto(dias: unknown): string {
  if (typeof dias !== 'number') return ''
  if (dias < 0) return `venció hace ${-dias} ${-dias === 1 ? 'día' : 'días'}`
  if (dias === 0) return 'vence hoy'
  return `faltan ${dias} ${dias === 1 ? 'día' : 'días'}`
}

/** Línea de detalle legible para cada tipo. */
export function detalleTexto(d: Pick<Diferencia, 'tipo' | 'detalle'>): string {
  const x = d.detalle as Record<string, any>
  switch (d.tipo) {
    case 'contrato_con_fin':
      return `${x.modalidad ?? 'Relación'}: inicio ${fechaCorta(x.inicio)}, fin ${fechaCorta(x.fin)} (${diasTexto(x.dias_restantes)})`
    case 'activo_sin_relacion': {
      // Desde 20261112120000: la baja informada por ARCA (consultas acumuladas).
      if (x.baja) return `ARCA informó la baja en la consulta del ${fechaCorta(x.consulta)}: ${x.baja} (inicio ${fechaCorta(x.inicio)}${x.fin ? `, fin ${fechaCorta(x.fin)}` : ''}).`
      const ant = x.anterior as Record<string, any> | null
      const previo = ant ? ` Figuraba en la consulta del ${fechaCorta(ant.consulta)} (inicio ${fechaCorta(ant.inicio)}${ant.fin ? `, fin ${fechaCorta(ant.fin)}` : ''}${ant.baja ? `, baja: ${ant.baja}` : ''}).` : ''
      return `No figura en la consulta del ${fechaCorta(x.consulta)}${x.tiene_cuil ? '' : ' (no tiene CUIL en la app: se buscó por DNI)'}.${previo}`
    }
    case 'relacion_sin_usuario':
      return `Inicio ${fechaCorta(x.inicio)} · ${x.usuario ? `usuario ${x.usuario} en la app` : 'no hay usuario en la app'}`
    case 'sin_cuil':
      return x.cuil_arca ? `ARCA registra el CUIL ${x.cuil_arca} para su DNI (${x.nombre_arca}).` : 'ARCA no trae un CUIL para su DNI.'
    case 'identidad_difiere': {
      const p: string[] = []
      if (x.nombre_difiere) p.push(`nombre en la app «${x.nombre_app}», en ARCA «${x.nombre_arca}»`)
      if (x.dni_difiere) p.push(`el DNI ${x.dni_app} no corresponde al CUIL`)
      else if (x.dni_con_formato) p.push(`DNI cargado con signos («${x.dni_app}»)`)
      return p.join(' · ')
    }
    case 'dni_repetido':
      return `DNI ${x.dni}, también en: ${(x.otros as string[] | null)?.join('; ') ?? '—'}`
    case 'ingreso_difiere':
      return `Legajo ${fechaCorta(x.legajo)} · ARCA ${fechaCorta(x.arca)}`
    case 'sin_fecha_ingreso':
      return x.arca ? `ARCA: ${fechaCorta(x.arca)}` : 'Sin dato en ARCA'
  }
}

/** Situación actual en la app (fichajes y programación) para contratos y activos sin relación. */
export function situacionTexto(d: Pick<Diferencia, 'detalle'>): string | null {
  const x = d.detalle as Record<string, any>
  if (!('ultimo_fichaje' in x)) return null
  const partes = [
    x.ultimo_fichaje ? `último fichaje ${fechaCorta(x.ultimo_fichaje)}` : 'nunca fichó',
    typeof x.fichajes_mes === 'number' ? `${x.fichajes_mes} fichajes este mes` : null,
    'proximo_turno' in x ? (x.proximo_turno ? `próximo turno ${fechaCorta(x.proximo_turno)}` : 'sin turnos programados') : null,
  ].filter(Boolean)
  return partes.join(' · ')
}

// ── Base ─────────────────────────────────────────────────────────────────────
const errorTexto = (e: { code?: string; message?: string } | null) =>
  !e ? null : e.code === '42501' ? 'Sólo Administración o Gerencia' : (e.message || 'Error')

export async function cargarDiferencias(empleadoId?: string): Promise<{ filas: Diferencia[]; denegado: boolean; error: string | null }> {
  const { data, error } = await supabase.rpc('legajo_diferencias', empleadoId ? { p_empleado: empleadoId } : {})
  if (error) return { filas: [], denegado: error.code === '42501', error: error.code === '42501' ? null : errorTexto(error) }
  return { filas: (data ?? []) as Diferencia[], denegado: false, error: null }
}

export async function cargarResumen(): Promise<{ resumen: ResumenDiferencias | null; error: string | null }> {
  const { data, error } = await supabase.rpc('legajo_diferencias_resumen')
  return { resumen: (data as ResumenDiferencias) ?? null, error: errorTexto(error) }
}

export async function revisarDiferencia(clave: string, nota: string): Promise<string | null> {
  const { error } = await supabase.rpc('legajo_diferencia_revisar', { p_clave: clave, p_nota: nota })
  return errorTexto(error)
}

/** Última relación de cada CUIL en las consultas de ARCA cargadas (para generar el .txt de Visual). */
export interface RelacionCargada extends RelacionGuardada {
  cuil: string; apellido_nombre: string; obra_social: string | null; modalidad: string | null; fecha_inicio: string; fecha_fin: string | null
  situacion_baja: string | null; consulta_fecha: string; linea_original: string | null
  empleado_id: string | null; estado_app: string | null; legajo_visual: string | null
}

export async function relacionesParaVisual(): Promise<{ filas: RelacionCargada[]; error: string | null }> {
  const { data, error } = await supabase.rpc('arca_relaciones_para_visual')
  return { filas: (data ?? []) as RelacionCargada[], error: errorTexto(error) }
}

/**
 * Baja registrada en la app para un CUIL (la más reciente, no anulada). Sirve para
 * marcar las relaciones que siguen vigentes en ARCA aunque la app ya las dio de baja.
 */
export async function bajaRegistradaPorCuil(cuil: string): Promise<{ fecha_baja: string | null; estado: string } | null> {
  const { data, error } = await supabase.from('baja_laboral').select('fecha_baja, estado')
    .eq('cuil', cuil.replace(/\D/g, '')).neq('estado', 'anulada').order('registrada_at', { ascending: false }).limit(1)
  if (error || !data?.length) return null
  return data[0] as { fecha_baja: string | null; estado: string }
}

export async function reabrirDiferencia(clave: string): Promise<string | null> {
  const { error } = await supabase.rpc('legajo_diferencia_reabrir', { p_clave: clave })
  return errorTexto(error)
}

export async function importarConsulta(fecha: string, archivo: string, filas: RelacionArca[]): Promise<{ nuevas: number; total: number } | string> {
  const { data, error } = await supabase.rpc('arca_relaciones_importar', { p_consulta: fecha, p_archivo: archivo, p_filas: filas })
  if (error) return errorTexto(error) ?? 'Error'
  const r = data as { nuevas: number; total_consulta: number }
  return { nuevas: r.nuevas, total: r.total_consulta }
}

export async function corregirIdentidad(empleadoId: string, campo: 'cuil' | 'dni' | 'apellido' | 'nombre', valor: string, fuente: string, motivo?: string): Promise<string | null> {
  const { error } = await supabase.rpc('legajo_corregir_identidad', { p_empleado: empleadoId, p_campo: campo, p_valor: valor, p_fuente: fuente, p_motivo: motivo ?? null })
  return errorTexto(error)
}
