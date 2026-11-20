// Asistencia: la protección del fichaje del vigilador (F-02) convive con los procedimientos
// reales de corrección, cobertura, cierre y anulación, y las horas corregidas llegan a la
// liquidación y a la facturación. Personas y objetivos ficticios (seed.sql).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { crearEntorno, type Entorno, P, OBJETIVO, TURNO, REGISTRO } from './entorno'

const ASIS = join(__dirname, 'asistencia')

/** md5 del cuerpo normalizado en PRODUCCIÓN (20/11/2026, sólo lectura). */
const MD5_PROD: Record<string, string> = {
  _registro_excepcion_consumir: 'd06006067c0c6617e6909b4c559aa1de',
  _registro_liquidable_validar: 'a452765e8a6529435e6c7b479e12ef7c',
  alcance_operativo_de: 'cb6cd392d425de5dc2de4dc9f1dad077',
  alcanza_objetivo: 'f5683369f2c4d092f2c41d8024621b4d',
  alcanza_objetivo_actual: 'fa0cbc8657a684ae604c5a6ce29b9c48',
  alcanza_turno_actual: '670823ef6c555012a592fb64e903601e',
  anular_registro_manual: '4c66810fed8ba55945900aacc4ba8154',
  autorizar_excepcion_asistencia: 'f70950b6214f031351bff8b2352ecfbb',
  calcular_horas_liquidables: '3c37209a06b2742de9816993df826a3e',
  calcular_horas_reconocidas: 'f401150b536d51db2a93fc651dfd2d02',
  cerrar_turno: 'cf3b5efb5875374afcbcbd33da363cc7',
  cerrar_turnos_abiertos: '1dce773f1b9dbac743732889d73718ff',
  corregir_registro_asistencia: 'bd796c1c25d2e8137f8897b3ac85b15f',
  corregir_turno_manual_operativo: 'cc04fb75c4892927d90d19b042e18154',
  es_operador_actual: '4c8d83315048e3ff5b3f508967ff4b53',
  puede_administrar_rondas_objetivo: 'fa0cbc8657a684ae604c5a6ce29b9c48',
  puede_autorizar_excepcion_asistencia: 'a1bc9cdf5ed46c79b5cc8eda31323f83',
  registrar_cobertura: '4df83ba81acf09f1c8e3c83be6b96c3a',
  registrar_intervencion_operativa: '693e2f5caa0ffe79c7a86793bd312b73',
  registros_asistencia_consumir_excepcion: '328aeee94a4f75c2341cb555eee15147',
  registros_asistencia_guarda_fichaje_vigilador: '581e9712183787a66987755a8fcf6b97',
  registros_asistencia_validar_liquidable: '683f1c782c18d5e3a0733651d0eb5d6e',
  trg_registro_alerta_salida: '95ce53bfe19069951a69e4d90ea13c9f',
  trg_registro_detectar_salida_anticipada: 'acac3c1400f97a75a06d92f3c092100a',
}

const TABLAS_EXTRA = `
  create table if not exists public.alertas (id uuid default gen_random_uuid() primary key, tipo text not null, mensaje text not null, objetivo_id uuid, guardia_id uuid, camara_id uuid, leida boolean default false, created_at timestamptz default now());
  create sequence if not exists public.supervisor_intervenciones_secuencia_evento_seq;
  create table if not exists public.supervisor_intervenciones (id uuid default gen_random_uuid() primary key, turno_id uuid, registro_asistencia_id uuid, supervisor_id uuid, tipo_alerta text, accion text, comentario text, guardia_anterior_id uuid, guardia_nuevo_id uuid, estado_anterior text, estado_nuevo text, created_at timestamptz default now(), supervisor_asignado_id uuid, supervisor_intervino_id uuid, supervisor_guardia_id uuid, jefe_operativo text, director_tecnico text, zona text, motivo text, operacion_id uuid, reapertura_de_id uuid, solicitud_json jsonb, resultado_json jsonb, cobertura_origen_intervencion_id uuid, secuencia_evento bigint not null default nextval('public.supervisor_intervenciones_secuencia_evento_seq'));
  create table if not exists public.correccion_turno_manual_log (id uuid default gen_random_uuid() primary key, operacion_id uuid not null unique, registro_id uuid not null, turno_id uuid not null, ejecutado_por uuid not null, solicitud_json jsonb not null, cambios_aplicados jsonb not null, resultado_json jsonb not null, created_at timestamptz not null default now());
`
const TRIGGERS = `
  drop trigger if exists registro_00_guarda_fichaje_vigilador on public.registros_asistencia;
  drop trigger if exists registro_alerta_salida on public.registros_asistencia;
  drop trigger if exists registro_detectar_salida_anticipada on public.registros_asistencia;
  drop trigger if exists registros_asistencia_consumir_excepcion on public.registros_asistencia;
  drop trigger if exists registros_asistencia_validar_liquidable on public.registros_asistencia;
  CREATE TRIGGER registro_00_guarda_fichaje_vigilador BEFORE INSERT OR UPDATE ON public.registros_asistencia FOR EACH ROW EXECUTE FUNCTION registros_asistencia_guarda_fichaje_vigilador();
  CREATE TRIGGER registro_alerta_salida BEFORE INSERT OR UPDATE OF hora_salida_real, turno_id ON public.registros_asistencia FOR EACH ROW EXECUTE FUNCTION trg_registro_alerta_salida();
  CREATE TRIGGER registro_detectar_salida_anticipada AFTER INSERT OR UPDATE OF hora_salida_real, hora_entrada_real, cierre_automatico, registro_anulado_at, turno_id ON public.registros_asistencia FOR EACH ROW EXECUTE FUNCTION trg_registro_detectar_salida_anticipada();
  CREATE TRIGGER registros_asistencia_consumir_excepcion AFTER INSERT OR UPDATE ON public.registros_asistencia FOR EACH ROW EXECUTE FUNCTION registros_asistencia_consumir_excepcion();
  CREATE TRIGGER registros_asistencia_validar_liquidable BEFORE INSERT OR UPDATE ON public.registros_asistencia FOR EACH ROW EXECUTE FUNCTION registros_asistencia_validar_liquidable();
`

