#!/usr/bin/env node
// Legajo Digital — planillas viejas → indicios y propuestas "a confirmar".
//
//   --modo=indicios  planillas de documentación (ART.51, reincidencia,
//                    prontuario, examen médico, credencial). Entran como
//                    INDICIOS "pendientes de corroboración": se muestran en el
//                    legajo, no validan ni crean documentos.
//   --modo=datos     planilla de legajos (ago. 2024): nacimiento, domicilio,
//                    ingreso, credencial. Entran como propuestas
//                    "pendiente_confirmacion" (Etapa 1): la persona confirma o
//                    corrige y Administración valida. Nunca pisan nada.
//
// Nunca se leen la cuenta bancaria, el CUIL ni el teléfono (ya están en la
// app o en Liquidación). La persona se busca por DNI; un DNI repetido en la
// app no se asocia.
//
// POR DEFECTO SIMULA. Para cargar:
//   CONFIRMO_CARGA_PLANILLAS=si node scripts/legajo-historico/cargar-planillas.mjs \
//     --modo=indicios --planilla=<xlsx fuera del repo> --fuente=planilla_documentacion_2025-11 --ejecutar

import { argumentos, clienteServicio, contar, exigirAutorizacion } from './comun.mjs'

const norm = s => String(s ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9]/g, '')

const COLUMNAS_INDICIOS = {
  ART51: ['art51', 'art51'], REINC: ['antecedentes_rnr', 'reincidencia'], REINCIDENCIA: ['antecedentes_rnr', 'reincidencia'],
  PRONT: ['antecedentes_provincia', 'prontuario'], PRONTUARIAL: ['antecedentes_provincia', 'prontuario'],
  EMEDICO: ['estudios_medicos', 'examen_medico'], EXAMENM: ['estudios_medicos', 'examen_medico'], EXMEDICOS: ['estudios_medicos', 'examen_medico'],
  MEDLEGAL: ['estudios_medicos', 'medico_legal'], CREDENCIALVIGENTE: ['credencial', 'credencial'], CREEDENCIAL: ['credencial', 'credencial'],
  CREDENCIAL: ['credencial', 'credencial'],
  ALTA: ['alta_arca', 'alta'], PRESPOLICIA: [null, 'presentacion_policia'], POLICIAL: [null, 'presentacion_policia'],
}
const COLUMNAS_DATOS = {
  NACIMIENTO: 'fecha_nacimiento', LUGARDENACIMIENTO: 'lugar_nacimiento', DOMICILIO: 'domicilio_calle',
  INGRESO: 'fecha_ingreso', CREDENCIAL: 'credencial_numero', VENCIMIENTO: 'credencial_vencimiento',
}
const NUNCA = new Set(['NDECUENTA', 'CUENTA', 'CBU', 'CUIL', 'TELEFONO'])
const FECHA = new Set(['fecha_nacimiento', 'fecha_ingreso', 'credencial_vencimiento'])
const VACIOS = /^(|-|—|NO|FALTA|FALTAN?.*|X)$/i

/** Fecha segura: celda de fecha de Excel o dd-mm-aaaa / dd/mm/aaaa. Lo ambiguo, null. */
export function fechaSegura(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  const m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(String(v ?? '').trim())
  if (!m) return null
  const [d, mes, a] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (mes < 1 || mes > 12 || d < 1 || d > 31 || a < 1940 || a > 2100) return null
  return `${a}-${String(mes).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

const texto = v => v instanceof Date ? v.toISOString().slice(0, 10) : String(v ?? '').trim()

/** Filas de una hoja → registros {dni, ...}. Sin encabezado reconocible, nada. */
export function leerHoja(filas, modo) {
  const iEnc = filas.findIndex(f => f.some(c => norm(c) === 'DNI'))
  if (iEnc < 0) return []
  const enc = filas[iEnc].map(norm)
  const iDni = enc.indexOf('DNI')
  const out = []
  for (const f of filas.slice(iEnc + 1)) {
    const dni = String(f[iDni] ?? '').replace(/\D/g, '')
    if (!/^\d{7,8}$/.test(dni)) continue
    enc.forEach((col, i) => {
      if (NUNCA.has(col) || i === iDni) return
      const crudo = f[i]
      const t = texto(crudo)
      if (VACIOS.test(t)) return
      if (modo === 'indicios' && COLUMNAS_INDICIOS[col]) {
        const [tipo, dato] = COLUMNAS_INDICIOS[col]
        out.push({ dni, tipo, dato, valor: t.slice(0, 200), fecha: fechaSegura(crudo) })
      } else if (modo === 'datos' && COLUMNAS_DATOS[col]) {
        const campo = COLUMNAS_DATOS[col]
        const valor = FECHA.has(campo) ? fechaSegura(crudo) : t.slice(0, 120)
        if (valor) out.push({ dni, campo, valor })
        else out.push({ dni, campo, valor: null, ambigua: true })
      }
    })
  }
  return out
}

async function principal() {
  const a = argumentos()
  if (!a.planilla || !['indicios', 'datos'].includes(a.modo)) {
    console.error('Uso: --modo=indicios|datos --planilla=<xlsx> [--fuente=…] [--hoja=…] [--ejecutar]'); process.exit(1)
  }
  if (a.modo === 'indicios' && typeof a.fuente !== 'string') { console.error('Falta --fuente (p. ej. planilla_documentacion_2025-11)'); process.exit(1) }
  const XLSX = (await import('xlsx')).default
  const wb = XLSX.readFile(a.planilla, { cellDates: true })
  const hojas = typeof a.hoja === 'string' ? [a.hoja] : wb.SheetNames
  const registros = []
  const porHoja = {}
  for (const h of hojas) {
    const filas = XLSX.utils.sheet_to_json(wb.Sheets[h], { header: 1, raw: true, defval: null })
    const r = leerHoja(filas, a.modo)
    porHoja[h] = r.length
    registros.push(...r)
  }
  const resumen = { modo: a.modo, por_hoja: porHoja, personas: new Set(registros.map(r => r.dni)).size, por_dato: {}, fechas_ambiguas_descartadas: 0 }
  for (const r of registros) { if (r.ambigua) resumen.fechas_ambiguas_descartadas++; else contar(resumen.por_dato, r.dato ?? r.campo) }
  console.log(JSON.stringify(resumen, null, 2))

  if (!exigirAutorizacion(a, 'CONFIRMO_CARGA_PLANILLAS')) { console.log('\nSIMULACIÓN: no se escribió nada.'); return }
  const db = await clienteServicio()
  const res = {}
  for (const r of registros.filter(x => !x.ambigua)) {
    const { data, error } = a.modo === 'indicios'
      ? await db.rpc('legajo_historico_cargar_indicio', { p: { ...r, fuente: a.fuente } })
      : await db.rpc('legajo_cargar_dato_planilla', { p: r })
    contar(res, error ? 'error' : data)
  }
  console.log('Resultado:', res)
}

if (process.argv[1]?.endsWith('cargar-planillas.mjs')) {
  principal().catch(e => { console.error(e.message); process.exit(1) })
}