let e: Entorno
beforeAll(async () => {
  e = await crearEntorno()
  await e.aplicarArchivo(join(ASIS, '00-stubs.sql'))
  await e.exec(TABLAS_EXTRA)
  // Las 7 migraciones aplicadas el 20/11 (estado real de producción).
  for (const m of ['20261220150000_usuarios_jerarquia_base', '20261220160000_supervisiones_sin_edicion_directa',
    '20261220161000_auditorias_solo_agregar', '20261220163000_asistencia_rpc_alcance_y_periodo',
    '20261220164000_usuarios_identidad_rpc', '20261220170000_fichaje_vigilador_lista_blanca']) {
    await e.aplicarArchivo(join(__dirname, '..', '..', 'supabase', 'migrations', m + '.sql'))
  }
  await e.aplicarArchivo(join(ASIS, '10-funciones-asistencia.sql'))
  await e.exec(TRIGGERS)
  for (const fn of ['corregir_registro_asistencia', 'registrar_cobertura', 'registrar_intervencion_operativa', 'anular_registro_manual',
    'corregir_turno_manual_operativo', 'cerrar_turno', 'autorizar_excepcion_asistencia'])
    await e.exec(`grant execute on function public.${fn} to authenticated`)
}, 240_000)
afterAll(async () => { await e?.cerrar() })

/** md5 sin comentarios -- (los cuerpos versionados llevan comentarios que producción no tiene). */
const MD5_PROD_SIN_COMENTARIOS: Record<string, string> = {
  corregir_registro_asistencia: '70d50611b1fd8ffece1d3187df19fc90',
  registrar_cobertura: '5514fa41b918c82a186749b38e033cd2',
  registros_asistencia_guarda_fichaje_vigilador: '581e9712183787a66987755a8fcf6b97',
}
const md5 = async (fn: string, sinComentarios = false) =>
  (await e.q<{ h: string }>(`select md5(btrim(regexp_replace(${sinComentarios ? `regexp_replace(replace(p.prosrc, E'\\r',''), '--[^\\n]*', '', 'g')` : `replace(p.prosrc, E'\\r','')`}, '\\s+', ' ', 'g'))) h
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1`, [fn])).rows[0]?.h

describe('entorno = producción', () => {
  it('cuerpos de funciones idénticos a producción', async () => {
    const dif: string[] = []
    for (const [fn, h] of Object.entries(MD5_PROD)) {
      const ok = (await md5(fn)) === h || (fn in MD5_PROD_SIN_COMENTARIOS && (await md5(fn, true)) === MD5_PROD_SIN_COMENTARIOS[fn])
      if (!ok) dif.push(fn)
    }
    expect(dif).toEqual([])
  })
})

// ───────────────────────── Casos de conciliación ─────────────────────────
import { resolverLineaLiquidacion } from '../../lib/liquidacion'
import { horasDelObjetivo } from '../../lib/facturacion/horas'
import { omitidosQueQuedanEnCero, tramosInicialesCierre } from '../../lib/cerrar-turno-tramos'

const OBJ = OBJETIVO.norte
const PUESTO = '40000000-0000-4000-8000-000000000001'
let nTurno = 0
async function turno(fecha: string, ini: string, fin: string, guardia: string = P.vigilador.id, estado = 'programado') {
  const id = `5a000000-0000-4000-8000-${String(++nTurno).padStart(12, '0')}`
  await e.q(`insert into turnos (id, guardia_id, objetivo_id, puesto_id, fecha, hora_inicio, hora_fin, estado, publicado)
             values ($1,$2,$3,$4,$5,$6,$7,$8,true)`, [id, guardia, OBJ, PUESTO, fecha, ini, fin, estado])
  return id
}
const como = <T,>(p: any, sql: string, params: unknown[] = []) => e.comoUsuario(p, () => e.q<T>(sql, params))
const intentarComo = (p: any, sql: string, params: unknown[] = []) => e.comoUsuario(p, () => e.intentar(() => e.q(sql, params)))
const registros = async (turnoId: string) => (await e.q<any>(`select * from registros_asistencia where turno_id = $1 order by created_at, id`, [turnoId])).rows
const auditoria = async (turnoId: string) => (await e.q<any>(`select campo, valor_anterior, valor_nuevo, comentario, modificado_por from registros_asistencia_auditoria where turno_id = $1 order by created_at, campo`, [turnoId])).rows
const turnoRow = async (id: string) => (await e.q<any>(`select * from turnos where id = $1`, [id])).rows[0]
const fechaIso = (v: any) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10))
const s = (v: any) => (v == null ? v : String(v).slice(0, 5))
/** Horas que llegan a la LIQUIDACIÓN: misma función que Excel de trabajo / Visual / banco. */
async function horasLiquidacion(turnoId: string) {
  const t = await turnoRow(turnoId); const t2 = { ...t, fecha: fechaIso(t.fecha) }
  const out: Record<string, number> = {}
  for (const r of await registros(turnoId)) {
    if (r.tipo_registro === 'ausencia') continue
    const l = resolverLineaLiquidacion(t2, r)
    out[l.guardiaEfectivoId!] = (out[l.guardiaEfectivoId!] ?? 0) + l.horasLiquidables
  }
  return out
}
/** Horas que llegan a la FACTURACIÓN del objetivo (minutos cubiertos/descubiertos del período). */
async function horasFacturacion(turnoIds: string[], mes = '2026-11') {
  const ts = (await e.q<any>(`select * from turnos where id = any($1)`, [turnoIds])).rows.map((t: any) => ({ ...t, fecha: fechaIso(t.fecha) }))
  const rs = (await e.q<any>(`select * from registros_asistencia where turno_id = any($1)`, [turnoIds])).rows
  const h = horasDelObjetivo({ objetivoId: OBJ, periodo: { desde: `${mes}-01`, hastaExclusivo: '2026-12-01' }, turnos: ts, registros: rs,
    franjaNocturna: null, separarDiurnaNocturna: false, ahora: new Date('2026-12-15T12:00:00Z') })
  return { cubiertos: h.minutosCubiertos / 60, descubiertos: h.minutosDescubiertos / 60 }
}
const ingresoVigilador = (turnoId: string, hora: string, p: any = P.vigilador) => como<{ id: string }>(p,
  `insert into registros_asistencia (guardia_id, turno_id, hora_entrada_real, alerta_entrada, latitud_ingreso, longitud_ingreso, precision_ingreso, distancia_ingreso_metros, gps_ingreso_estado)
   values ($1,$2,$3,null,-34.0,-58.0,12,30,'dentro_radio') returning id`, [p.id, turnoId, hora])
const egresoVigilador = (regId: string, hora: string, horas: number, p: any = P.vigilador) => como(p,
  `update registros_asistencia set hora_salida_real=$2, horas_trabajadas=$3, latitud_egreso=-34.0, longitud_egreso=-58.0, precision_egreso=10, distancia_egreso_metros=20, gps_egreso_estado='dentro_radio' where id=$1`, [regId, hora, horas])
const corregir = (p: any, regId: string, payload: object, comentario: string, fuera = false) =>
  como(p, `select corregir_registro_asistencia($1, $2::jsonb, $3, $4)`, [regId, JSON.stringify(payload), comentario, fuera])

describe('F-02: el vigilador', () => {
  it('ficha ingreso y egreso normalmente; la evidencia queda intacta', async () => {
    await e.enTransaccion(async () => {
      const t = await turno('2026-11-10', '08:00', '20:00')
      const { rows: [r] } = await ingresoVigilador(t, '07:58')
      await egresoVigilador(r.id, '20:03', 12.08)
      const [reg] = await registros(t)
      expect([s(reg.hora_entrada_real), s(reg.hora_salida_real), reg.estado_revision, reg.origen]).toEqual(['07:58', '20:03', 'pendiente_supervisor', 'operacion'])
    })
  })
  it('no puede alterar fichajes históricos ni horas reconocidas', async () => {
    await e.enTransaccion(async () => {
      for (const sql of [
        `update registros_asistencia set hora_entrada_real='07:00' where id=$1`,
        `update registros_asistencia set horas_liquidables=24 where id=$1`,
        `update registros_asistencia set hora_salida_final='23:00' where id=$1`,
        `update registros_asistencia set guardia_final_id=guardia_id where id=$1`,
        `update registros_asistencia set latitud_ingreso=0 where id=$1`,
        `update registros_asistencia set estado_revision='aprobado' where id=$1`,
      ]) expect((await intentarComo(P.vigilador, sql, [REGISTRO.vigNorte]))?.message, sql).toMatch(/FICHAJE_PROTEGIDO/)
      const err = await intentarComo(P.vigilador, `insert into registros_asistencia (guardia_id, turno_id, hora_entrada_real, horas_liquidables) values ($1,$2,'08:00',12)`, [P.vigilador.id, TURNO.vigNorteManiana])
      expect(err?.message).toMatch(/FICHAJE_PROTEGIDO/)
    })
  })
  it('puede anular su egreso recién marcado (dentro de 30 min) pero no uno viejo', async () => {
    await e.enTransaccion(async () => {
      const ahora = (await e.q<{ h: string }>(`select to_char((now() at time zone 'America/Argentina/Buenos_Aires') - interval '5 minutes', 'HH24:MI') h`)).rows[0].h
      const t = await turno('2026-11-10', '08:00', '20:00')
      const { rows: [r] } = await ingresoVigilador(t, '07:58')
      await egresoVigilador(r.id, ahora, 12)
      const anular = `update registros_asistencia set hora_salida_real=null, hora_salida_final=null, horas_trabajadas=null, alerta_salida=null, latitud_egreso=null, longitud_egreso=null, precision_egreso=null, distancia_egreso_metros=null, gps_egreso_estado=null where id=$1`
      expect(await intentarComo(P.vigilador, anular, [r.id])).toBeNull()
      const viejo = (await e.q<{ h: string }>(`select to_char((now() at time zone 'America/Argentina/Buenos_Aires') - interval '3 hours', 'HH24:MI') h`)).rows[0].h
      await egresoVigilador(r.id, viejo, 9)
      expect((await intentarComo(P.vigilador, anular, [r.id]))?.message).toMatch(/30 minutos/)
    })
  })
})

describe('Casos de conciliación (procedimientos reales)', () => {
  it('1. trabajó y fichó bien → liquida y factura lo programado', async () => {
    await e.enTransaccion(async () => {
      const t = await turno('2026-11-10', '08:00', '20:00')
      const { rows: [r] } = await ingresoVigilador(t, '08:02')
      await egresoVigilador(r.id, '20:01', 11.98)
      expect(await horasLiquidacion(t)).toEqual({ [P.vigilador.id]: 12 })
      expect(await horasFacturacion([t])).toEqual({ cubiertos: 12, descubiertos: 0 })
    })
  })

  it('2. trabajó pero no fichó → el supervisor carga la cobertura (evidencia: auditoría + origen)', async () => {
    await e.enTransaccion(async () => {
      const t = await turno('2026-11-10', '08:00', '20:00')
      expect(await horasLiquidacion(t)).toEqual({})
      expect(await horasFacturacion([t])).toEqual({ cubiertos: 0, descubiertos: 12 })
      await como(P.supervisor, `select registrar_cobertura($1,$2,'carga_supervisor','08:00','20:00',null,'Olvidó fichar; presente según libro de guardia')`, [t, P.vigilador.id])
      const [reg] = await registros(t)
      expect([reg.tipo_registro, reg.origen_cobertura, Number(reg.horas_liquidables)]).toEqual(['carga_manual', 'carga_supervisor', 12])
      expect((await auditoria(t)).length).toBeGreaterThan(0)
      expect(await horasLiquidacion(t)).toEqual({ [P.vigilador.id]: 12 })
      expect(await horasFacturacion([t])).toEqual({ cubiertos: 12, descubiertos: 0 })
    })
  })

  it('3. fichó tarde pero estaba en el puesto → Administración reconoce el horario; el fichaje original no cambia', async () => {
    await e.enTransaccion(async () => {
      const t = await turno('2026-11-10', '08:00', '20:00')
      const { rows: [r] } = await ingresoVigilador(t, '08:47')
      await egresoVigilador(r.id, '20:00', 11.2)
      await corregir(P.administracion, r.id, { hora_entrada_final: '08:00' }, 'Estaba en el puesto desde 08:00 (confirmó el supervisor); fichó tarde por falta de señal')
      const [reg] = await registros(t)
      expect([s(reg.hora_entrada_real), s(reg.hora_entrada_final), Number(reg.horas_liquidables)]).toEqual(['08:47', '08:00', 12])
      const aud = await auditoria(t)
      expect(aud.map((a: any) => a.campo)).toEqual(expect.arrayContaining(['hora_entrada_final', 'horas_liquidables']))
      expect(aud.every((a: any) => a.modificado_por === P.administracion.id)).toBe(true)
      expect(await horasLiquidacion(t)).toEqual({ [P.vigilador.id]: 12 })
    })
  })

  it('4. se retiró antes y lo reemplazaron → cada uno cobra su tramo; el cliente recibe el turno completo', async () => {
    await e.enTransaccion(async () => {
      const t = await turno('2026-11-10', '08:00', '20:00')
      const { rows: [r] } = await ingresoVigilador(t, '08:00')
      await egresoVigilador(r.id, '14:00', 6)
      await corregir(P.supervisor, r.id, { hora_salida_final: '14:00' }, 'Se retiró a las 14 por enfermedad')
      // Reportes llama a registrar_cobertura con p_horas_liquidables = null (AppClient):
      const sinHoras = await intentarComo(P.supervisor, `select registrar_cobertura($1,$2,'carga_supervisor','14:00','20:00',null,'Relevo')`, [t, P.vigiladorSur.id])
      expect(sinHoras?.message).toMatch(/especificá p_horas_liquidables/)  // la carga manual no pisa un relevo: el tramo se indica (o se usa cerrar_turno)
      // Con las horas del tramo (lo que hace el procedimiento si se las indica):
      await como(P.supervisor, `select registrar_cobertura($1,$2,'carga_supervisor','14:00','20:00',6,'Relevo desde las 14')`, [t, P.vigiladorSur.id])
      expect(await horasLiquidacion(t)).toEqual({ [P.vigilador.id]: 6, [P.vigiladorSur.id]: 6 })
      expect(await horasFacturacion([t])).toEqual({ cubiertos: 12, descubiertos: 0 })
    })
  })

  it('4b. relevo cerrado por el supervisor con tramos (cerrar_turno)', async () => {
    await e.enTransaccion(async () => {
      const t = await turno('2026-11-10', '08:00', '20:00')
      const { rows: [r] } = await ingresoVigilador(t, '08:00')
      await egresoVigilador(r.id, '14:00', 6)
      await como(P.supervisor, `select cerrar_turno($1, $2::jsonb, 'Relevo por retiro anticipado')`, [t, JSON.stringify([
        { guardia_id: P.vigilador.id, hora_inicio: '08:00', hora_fin: '14:00' },
        { guardia_id: P.vigiladorSur.id, hora_inicio: '14:00', hora_fin: '20:00' }])])
      const regs = await registros(t)
      expect(regs.find((x: any) => x.id === r.id).hora_entrada_real).toBeTruthy()  // evidencia original conservada
      expect(await horasLiquidacion(t)).toEqual({ [P.vigilador.id]: 6, [P.vigiladorSur.id]: 6 })
    })
  })

  it('5. horas adicionales por necesidad operativa → reconocidas con motivo (sin crear horas extras)', async () => {
    await e.enTransaccion(async () => {
      const t = await turno('2026-11-10', '08:00', '20:00')
      const { rows: [r] } = await ingresoVigilador(t, '08:00')
      await egresoVigilador(r.id, '23:00', 15)
      expect(await horasLiquidacion(t)).toEqual({ [P.vigilador.id]: 12 })  // sin reconocer: lo programado
      expect((await e.comoUsuario(P.administracion, () => e.intentar(() => corregir(P.administracion, r.id, { hora_salida_final: '23:00' }, '', true))))?.message).toMatch(/motivo/)
      await corregir(P.administracion, r.id, { hora_salida_final: '23:00' }, 'Quedó hasta las 23 por relevo ausente (pedido del cliente)', true)
      const [reg] = await registros(t)
      expect(Number(reg.horas_liquidables)).toBe(15)
      expect((await auditoria(t)).map((a: any) => a.campo)).toContain('reconocido_fuera_de_turno')
      expect(await horasLiquidacion(t)).toEqual({ [P.vigilador.id]: 15 })
    })
  })

  it('6. turno nocturno que cruza medianoche: fichaje, corrección y cierre automático', async () => {
    await e.enTransaccion(async () => {
      const t = await turno('2026-11-10', '20:00', '08:00')
      const { rows: [r] } = await ingresoVigilador(t, '20:05')
      await egresoVigilador(r.id, '07:58', 11.88)
      expect(await horasLiquidacion(t)).toEqual({ [P.vigilador.id]: 12 })
      await corregir(P.supervisor, r.id, { hora_entrada_final: '20:00', hora_salida_final: '08:00' }, 'Horario completo confirmado')
      expect(Number((await registros(t))[0].horas_liquidables)).toBe(12)
      expect(await horasFacturacion([t])).toEqual({ cubiertos: 12, descubiertos: 0 })
      // Cierre automático (corre como el cron, no como usuario): cierra un nocturno sin egreso.
      const t2 = await turno('2026-11-11', '20:00', '08:00')
      const { rows: [r2] } = await ingresoVigilador(t2, '20:00')
      const { rows: [c] } = await e.q<any>(`select * from cerrar_turnos_abiertos()`)
      expect(c.registros_cerrados).toBeGreaterThanOrEqual(1)
      const [reg2] = await registros(t2)
      expect([s(reg2.hora_entrada_real), reg2.hora_salida_real, s(reg2.hora_salida_final), reg2.cierre_automatico, Number(reg2.horas_liquidables)]).toEqual(['20:00', null, '08:00', true, 12])
      // Y después el vigilador todavía puede marcar su salida real (no la pisa el cierre):
      expect(await e.comoUsuario(P.vigilador, () => e.intentar(() => egresoVigilador(r2.id, '08:01', 12)))).toBeNull()
    })
  })

  it('7. cobertura manual acreditada por el supervisor (confirmación) y anulación auditada por Administración', async () => {
    await e.enTransaccion(async () => {
      const t = await turno('2026-11-10', '08:00', '20:00')
      // Sin ninguna evidencia, confirmar horas exige una excepción autorizada con motivo:
      const sinExc = await intentarComo(P.supervisor, `select registrar_cobertura($1,$2,'confirmacion_supervisor',null,null,null,'Verificado en recorrida')`, [t, P.vigilador.id])
      expect(sinExc?.message).toMatch(/CONFIRMACION_SIN_EVIDENCIA/)
      const autoriza = await intentarComo(P.gerencia, `select autorizar_excepcion_asistencia(gen_random_uuid(), $1, 'Cliente confirmó presencia por nota')`, [t])
      expect(autoriza).toBeNull()  // Gerencia autoriza la excepción
      if (autoriza) await como(P.administracion, `select autorizar_excepcion_asistencia(gen_random_uuid(), $1, 'Cliente confirmó presencia por nota')`, [t])
      const regId = (await como<any>(P.supervisor, `select registrar_cobertura($1,$2,'confirmacion_supervisor',null,null,null,'Verificado en recorrida') id`, [t, P.vigilador.id])).rows[0].id
      expect(await horasLiquidacion(t)).toEqual({ [P.vigilador.id]: 12 })
      await como(P.administracion, `select anular_registro_manual($1, 'Cargado por error: el turno lo cubrió otra empresa')`, [regId])
      const [reg] = await registros(t)
      expect(reg.registro_anulado_at ?? reg.cobertura_anulada_at).toBeTruthy()
      expect(await horasLiquidacion(t)).toEqual({ [P.vigilador.id]: 0 })
      expect((await auditoria(t)).length).toBeGreaterThanOrEqual(2)
    })
  })

  it('8. error de horario corregido por Administración (gerencia también puede)', async () => {
    await e.enTransaccion(async () => {
      const t = await turno('2026-11-10', '08:00', '20:00')
      const regId = (await como<any>(P.supervisor, `select registrar_cobertura($1,$2,'carga_supervisor','18:00','20:00',2,'Carga') id`, [t, P.vigilador.id])).rows[0].id
      await corregir(P.administracion, regId, { hora_entrada_final: '08:00', hora_salida_final: '20:00' }, 'Se tipeó 18:00 en vez de 08:00')
      expect(await horasLiquidacion(t)).toEqual({ [P.vigilador.id]: 12 })
      await corregir(P.gerencia, regId, { hora_entrada_final: '09:00', hora_salida_final: '20:00' }, 'Gerencia: entró 09:00 según cliente')
      expect(await horasLiquidacion(t)).toEqual({ [P.vigilador.id]: 11 })
      const quienes = new Set((await auditoria(t)).map((a: any) => a.modificado_por))
      expect(quienes.has(P.administracion.id) && quienes.has(P.gerencia.id)).toBe(true)
    })
  })

  it('9. corrección de un período ya liquidado: se permite, queda auditada y no toca la liquidación guardada', async () => {
    await e.enTransaccion(async () => {
      await e.q(`insert into liquidacion_periodo (id, mes, estado) values ('91000000-0000-4000-8000-000000000001','2026-10','liquidada')`)
      const antes = (await e.q<any>(`select md5(string_agg(t::text, ',' order by id)) h from liquidacion_periodo t`)).rows[0].h
      const t = await turno('2026-10-20', '08:00', '20:00')
      const { rows: [r] } = await ingresoVigilador(t, '08:00')
      await egresoVigilador(r.id, '20:00', 12)
      await corregir(P.administracion, r.id, { hora_salida_final: '16:00' }, 'Ajuste posterior a la liquidación de octubre')
      expect(await horasLiquidacion(t)).toEqual({ [P.vigilador.id]: 8 })
      expect((await e.q<any>(`select md5(string_agg(t::text, ',' order by id)) h from liquidacion_periodo t`)).rows[0].h).toBe(antes)
      expect((await auditoria(t)).map((a: any) => a.campo)).toContain('horas_liquidables')
    })
  })

  it('10. horas trabajadas ≠ pagadas ≠ facturables', async () => {
    await e.enTransaccion(async () => {
      const t = await turno('2026-11-12', '08:00', '20:00')
      const { rows: [r] } = await ingresoVigilador(t, '07:30')
      await egresoVigilador(r.id, '21:30', 14)
      const tDesc = await turno('2026-11-12', '20:00', '08:00', P.vigiladorSur.id)  // nadie fue
      const [reg] = await registros(t)
      expect(Number(reg.horas_trabajadas)).toBe(14)                       // trabajadas (evidencia)
      expect(await horasLiquidacion(t)).toEqual({ [P.vigilador.id]: 12 })   // pagadas (programado)
      expect(await horasLiquidacion(tDesc)).toEqual({})
      expect(await horasFacturacion([t, tDesc])).toEqual({ cubiertos: 12, descubiertos: 12 })  // facturables: cubiertas; descubiertas a decisión
    })
  })
})

describe('Otros controles', () => {
  it('supervisor fuera de zona no corrige; Administración sí', async () => {
    await e.enTransaccion(async () => {
      expect((await e.comoUsuario(P.supervisor, () => e.intentar(() => corregir(P.supervisor, REGISTRO.vigSur, { hora_salida_final: '19:00' }, 'x'))))?.message).toMatch(/FUERA_DE_ALCANCE/)
      expect(await e.comoUsuario(P.administracion, () => e.intentar(() => corregir(P.administracion, REGISTRO.vigSur, { hora_salida_final: '19:00' }, 'ok')))).toBeNull()
    })
  })
  it('un vigilador no puede usar los procedimientos de corrección', async () => {
    await e.enTransaccion(async () => {
      expect((await e.comoUsuario(P.vigilador, () => e.intentar(() => corregir(P.vigilador, REGISTRO.vigNorte, { hora_salida_final: '23:00' }, 'x'))))?.message).toMatch(/No autorizado/)
      expect((await intentarComo(P.vigilador, `select registrar_cobertura($1,$2,'carga_supervisor','08:00','20:00',null,'x')`, [TURNO.vigNorteManiana, P.vigilador.id]))?.message).toMatch(/No autorizado/)
    })
  })
})

// ── Relevo desde Reportes = «Cerrar turno» (mismo componente y misma función) ──
// El modal precarga un tramo por cada registro con entrada (vigilador efectivo,
// horario final o real) y el usuario agrega el del relevo. Se reproduce acá esa
// construcción y se llama a cerrar_turno, igual que desde Revisión Operativa.
async function turnoLiq(turnoId: string) { const t = await turnoRow(turnoId); return { ...t, fecha: fechaIso(t.fecha) } }
const sinMs = (r: any) => ({ ...r, hora_entrada_real: s(r.hora_entrada_real), hora_salida_real: s(r.hora_salida_real), hora_entrada_final: s(r.hora_entrada_final), hora_salida_final: s(r.hora_salida_final) })
/** Exactamente lo que precarga la ventana (lib/cerrar-turno-tramos, la misma que usa CerrarTurnoModal). */
async function tramosComoElModal(turnoId: string) {
  let n = 0
  return tramosInicialesCierre(await turnoLiq(turnoId), (await registros(turnoId)).map(sinMs), () => `t${++n}`)
    .map(t => ({ guardia_id: t.guardia_id, hora_inicio: t.hora_inicio, hora_fin: t.hora_fin, sinHorario: t.sinHorario, horasReferencia: t.horasReferencia }))
}
async function omitidos(turnoId: string, tramos: Array<{ guardia_id: string }>) {
  return omitidosQueQuedanEnCero(await turnoLiq(turnoId), (await registros(turnoId)).map(sinMs), tramos)
}
const enviar = (tramos: any[]) => JSON.stringify(tramos.map(t => ({ guardia_id: t.guardia_id, hora_inicio: t.hora_inicio, hora_fin: t.hora_fin })))
async function relevoDesdeReportes(p: any, turnoId: string, tramoNuevo: object) {
  const tramos = await tramosComoElModal(turnoId)
  return como(p, `select cerrar_turno($1, $2::jsonb, 'Relevo cargado desde Reportes')`, [turnoId, enviar([...tramos, tramoNuevo])])
}

describe('Relevo desde Reportes (cerrar_turno, procedimiento vigente)', () => {
  it('normal: se retiró a las 14 y lo relevaron hasta las 20 → 6 + 6; turno completo para el cliente', async () => {
    await e.enTransaccion(async () => {
      const t = await turno('2026-11-10', '08:00', '20:00')
      const { rows: [r] } = await ingresoVigilador(t, '08:00')
      await egresoVigilador(r.id, '14:00', 6)
      await relevoDesdeReportes(P.supervisor, t, { guardia_id: P.vigiladorSur.id, hora_inicio: '14:00', hora_fin: '20:00' })
      expect(await horasLiquidacion(t)).toEqual({ [P.vigilador.id]: 6, [P.vigiladorSur.id]: 6 })
      expect(await horasFacturacion([t])).toEqual({ cubiertos: 12, descubiertos: 0 })
      const [orig] = (await registros(t)).filter((x: any) => x.id === r.id)
      expect([s(orig.hora_entrada_real), s(orig.hora_salida_real)]).toEqual(['08:00', '14:00'])
      expect((await auditoria(t)).map((a: any) => a.campo)).toEqual(expect.arrayContaining(['cerrar_turno', 'cerrar_turno_nuevo']))
    })
  })
  it('superpuesto: el relevo llegó 13:50 → lo resuelve cerrar_turno como siempre (6 y 6,17 → 6 al liquidar)', async () => {
    await e.enTransaccion(async () => {
      const t = await turno('2026-11-10', '08:00', '20:00')
      const { rows: [r] } = await ingresoVigilador(t, '08:00')
      await egresoVigilador(r.id, '14:00', 6)
      await relevoDesdeReportes(P.supervisor, t, { guardia_id: P.vigiladorSur.id, hora_inicio: '13:50', hora_fin: '20:00' })
      const h = (await registros(t)).map((x: any) => Number(x.horas_liquidables)).sort()
      expect(h).toEqual([6, 6.17])
      expect(await horasLiquidacion(t)).toEqual({ [P.vigilador.id]: 6, [P.vigiladorSur.id]: 6 })
    })
  })
  it('nocturno 20→08: se retiró a las 02 y lo relevaron hasta las 08 → 6 + 6', async () => {
    await e.enTransaccion(async () => {
      const t = await turno('2026-11-10', '20:00', '08:00')
      const { rows: [r] } = await ingresoVigilador(t, '20:00')
      await egresoVigilador(r.id, '02:00', 6)
      await relevoDesdeReportes(P.supervisor, t, { guardia_id: P.vigiladorSur.id, hora_inicio: '02:00', hora_fin: '08:00' })
      expect(await horasLiquidacion(t)).toEqual({ [P.vigilador.id]: 6, [P.vigiladorSur.id]: 6 })
      expect(await horasFacturacion([t])).toEqual({ cubiertos: 12, descubiertos: 0 })
    })
  })
  it('mismo resultado que desde Revisión Operativa (misma llamada, mismos tramos)', async () => {
    const correr = async (comentario: string) => {
      let out: any
      await e.enTransaccion(async () => {
        const t = await turno('2026-11-10', '08:00', '20:00')
        const { rows: [r] } = await ingresoVigilador(t, '08:00')
        await egresoVigilador(r.id, '14:00', 6)
        const tramos = [...await tramosComoElModal(t), { guardia_id: P.vigiladorSur.id, hora_inicio: '14:00', hora_fin: '20:00' }]
        await como(P.supervisor, `select cerrar_turno($1, $2::jsonb, $3)`, [t, enviar(tramos), comentario])
        out = { liq: await horasLiquidacion(t), fact: await horasFacturacion([t]),
          regs: (await registros(t)).map((x: any) => [x.guardia_id, s(x.hora_entrada_final), s(x.hora_salida_final), Number(x.horas_liquidables), x.origen_cobertura]).sort() }
      })
      return out
    }
    expect(await correr('Reportes')).toEqual(await correr('Revisión Operativa'))
  })
  it('permisos: el vigilador no puede; Administración sí', async () => {
    await e.enTransaccion(async () => {
      const t = await turno('2026-11-10', '08:00', '20:00')
      const tramo = { guardia_id: P.vigiladorSur.id, hora_inicio: '14:00', hora_fin: '20:00' }
      expect((await e.comoUsuario(P.vigilador, () => e.intentar(() => relevoDesdeReportes(P.vigilador, t, tramo))))?.message).toMatch(/No autorizado/)
      expect(await e.comoUsuario(P.administracion, () => e.intentar(() => relevoDesdeReportes(P.administracion, t, tramo)))).toBeNull()
    })
  })
  it('turno ya revisado: el supervisor no lo vuelve a cerrar, Administración sí (regla vigente)', async () => {
    await e.enTransaccion(async () => {
      const t = await turno('2026-11-10', '08:00', '20:00')
      const tramo = { guardia_id: P.vigilador.id, hora_inicio: '08:00', hora_fin: '20:00' }
      await relevoDesdeReportes(P.supervisor, t, tramo)
      expect((await e.comoUsuario(P.supervisor, () => e.intentar(() => relevoDesdeReportes(P.supervisor, t, tramo))))?.message).toMatch(/ya fue revisado/)
      expect(await e.comoUsuario(P.administracion, () => e.intentar(() => relevoDesdeReportes(P.administracion, t, tramo)))).toBeNull()
    })
  })
})

describe('Cerrar turno: precarga completa y advertencia (sólo interfaz)', () => {
  it('registro con horas reconocidas y sin horario: se precarga como «sin horario» con sus horas de referencia', async () => {
    await e.enTransaccion(async () => {
      const t = await turno('2026-11-10', '08:00', '20:00')
      await como(P.gerencia, `select autorizar_excepcion_asistencia(gen_random_uuid(), $1, 'Cliente confirmó presencia por nota escrita')`, [t])
      await como(P.supervisor, `select registrar_cobertura($1,$2,'confirmacion_supervisor',null,null,null,'Verificado en recorrida')`, [t, P.vigilador.id])
      const tramos = await tramosComoElModal(t)
      expect(tramos).toEqual([{ guardia_id: P.vigilador.id, hora_inicio: '', hora_fin: '', sinHorario: true, horasReferencia: 12 }])
      // si el usuario lo quitara, la advertencia lo muestra con sus horas
      expect(await omitidos(t, [])).toEqual([{ guardia_id: P.vigilador.id, horas: 12 }])
      // completando el horario, cerrar_turno calcula como siempre
      await como(P.supervisor, `select cerrar_turno($1, $2::jsonb, 'Horario confirmado')`, [t, enviar([{ ...tramos[0], hora_inicio: '08:00', hora_fin: '20:00' }])])
      expect(await horasLiquidacion(t)).toEqual({ [P.vigilador.id]: 12 })
    })
  })
  it('vigilador omitido por error: la advertencia lo detecta (nombre/horas) antes de confirmar', async () => {
    await e.enTransaccion(async () => {
      const t = await turno('2026-11-10', '08:00', '20:00')
      const { rows: [r] } = await ingresoVigilador(t, '08:00')
      await egresoVigilador(r.id, '14:00', 6)
      await corregir(P.supervisor, r.id, { hora_salida_final: '14:00' }, 'Se retiró')
      const soloRelevo = [{ guardia_id: P.vigiladorSur.id, hora_inicio: '14:00', hora_fin: '20:00' }]
      expect(await omitidos(t, soloRelevo)).toEqual([{ guardia_id: P.vigilador.id, horas: 6 }])
      expect(await omitidos(t, [...await tramosComoElModal(t), ...soloRelevo])).toEqual([])
    })
  })
  it('corrección legítima que deja horas en 0: con la confirmación, cerrar_turno aplica su regla de siempre', async () => {
    await e.enTransaccion(async () => {
      const t = await turno('2026-11-10', '08:00', '20:00')
      const { rows: [r] } = await ingresoVigilador(t, '08:00')
      await egresoVigilador(r.id, '20:00', 12)
      const tramos = [{ guardia_id: P.vigiladorSur.id, hora_inicio: '08:00', hora_fin: '20:00' }]  // el turno lo hizo otro
      expect(await omitidos(t, tramos)).toEqual([{ guardia_id: P.vigilador.id, horas: 12 }])
      await como(P.administracion, `select cerrar_turno($1, $2::jsonb, 'El fichaje era de otro vigilador')`, [t, enviar(tramos)])
      expect(await horasLiquidacion(t)).toEqual({ [P.vigilador.id]: 0, [P.vigiladorSur.id]: 12 })
      const [orig] = (await registros(t)).filter((x: any) => x.id === r.id)
      expect([s(orig.hora_entrada_real), s(orig.hora_salida_real), orig.comentario_final]).toEqual(['08:00', '20:00', 'No incluido en cobertura aprobada'])
    })
  })
  it('turno con varios vigiladores: precarga a todos; sin cambios en los tramos, nadie queda en 0', async () => {
    await e.enTransaccion(async () => {
      const t = await turno('2026-11-10', '08:00', '20:00')
      const { rows: [r] } = await ingresoVigilador(t, '08:00')
      await egresoVigilador(r.id, '12:00', 4)
      await corregir(P.supervisor, r.id, { hora_salida_final: '12:00' }, 'Tramo 1')
      await como(P.supervisor, `select registrar_cobertura($1,$2,'carga_supervisor','12:00','16:00',4,'Tramo 2')`, [t, P.vigiladorSur.id])
      await como(P.administracion, `select registrar_cobertura($1,$2,'carga_admin','16:00','20:00',4,'Tramo 3')`, [t, P.jefe.id])
      const tramos = await tramosComoElModal(t)
      expect(tramos.map(x => [x.guardia_id, x.hora_inicio, x.hora_fin]).sort()).toEqual([
        [P.vigilador.id, '08:00', '12:00'], [P.vigiladorSur.id, '12:00', '16:00'], [P.jefe.id, '16:00', '20:00']].sort())
      expect(await omitidos(t, tramos)).toEqual([])
      const antes = await horasLiquidacion(t)
      await como(P.supervisor, `select cerrar_turno($1, $2::jsonb, 'Cierre sin cambios')`, [t, enviar(tramos)])
      expect(await horasLiquidacion(t)).toEqual(antes)
      expect(antes).toEqual({ [P.vigilador.id]: 4, [P.vigiladorSur.id]: 4, [P.jefe.id]: 4 })
    })
  })
  it('un registro anulado no se precarga (antes se proponía como tramo)', async () => {
    await e.enTransaccion(async () => {
      const t = await turno('2026-11-10', '08:00', '20:00')
      const regId = (await como<any>(P.supervisor, `select registrar_cobertura($1,$2,'carga_supervisor','08:00','20:00',null,'Carga') id`, [t, P.vigilador.id])).rows[0].id
      await como(P.administracion, `select anular_registro_manual($1, 'Cargado por error en otro turno')`, [regId])
      expect((await tramosComoElModal(t)).map(x => x.guardia_id)).toEqual([P.vigilador.id])  // vuelve al turno programado
      expect((await tramosComoElModal(t))[0]).toMatchObject({ hora_inicio: '08:00', hora_fin: '20:00' })
      expect(await omitidos(t, [])).toEqual([])
    })
  })
})

// ── Permisos de supervisión sobre asistencias (20261221120000, sólo permisos) ──
// La migración se aplica dentro de cada transacción: el resto del archivo sigue probando
// las funciones tal cual están en producción.
const MIG_PERMISOS = join(__dirname, '..', '..', 'supabase', 'migrations', '20261221120000_asistencia_jefatura_y_auditoria_por_alcance.sql')
const ROLLBACK_PERMISOS = join(__dirname, '..', '..', 'supabase', 'rollback', '20261221120000_asistencia_jefatura_y_auditoria_por_alcance_rollback.sql')
async function turnoSur(fecha = '2026-11-10') {
  const id = `5b000000-0000-4000-8000-${String(++nTurno).padStart(12, '0')}`
  await e.q(`insert into turnos (id, guardia_id, objetivo_id, puesto_id, fecha, hora_inicio, hora_fin, estado, publicado)
             values ($1,$2,$3,'40000000-0000-4000-8000-000000000002',$4,'08:00','20:00','programado',true)`, [id, P.vigiladorSur.id, OBJETIVO.sur, fecha])
  return id
}
const leeHistorial = async (p: any, turnoId: string) =>
  (await como<any>(p, `select count(*)::int n from registros_asistencia_auditoria where turno_id = $1`, [turnoId])).rows[0].n > 0
const tramo12 = (g: string) => JSON.stringify([{ guardia_id: g, hora_inicio: '08:00', hora_fin: '20:00' }])
const cargaManual = async (p: any, t: string, g: string = P.vigilador.id) =>
  (await como<any>(p, `select registrar_cobertura($1,$2,'carga_supervisor','08:00','20:00',null,'Carga del supervisor') id`, [t, g])).rows[0].id as string
const puede = async (p: any, fn: () => Promise<unknown>) => (await e.comoUsuario(p, () => e.intentar(fn))) === null

/** Qué puede hacer cada perfil sobre asistencias (procedimientos reales). */
async function matrizPermisos() {
  const out: Record<string, Record<string, boolean>> = {}
  let k = 0
  const d = (n: number) => `2026-11-${String(4 + k * 8 + n).padStart(2, '0')}`
  const perfiles = [['supervisorZona', P.supervisor], ['jefe', P.jefe], ['administracion', P.administracion]] as const
  for (const [nombre, p] of perfiles) {
    const f: Record<string, boolean> = {}
    const t1 = await turno(d(0), '08:00', '20:00')
    const { rows: [r1] } = await ingresoVigilador(t1, '08:00')
    await egresoVigilador(r1.id, '20:00', 12)
    f.corregir = await puede(p, () => corregir(p, r1.id, { hora_salida_final: '19:00' }, 'Se retiró antes'))
    const t2 = await turno(d(1), '08:00', '20:00')
    f.cobertura = await puede(p, () => cargaManual(p, t2))
    const ts = await turnoSur(d(2))
    f.coberturaOtraZona = await puede(p, () => cargaManual(p, ts, P.vigiladorSur.id))
    const t3 = await turno(d(3), '08:00', '20:00')
    f.cerrarTurno = await puede(p, () => como(p, `select cerrar_turno($1,$2::jsonb,'Relevo')`, [t3, tramo12(P.vigilador.id)]))
    const t4 = await turno(d(4), '08:00', '20:00')
    await como(P.supervisor, `select cerrar_turno($1,$2::jsonb,'Primer cierre')`, [t4, tramo12(P.vigilador.id)])
    f.volverACerrar = await puede(p, () => como(p, `select cerrar_turno($1,$2::jsonb,'Corrección del relevo')`, [t4, tramo12(P.vigiladorSur.id)]))
    const reg = await cargaManual(P.supervisor, await turno(d(5), '08:00', '20:00'))
    f.anularCargaManual = await puede(p, () => como(p, `select anular_registro_manual($1,'Cargada en el turno equivocado')`, [reg]))
    f.historialSuZona = await leeHistorial(p, t1)
    const ts2 = await turnoSur(d(6))
    await cargaManual(P.administracion, ts2, P.vigiladorSur.id)
    f.historialOtraZona = await leeHistorial(p, ts2)
    out[nombre] = f
    k++
  }
  const tv = await turno('2026-11-28', '08:00', '20:00')
  await cargaManual(P.supervisor, tv)
  out.vigilador = { historial: await leeHistorial(P.vigilador, tv) }
  return out
}

describe('Permisos de supervisión sobre asistencias', () => {
  it('HOY: supervisor de zona corrige/carga/cierra en su zona; la jefatura (rol legado supervisor) no vuelve a cerrar, no anula y nadie salvo Administración ve el historial', async () => {
    await e.enTransaccion(async () => {
      const m = await matrizPermisos()
      expect(m.supervisorZona).toEqual({ corregir: true, cobertura: true, coberturaOtraZona: false, cerrarTurno: true, volverACerrar: false, anularCargaManual: false, historialSuZona: false, historialOtraZona: false })
      expect(m.jefe).toEqual({ corregir: true, cobertura: true, coberturaOtraZona: true, cerrarTurno: true, volverACerrar: false, anularCargaManual: false, historialSuZona: false, historialOtraZona: false })
      expect(m.administracion).toEqual({ corregir: true, cobertura: true, coberturaOtraZona: true, cerrarTurno: true, volverACerrar: true, anularCargaManual: true, historialSuZona: true, historialOtraZona: true })
      expect(m.vigilador).toEqual({ historial: false })
    })
  })
  it('CON LA CORRECCIÓN: la jefatura vuelve a cerrar y anula; el supervisor ve el historial sólo de su zona; lo demás igual', async () => {
    await e.enTransaccion(async () => {
      await e.aplicarArchivo(MIG_PERMISOS)
      const m = await matrizPermisos()
      expect(m.supervisorZona).toEqual({ corregir: true, cobertura: true, coberturaOtraZona: false, cerrarTurno: true, volverACerrar: false, anularCargaManual: false, historialSuZona: true, historialOtraZona: false })
      expect(m.jefe).toEqual({ corregir: true, cobertura: true, coberturaOtraZona: true, cerrarTurno: true, volverACerrar: true, anularCargaManual: true, historialSuZona: true, historialOtraZona: true })
      expect(m.administracion).toEqual({ corregir: true, cobertura: true, coberturaOtraZona: true, cerrarTurno: true, volverACerrar: true, anularCargaManual: true, historialSuZona: true, historialOtraZona: true })
      expect(m.vigilador).toEqual({ historial: false })
    })
  })
  it('las horas no cambian: lo que hace la jefatura da lo mismo que si lo hace Administración; fichaje y auditoría se conservan', async () => {
    const correr = async (p: any) => {
      let out: any
      await e.enTransaccion(async () => {
        await e.aplicarArchivo(MIG_PERMISOS)
        const t = await turno('2026-11-10', '08:00', '20:00')
        const { rows: [r] } = await ingresoVigilador(t, '08:00')
        await egresoVigilador(r.id, '14:00', 6)
        await como(P.supervisor, `select cerrar_turno($1,$2::jsonb,'Primer cierre')`, [t, JSON.stringify([{ guardia_id: P.vigilador.id, hora_inicio: '08:00', hora_fin: '14:00' }])])
        await como(p, `select cerrar_turno($1,$2::jsonb,'Se agrega el relevo')`, [t, JSON.stringify([
          { guardia_id: P.vigilador.id, hora_inicio: '08:00', hora_fin: '14:00' }, { guardia_id: P.vigiladorSur.id, hora_inicio: '14:00', hora_fin: '20:00' }])])
        const t2 = await turno('2026-11-11', '08:00', '20:00')
        const reg = await cargaManual(P.supervisor, t2)
        await como(p, `select anular_registro_manual($1,'Cargada en el turno equivocado')`, [reg])
        const [a] = await registros(t2)
        const orig = (await registros(t)).find((x: any) => x.id === r.id)
        out = {
          liq: await horasLiquidacion(t), fact: await horasFacturacion([t]),
          fichajeOriginal: [s(orig.hora_entrada_real), s(orig.hora_salida_real)],
          anulado: [a.id === reg, a.registro_anulado_at != null, Number(a.horas_liquidables)],
          auditoria: (await auditoria(t2)).map((x: any) => x.campo).sort(),
        }
      })
      return out
    }
    const jefe = await correr(P.jefe)
    expect(jefe).toEqual(await correr(P.administracion))
    expect(jefe.liq).toEqual({ [P.vigilador.id]: 6, [P.vigiladorSur.id]: 6 })
    expect(jefe.fact).toEqual({ cubiertos: 12, descubiertos: 0 })
    expect(jefe.fichajeOriginal).toEqual(['08:00', '14:00'])
    expect(jefe.anulado).toEqual([true, true, 0])
    expect(jefe.auditoria).toEqual(expect.arrayContaining(['registro_anulado', 'horas_liquidables']))
  })
  it('no se aplica sobre un cuerpo distinto del esperado, y el rollback deja las funciones como hoy', async () => {
    await e.enTransaccion(async () => {
      await e.aplicarArchivo(MIG_PERMISOS)
      expect(await e.intentar(() => e.aplicarArchivo(MIG_PERMISOS))).not.toBeNull()
    })
    await e.enTransaccion(async () => {
      const antes = { c: await md5('cerrar_turno'), a: await md5('anular_registro_manual') }
      await e.aplicarArchivo(MIG_PERMISOS)
      expect(await md5('cerrar_turno')).not.toBe(antes.c)
      expect(await md5('anular_registro_manual')).not.toBe(antes.a)
      await e.aplicarArchivo(ROLLBACK_PERMISOS)
      expect({ c: await md5('cerrar_turno'), a: await md5('anular_registro_manual') }).toEqual(antes)
      expect((await e.q<any>(`select count(*)::int n from pg_policies where policyname = 'registros_asistencia_auditoria_select_alcance'`)).rows[0].n).toBe(0)
    })
  })
})
