// Pruebas de la Fase 1 de seguridad sobre PGlite:
//   20261205120000_seguridad_rls_politicas_abiertas  (1.1 políticas abiertas)
//   20261205120100_seguridad_funciones_anon          (1.2 SECURITY DEFINER ejecutables por anon)
//   20261205120200_seguridad_search_path             (1.3 search_path mutable)
// El prelude reproduce las 14 tablas con sus grants y políticas de producción,
// los helpers de permisos con su cuerpo real, las 32 funciones del lint con su
// ACL real y las 18 funciones de search_path con su cuerpo real.
// Uso: PGLITE=<ruta a pglite/dist/index.js> node supabase/pruebas/seguridad-rls/run.mjs [raíz del repo]
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const { PGlite } = await import(process.env.PGLITE ? pathToFileURL(process.env.PGLITE).href : '@electric-sql/pglite')
const REPO = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const db = new PGlite()
process.on('unhandledRejection', e => { console.error('ERROR:', e.message, e.where ?? ''); process.exit(2) })
const resultados = []
const ok = (nombre, cond, extra = '') => { resultados.push([cond === true ? 'OK ' : 'FALLA', nombre, cond === true ? extra : `${extra} ${cond}`]) }

const MIGS = ['20261205120000_seguridad_rls_politicas_abiertas', '20261205120100_seguridad_funciones_anon', '20261205120200_seguridad_search_path']
const leerMig = m => readFileSync(`${REPO}/supabase/migrations/${m}.sql`, 'utf8')
const leerRb = m => readFileSync(`${REPO}/supabase/rollback/${m}_rollback.sql`, 'utf8')

// ── Identidades ─────────────────────────────────────────────────────────────
const AUTH = n => `00000000-0000-0000-0000-00000000${String(1000 + n).padStart(4, '0')}`
const UID = n => `00000000-0000-0000-0000-00000000${String(2000 + n).padStart(4, '0')}`
const P = { GER: 1, ADM: 2, JEFE: 3, SUP1: 4, SUP2: 5, VIG: 6, VIG2: 7, BAJA: 8, DIR: 9, SUPLEG: 10, SERGIO: 11 }
const Z1 = '00000000-0000-0000-0000-00000000a001', Z2 = '00000000-0000-0000-0000-00000000a002'
const OA = '00000000-0000-0000-0000-00000000b001', OB = '00000000-0000-0000-0000-00000000b002'
const TA = '00000000-0000-0000-0000-00000000c001', TB = '00000000-0000-0000-0000-00000000c002'

async function sql(texto, params) {  // DEBUG=1 muestra la consulta que falla
  try { return (await db.query(texto, params)).rows } catch (e) { if (process.env.DEBUG) console.error("SQL>", (await db.query("select current_user u, current_setting('search_path') sp")).rows[0], texto.slice(0, 80), e.message); throw e }
}
async function como(quien, fn) {
  // quien: número de persona | 'anon' | 'service_role'
  const rol = typeof quien === 'number' ? 'authenticated' : quien
  const sub = typeof quien === 'number' ? AUTH(quien) : ''
  await db.exec(`select set_config('request.jwt.claim.sub', '${sub}', false); set role ${rol};`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`) }
}
async function falla(fn, patron) {
  try { await fn(); return 'NO FALLÓ' } catch (e) { return patron.test(e.message) ? true : `otro error: ${e.message}` }
}
const n = async (texto, params) => (await sql(texto, params)).length
const SIN_PERMISO = /permission denied/
const RLS = /row-level security|row level security/

// ── Carga ───────────────────────────────────────────────────────────────────
await db.exec(readFileSync(new URL('./prelude.sql', import.meta.url), 'utf8'))
await db.exec(`
insert into zonas_operativas (id, nombre) values ('${Z1}', 'Zona 1'), ('${Z2}', 'Zona 2');
insert into usuarios (id, auth_user_id, rol, puesto_organizacional, nombre, acceso_bloqueado, acceso_admin_pleno) values
  ('${UID(1)}', '${AUTH(1)}', 'admin', 'gerencia', 'Gerencia', false, false),
  ('${UID(2)}', '${AUTH(2)}', 'admin', 'administracion', 'Administración', false, false),
  ('${UID(3)}', '${AUTH(3)}', 'supervisor', 'jefe_supervisores', 'Jefe', false, false),
  ('${UID(4)}', '${AUTH(4)}', 'supervisor', 'supervisor', 'Sup Zona 1', false, false),
  ('${UID(5)}', '${AUTH(5)}', 'supervisor', 'supervisor', 'Sup Zona 2', false, false),
  ('${UID(6)}', '${AUTH(6)}', 'guardia', 'vigilador', 'Vigilador', false, false),
  ('${UID(7)}', '${AUTH(7)}', 'guardia', 'vigilador', 'Vigilador 2', false, false),
  ('${UID(8)}', '${AUTH(8)}', 'admin', 'administracion', 'Admin de baja', true, false),
  ('${UID(9)}', '${AUTH(9)}', 'admin', 'direccion_operativa', 'Dirección', false, false),
  ('${UID(10)}', '${AUTH(10)}', 'supervisor', null, 'Sup legado', false, false),
  ('${UID(11)}', '${AUTH(11)}', 'admin', 'jefe_supervisores', 'Jefe con admin pleno', false, true);
insert into supervisor_zonas values ('${UID(4)}', '${Z1}'), ('${UID(5)}', '${Z2}'), ('${UID(10)}', '${Z1}');
insert into objetivos (id, nombre, zona_id) values ('${OA}', 'Objetivo A', '${Z1}'), ('${OB}', 'Objetivo B', '${Z2}');
insert into turnos (id, objetivo_id, guardia_id, fecha, hora_inicio, hora_fin) values
  ('${TA}', '${OA}', '${UID(6)}', current_date, '07:00', '19:00'),
  ('${TB}', '${OB}', '${UID(7)}', current_date, '07:00', '19:00');
insert into supervisor_intervenciones (turno_id, supervisor_id, tipo_alerta, accion, supervisor_guardia_id) values
  ('${TA}', '${UID(4)}', 'sin_ingreso', 'contactado', null), ('${TB}', '${UID(5)}', 'sin_ingreso', 'contactado', '${UID(5)}');
insert into solicitudes_admin (solicitante_id, tipo, entidad, estado) values
  ('${UID(4)}', 'crear_vigilador', 'usuarios', 'pendiente'), ('${UID(5)}', 'crear_vigilador', 'usuarios', 'pendiente');
insert into novedades (guardia_id, objetivo_id, tipo, descripcion) values
  ('${UID(6)}', '${OA}', 'general', 'novedad A'), ('${UID(7)}', '${OB}', 'general', 'novedad B');
insert into notificaciones_enviadas (usuario_id, tipo) values ('${UID(6)}', 'aviso'), ('${UID(4)}', 'aviso');
insert into push_subscriptions (usuario_id, endpoint, p256dh, auth) values
  ('${UID(6)}', 'https://push/vig', 'k1', 'a1'), ('${UID(4)}', 'https://push/sup1', 'k2', 'a2');
insert into turnos_base (id, nombre, hora_inicio, hora_fin) values ('00000000-0000-0000-0000-00000000d001', 'Diurno', '07:00', '19:00');
insert into servicios_objetivo (objetivo_id, turno_base_id) values
  ('${OA}', '00000000-0000-0000-0000-00000000d001'), ('${OB}', '00000000-0000-0000-0000-00000000d001');
insert into horarios_objetivo (objetivo_id, hora_inicio, hora_fin) values ('${OA}', '07:00', '19:00');
insert into asignaciones (horario_id, fecha) select id, current_date from horarios_objetivo;
insert into camaras (nombre) values ('Cam 1');
insert into alertas (tipo, mensaje) values ('x', 'y');
insert into planillas_mensuales (anio, mes) values (2026, 10);
insert into supervisor_guardia_reglas (nombre) values ('Regla');
insert into registros_asistencia (turno_id, guardia_id, hora_entrada_real)
  select id, guardia_id, '06:58' from turnos where id = '${TA}';
update turnos set fecha = current_date - 2 where id = '${TA}';
insert into fact_historial (dato) values ('h');
`)
ok('Prelude: el trigger crear_puesto_principal creó un puesto por objetivo', (await sql(`select count(*)::int c from puestos`))[0].c === 2)

// ── Fotos de estado (para comparar migración / rollback) ────────────────────
async function foto() {
  const pol = await sql(`select tablename, policyname, permissive, roles::text r, cmd, coalesce(qual,'') q, coalesce(with_check,'') w
    from pg_policies where schemaname = 'public' order by 1, 2`)
  const grants = await sql(`select table_name, grantee, privilege_type from information_schema.role_table_grants
    where table_schema = 'public' and grantee in ('anon','authenticated','service_role') order by 1, 2, 3`)
  const acl = await sql(`select p.oid::regprocedure::text f,
      coalesce((select string_agg(x, ',' order by x) from (select case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end || ':' || a.privilege_type x
                from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a) s), '') acl,
      coalesce(array_to_string(p.proconfig, ','), '') cfg
    from pg_proc p where p.pronamespace = 'public'::regnamespace order by 1`)
  return { pol: JSON.stringify(pol), grants: JSON.stringify(grants), acl: Object.fromEntries(acl.map(r => [r.f, r.acl + '|' + r.cfg])) }
}

// ── ANTES: el agujero existe ────────────────────────────────────────────────
await como(P.VIG, async () => {
  ok('ANTES: un vigilador lee TODAS las intervenciones de supervisores', await n(`select * from supervisor_intervenciones`) === 2)
  ok('ANTES: un vigilador lee las suscripciones push de otros', await n(`select * from push_subscriptions`) === 2)
  await db.exec(`begin`)
  ok('ANTES: un vigilador aprueba solicitudes admin y borra la programación', await n(`update solicitudes_admin set estado = 'aprobado' returning id`) === 2
    && await n(`delete from servicios_objetivo returning id`) === 2)
  await db.exec(`rollback`)
  ok('ANTES: un vigilador lee la tabla legada asignaciones', await n(`select * from asignaciones`) === 1)
})
await como('anon', async () => {
  ok('ANTES: anon ejecuta current_usuario_id()', (await sql(`select public.current_usuario_id() r`))[0].r === null)
  ok('ANTES: anon ejecuta crear_objetivo_operativo (entra al cuerpo)', await falla(() => sql(`select public.crear_objetivo_operativo($1,'x',null,null,null,null,null,null,null,null,null,null)`, [Z1]), /Zona fuera de alcance/))
})
// 1.3 antes: con un search_path de sesión distinto, las funciones sin SET fallan.
const horasAntes = (await sql(`select calcular_horas_liquidables('22:00','06:00','21:55','06:10') a, calcular_horas_liquidables('07:00','19:00','07:40','18:00') b,
  calcular_horas_reconocidas('22:00','06:00','21:55','06:10') c, fact_letra(6) d, fact_mes_prestacion('2026-01-01') e, evaluacion_numero_texto(8.80) f,
  grupo_orden_banco('supervisor', null) g, salida_anticipada_vigente('2026-10') h`))[0]
await db.exec(`begin`)
const cierreAntes = (await sql(`select * from public.cerrar_turnos_abiertos()`))[0]
const regAntes = (await sql(`select hora_salida_final::text s, horas_liquidables::text h, cierre_automatico c from registros_asistencia`))[0]
await db.exec(`rollback`)
ok('ANTES: cerrar_turnos_abiertos con search_path de sesión normal cierra 1 registro', cierreAntes.registros_cerrados === 1, JSON.stringify(regAntes))
await db.exec(`set search_path = pg_catalog`)
ok('ANTES: con search_path = pg_catalog, cerrar_turnos_abiertos (search_path mutable) se rompe',
  await falla(() => sql(`select * from public.cerrar_turnos_abiertos()`), /does not exist/))
await db.exec(`set search_path = public`)

const fotoAntes = await foto()

// ── Migraciones (dos veces: idempotentes) ───────────────────────────────────
for (const m of MIGS) await db.exec(leerMig(m))
const fotoDespues = await foto()
for (const m of MIGS) await db.exec(leerMig(m))
const fotoDespues2 = await foto()
ok('Migraciones idempotentes (segunda corrida = mismo estado)', JSON.stringify(fotoDespues) === JSON.stringify(fotoDespues2))

// ════════════════════════════════════════════════════════════════════════════
// 1.1 Políticas
// ════════════════════════════════════════════════════════════════════════════
ok('1.1 Ninguna política permisiva con true en las 14 tablas', (await sql(`select count(*)::int c from pg_policies where schemaname = 'public'
  and permissive = 'PERMISSIVE' and (qual = 'true' or with_check = 'true')`))[0].c === 0)
ok('1.1 acceso_bloqueado_baja sigue en las 14 tablas', (await sql(`select count(*)::int c from pg_policies where policyname = 'acceso_bloqueado_baja'
  and tablename <> 'turnos'`))[0].c === 14)

// supervisor_intervenciones
await como(P.VIG, async () => {
  ok('SI: vigilador ya no lee intervenciones', await n(`select * from supervisor_intervenciones`) === 0)
  ok('SI: vigilador no puede TRUNCATE (no pasa por RLS)', await falla(() => sql(`truncate supervisor_intervenciones cascade`), SIN_PERMISO))
  ok('SI: vigilador no inserta', await falla(() => sql(`insert into supervisor_intervenciones (turno_id) values ($1)`, [TA]), SIN_PERMISO))
})
await como(P.SUP1, async () => {
  ok('SI: supervisor zona 1 lee sólo las de su zona (lectura por alcance)', await n(`select * from supervisor_intervenciones where turno_id in ($1, $2)`, [TA, TB]) === 1)
})
await como(P.SUP2, async () => {
  ok('SI: supervisor zona 2 lee sólo la de su zona', (await sql(`select turno_id from supervisor_intervenciones`)).every(r => r.turno_id === TB))
})
await como(P.SUPLEG, async () => {
  ok('SI: supervisor legado (rol, sin puesto) lee su zona', await n(`select * from supervisor_intervenciones`) === 1)
})
for (const [nom, p] of [['jefe', P.JEFE], ['Administración', P.ADM], ['Gerencia', P.GER], ['Dirección', P.DIR]]) {
  await como(p, async () => { ok(`SI: ${nom} lee todas (alcance 'todas')`, await n(`select * from supervisor_intervenciones`) === 2) })
}
await como(P.ADM, async () => {
  ok('SI: lectura por supervisor_guardia_id (sync de reglas) sigue', await n(`select supervisor_guardia_id from supervisor_intervenciones where supervisor_guardia_id = $1`, [UID(5)]) === 1)
})
await como(P.BAJA, async () => { ok('SI: usuario dado de baja (acceso_bloqueado) no lee nada', await n(`select * from supervisor_intervenciones`) === 0) })
await como('anon', async () => { ok('SI: anon sin acceso', await falla(() => sql(`select * from supervisor_intervenciones`), SIN_PERMISO)) })
await como('service_role', async () => { ok('SI: service_role (procesos) lee todo', await n(`select * from supervisor_intervenciones`) === 2) })

// solicitudes_admin
let solNueva
await como(P.SUP1, async () => {
  const r = await sql(`insert into solicitudes_admin (solicitante_id, tipo, entidad, datos_json, estado) values ($1, 'baja_vigilador', 'usuarios', '{}', 'pendiente') returning id`, [UID(4)])
  solNueva = r[0]?.id
  ok('SOL: supervisor crea su solicitud pendiente y la ve (insert … select)', !!solNueva)
  ok('SOL: supervisor ve sólo las propias', (await sql(`select solicitante_id from solicitudes_admin`)).every(x => x.solicitante_id === UID(4)))
  ok('SOL: supervisor no crea a nombre de otro', await falla(() => sql(`insert into solicitudes_admin (solicitante_id, tipo, entidad) values ($1,'x','usuarios')`, [UID(5)]), RLS))
  ok('SOL: supervisor no crea una solicitud ya aprobada', await falla(() => sql(`insert into solicitudes_admin (solicitante_id, tipo, entidad, estado) values ($1,'x','usuarios','aprobado')`, [UID(4)]), RLS))
  ok('SOL: supervisor no se aprueba su propia solicitud', await n(`update solicitudes_admin set estado = 'aprobado' where id = $1 returning id`, [solNueva]) === 0)
  const rpc = (await sql(`select (public.resolver_solicitud_personal_operativo($1)).estado e`, [solNueva]))[0].e
  ok('SOL: la RPC resolver_solicitud_personal_operativo sigue funcionando (usa helper interno revocado)', rpc === 'aprobado')
})
await como(P.VIG, async () => {
  ok('SOL: vigilador no ve solicitudes', await n(`select * from solicitudes_admin`) === 0)
  ok('SOL: vigilador no crea solicitudes', await falla(() => sql(`insert into solicitudes_admin (solicitante_id, tipo, entidad) values ($1,'x','usuarios')`, [UID(6)]), RLS))
})
await como(P.ADM, async () => {
  ok('SOL: Administración ve todas', await n(`select * from solicitudes_admin`) === 3)
  ok('SOL: Administración aprueba (panel Solicitudes Admin)', await n(`update solicitudes_admin set estado = 'aprobado', aprobado_por = $1, fecha_aprobacion = now() where solicitante_id = $2 returning id`, [UID(2), UID(5)]) === 1)
  ok('SOL: nadie borra solicitudes desde la app', await falla(() => sql(`delete from solicitudes_admin`), SIN_PERMISO))
})
await como(P.JEFE, async () => { ok('SOL: jefe de supervisores (shell admin) ve y resuelve', await n(`update solicitudes_admin set comentario_admin = 'ok' returning id`) === 3) })
await como(P.SUP2, async () => { ok('SOL: otro supervisor no resuelve', await n(`update solicitudes_admin set comentario_admin = 'x' returning id`) === 0) })

// novedades
await como(P.VIG, async () => {
  ok('NOV: vigilador ve sólo las suyas', (await sql(`select guardia_id from novedades`)).every(r => r.guardia_id === UID(6)) && await n(`select * from novedades`) === 1)
  ok('NOV: vigilador carga una novedad propia', await n(`insert into novedades (guardia_id, objetivo_id, tipo, descripcion, estado) values ($1, $2, 'general', 'mía', 'pendiente') returning id`, [UID(6), OB]) === 1)
  ok('NOV: vigilador no carga a nombre de otro', await falla(() => sql(`insert into novedades (guardia_id, objetivo_id, tipo, descripcion) values ($1, $2, 'g', 'x')`, [UID(7), OB]), RLS))
  ok('NOV: vigilador no cambia estados', await n(`update novedades set estado = 'resuelta' returning id`) === 0)
})
await como(P.SUP1, async () => {
  ok('NOV: supervisor zona 1 ve las del objetivo de su zona (ficha del objetivo)', (await sql(`select objetivo_id from novedades`)).every(r => r.objetivo_id === OA))
  ok('NOV: supervisor zona 1 no toca novedades de la zona 2', await n(`update novedades set estado = 'resuelta' where objetivo_id = $1 returning id`, [OB]) === 0)
})
await como(P.ADM, async () => {
  ok('NOV: Administración ve todas (Panel / Novedades)', await n(`select * from novedades`) === 3)
  ok('NOV: Administración carga y resuelve', await n(`insert into novedades (objetivo_id, tipo, descripcion, estado) values ($1,'g','x','pendiente') returning id`, [OB]) === 1
    && await n(`update novedades set estado = 'resuelta' where objetivo_id = $1 returning id`, [OB]) === 3)
  ok('NOV: nadie borra novedades desde la app', await falla(() => sql(`delete from novedades`), SIN_PERMISO))
})

// notificaciones_enviadas
await como(P.VIG, async () => {
  ok('NOTIF: cada uno ve sólo las suyas', (await sql(`select usuario_id from notificaciones_enviadas`)).every(r => r.usuario_id === UID(6)))
  ok('NOTIF: el navegador no inserta (sólo el servidor)', await falla(() => sql(`insert into notificaciones_enviadas (usuario_id, tipo) values ($1, 'x')`, [UID(6)]), SIN_PERMISO))
})
await como('service_role', async () => {
  ok('NOTIF: service_role (rutas /api/push) inserta y lee todo', await n(`insert into notificaciones_enviadas (usuario_id, tipo) values ($1, 'x') returning id`, [UID(7)]) === 1
    && await n(`select * from notificaciones_enviadas`) === 3)
})

// push_subscriptions
await como(P.VIG, async () => {
  ok('PUSH: vigilador ve sólo su suscripción', (await sql(`select usuario_id from push_subscriptions`)).every(r => r.usuario_id === UID(6)) && await n(`select * from push_subscriptions`) === 1)
  ok('PUSH: no desactiva la de otro', await n(`update push_subscriptions set activo = false where usuario_id = $1 returning id`, [UID(4)]) === 0)
  ok('PUSH: no registra suscripción a nombre de otro', await falla(() => sql(`insert into push_subscriptions (usuario_id, endpoint, p256dh, auth) values ($1,'e','k','a')`, [UID(4)]), RLS))
  ok('PUSH: administra la propia', await n(`update push_subscriptions set activo = false where usuario_id = $1 returning id`, [UID(6)]) === 1)
})
await como('service_role', async () => { ok('PUSH: service_role (envíos) lee todas', await n(`select * from push_subscriptions`) === 2) })

// servicios_objetivo + turnos_base
await como(P.SUP1, async () => {
  ok('SRV: supervisor ve servicios de su zona con el turno base embebido', (await sql(`select s.objetivo_id, tb.nombre from servicios_objetivo s join turnos_base tb on tb.id = s.turno_base_id`))
    .every(r => r.objetivo_id === OA && r.nombre === 'Diurno'))
  ok('SRV: supervisor no da de alta servicios', await falla(() => sql(`insert into servicios_objetivo (objetivo_id, turno_base_id) values ($1,'00000000-0000-0000-0000-00000000d001')`, [OA]), RLS))
  ok('SRV: supervisor no edita servicios', await n(`update servicios_objetivo set activo = false returning id`) === 0)
  ok('TB: supervisor no edita turnos base', await falla(() => sql(`insert into turnos_base (nombre, hora_inicio, hora_fin) values ('x','00:00','08:00')`), RLS))
})
await como(P.VIG, async () => {
  ok('SRV: vigilador no ve servicios', await n(`select * from servicios_objetivo`) === 0)
  ok('TB: vigilador no ve turnos base', await n(`select * from turnos_base`) === 0)
})
await como(P.JEFE, async () => { ok('SRV: jefe de supervisores lee todos (alcance)', await n(`select * from servicios_objetivo`) === 2) })
await como(P.ADM, async () => {
  ok('SRV: Programación (Administración) da de alta y edita', await n(`insert into servicios_objetivo (objetivo_id, turno_base_id) values ($1,'00000000-0000-0000-0000-00000000d001') returning id`, [OB]) === 1
    && await n(`update servicios_objetivo set activo = not activo where objetivo_id = $1 returning id`, [OB]) === 2)
  ok('SRV: trigger validar_puesto_servicio sigue disparando', await falla(() => sql(`insert into servicios_objetivo (objetivo_id, turno_base_id, puesto_id)
    values ($1,'00000000-0000-0000-0000-00000000d001',(select id from puestos where objetivo_id = $2))`, [OA, OB]), /no pertenece al objetivo/))
  ok('TB: Turnos Base (Administración) alta y edición', await n(`insert into turnos_base (nombre, hora_inicio, hora_fin) values ('Nocturno','19:00','07:00') returning id`) === 1
    && await n(`update turnos_base set activo = true returning id`) === 2)
  ok('SRV/TB: no se borran desde la app', await falla(() => sql(`delete from servicios_objetivo`), SIN_PERMISO) === true && await falla(() => sql(`delete from turnos_base`), SIN_PERMISO) === true)
})
await como(P.SERGIO, async () => { ok('SRV: jefe con acceso_admin_pleno edita Programación', await n(`update servicios_objetivo set activo = activo returning id`) === 3) })
await como(P.DIR, async () => { ok('TB: Dirección operativa edita turnos base', await n(`update turnos_base set activo = activo returning id`) === 2) })

// legadas
for (const t of ['horarios_objetivo', 'asignaciones', 'reemplazos', 'planillas_mensuales', 'planilla_detalle', 'alertas', 'camaras']) {
  await como(P.GER, async () => { ok(`LEG: ${t} sin acceso para authenticated (ni Gerencia)`, await falla(() => sql(`select * from ${t}`), SIN_PERMISO)) })
  await como('service_role', async () => { ok(`LEG: ${t} sigue accesible para service_role`, Array.isArray(await sql(`select * from ${t}`))) })
}
ok('LEG: no se borró ningún dato legado', (await sql(`select (select count(*) from horarios_objetivo) + (select count(*) from asignaciones) + (select count(*) from camaras)
  + (select count(*) from alertas) + (select count(*) from planillas_mensuales) c`))[0].c == 5)

// ════════════════════════════════════════════════════════════════════════════
// 1.2 Funciones
// ════════════════════════════════════════════════════════════════════════════
const F32 = (await sql(`select p.oid::regprocedure::text f, p.prorettype = 'trigger'::regtype trg from pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname in (
  'acceso_habilitado_actual','alcanza_baja_vigilador_actual','alcanza_turno_actual','alcanza_zona_actual','anular_registro_manual',
  'corregir_fecha_registro_manual','crear_objetivo_operativo','crear_puesto_principal_por_defecto','current_user_role','current_usuario_id',
  'documental_areas_auditar','puede_gestionar_personal_operativo_actual','puede_resolver_salida_anticipada','resolver_solicitud_personal_operativo',
  'ronda_intervencion_registrar_zona','ronda_puntos_no_dejar_ronda_vacia','ronda_puntos_no_duplicado','rondas_base_exige_puntos',
  'salida_anticipada_en_alcance','salida_anticipada_puesto_actual','tareas_turno_validar_evidencia','tg_auditar_supervisores_guardia',
  'tg_touch_supervisor_guardia_reglas','trg_evaluacion_publicada_historial','trg_registro_alerta_salida','trg_registro_detectar_salida_anticipada',
  'trg_salidas_anticipadas_historial','trg_salidas_anticipadas_recalcular','turnos_auditar_alta','turnos_completar_puesto',
  'turnos_validar_superposicion','usuarios_proteger_campos_criticos')`))
ok('1.2 Las 32 funciones del lint existen en el prelude', F32.length === 32)
const A = ['acceso_habilitado_actual()', 'alcanza_turno_actual(uuid)', 'salida_anticipada_en_alcance(uuid)', 'anular_registro_manual(uuid,text)',
  'resolver_solicitud_personal_operativo(uuid)', 'crear_objetivo_operativo(uuid,text,text,text,text,uuid,integer,text,integer,boolean,time without time zone,time without time zone)']
const priv = async (rol, f) => (await sql(`select has_function_privilege($1, $2::regprocedure, 'EXECUTE') p`, [rol, f]))[0].p
let anonNinguna = true, srvTodas = true, authBien = true
for (const { f } of F32) {
  if (await priv('anon', f)) anonNinguna = false
  if (!(await priv('service_role', f))) srvTodas = false
  if ((await priv('authenticated', f)) !== A.includes(f)) { authBien = false; console.log('  authenticated mal en', f) }
}
ok('1.2 anon no ejecuta ninguna de las 32', anonNinguna)
ok('1.2 service_role ejecuta las 32', srvTodas)
ok('1.2 authenticated ejecuta exactamente las 6 de RLS/RPC', authBien)
ok('1.2 PUBLIC no figura en el ACL de ninguna', (await sql(`select count(*)::int c from pg_proc p, aclexplode(p.proacl) a where p.pronamespace = 'public'::regnamespace
  and a.grantee = 0 and p.proname in (${F32.map(x => `'${x.f.split('(')[0].replace('public.', '')}'`).join(',')})`))[0].c === 0)
ok('1.2 Ninguna SECURITY DEFINER de public queda ejecutable por anon', (await sql(`select count(*)::int c from pg_proc where pronamespace = 'public'::regnamespace
  and prosecdef and has_function_privilege('anon', oid, 'EXECUTE')`))[0].c === 0)
await como('anon', async () => {
  ok('1.2 anon: current_usuario_id() rechazada', await falla(() => sql(`select public.current_usuario_id()`), SIN_PERMISO))
  ok('1.2 anon: crear_objetivo_operativo rechazada', await falla(() => sql(`select public.crear_objetivo_operativo($1,'x',null,null,null,null,null,null,null,null,null,null)`, [Z1]), SIN_PERMISO))
  ok('1.2 anon: acceso_habilitado_actual rechazada', await falla(() => sql(`select public.acceso_habilitado_actual()`), SIN_PERMISO))
})
await como(P.SUP1, async () => {
  ok('1.2 authenticated: alcanza_turno_actual / salida_anticipada_en_alcance siguen (RLS)', (await sql(`select public.alcanza_turno_actual($1) a, public.salida_anticipada_en_alcance($1) b`, [TA]))[0].a === true)
  ok('1.2 salida_anticipada_en_alcance (SD) sigue usando el helper interno revocado', (await sql(`select public.salida_anticipada_en_alcance($1) b`, [TB]))[0].b === false)
  const o = (await sql(`select (public.crear_objetivo_operativo($1,'Nuevo Z1',null,null,null,null,null,null,null,null,null,null)).id id`, [Z1]))[0].id
  ok('1.2 RPC crear_objetivo_operativo (usa alcanza_zona_actual revocado) funciona', !!o)
  ok('1.2 trigger SD crear_puesto_principal disparó sin EXECUTE del invocador', (await sql(`select count(*)::int c from puestos where objetivo_id = $1`, [o]))[0].c === 1)
  ok('1.2 helper interno no se llama directo', await falla(() => sql(`select public.alcanza_zona_actual($1)`, [Z1]), SIN_PERMISO))
  ok('1.2 current_user_role() ya no se llama directo', await falla(() => sql(`select public.current_user_role()`), SIN_PERMISO))
  ok('1.2 corregir_fecha_registro_manual (sin uso en la app) ya no se llama', await falla(() => sql(`select public.corregir_fecha_registro_manual(null, null, null)`), SIN_PERMISO))
})
await como(P.ADM, async () => {
  await sql(`insert into turnos (objetivo_id, fecha, hora_inicio, hora_fin) values ($1, current_date, '07:00', '19:00')`, [OB])
  ok('1.2 trigger SD turnos_completar_puesto disparó (authenticated sin EXECUTE)', (await sql(`select count(*)::int c from turnos where objetivo_id = $1 and puesto_id is not null`, [OB]))[0].c === 2)
  await sql(`select public.anular_registro_manual(null, 'x')`)
  ok('1.2 RPC anular_registro_manual sigue ejecutable', true)
})
await como(P.JEFE, async () => {
  await sql(`update supervisor_guardia_reglas set nombre = 'Regla 2'`)
  ok('1.2 trigger SD tg_touch_supervisor_guardia_reglas disparó', (await sql(`select updated_at is not null t from supervisor_guardia_reglas`))[0].t === true)
})
await como(P.VIG, async () => {
  ok('1.2 trigger SD usuarios_proteger_campos_criticos sigue bloqueando', await falla(() => sql(`update usuarios set cuenta_bancaria = 'x' where id = $1`, [UID(6)]), /Gerencia/))
  ok('1.2 RLS con acceso_habilitado_actual sigue evaluando para authenticated', await n(`select * from novedades`) >= 1)
})
await como(P.VIG, async () => {
  for (const [f, args] of [['obtener_rondas_guardia_actual', ''], ['pausar_ronda', `null::uuid, 'x', now(), 'causa'`], ['reanudar_ronda', `null::uuid, 'x'`],
    ['registrar_cobertura', `null::uuid, null::uuid, 'x', '07:00'::time, '19:00'::time, 12::numeric, 'x'`]]) {
    ok(`1.2 RPC de fichaje/rondas ${f} sigue ejecutable por authenticated`, !!(await sql(`select public.${f}(${args}) r`))[0])
  }
})
await como(P.SUP1, async () => {
  for (const [f, args] of [['registrar_intervencion_operativa', `null::uuid, null::uuid, 'x', 'y', null::uuid, 'z', 'w', null::uuid, false`],
    ['autorizar_excepcion_asistencia', `null::uuid, null::uuid, 'x'`]]) {
    ok(`1.2 RPC de supervisión ${f} sigue ejecutable`, !!(await sql(`select public.${f}(${args}) r`))[0])
  }
})
// Sólo cambiaron las 32 (ACL) y las 18 (search_path).
const cambiadas = Object.keys(fotoDespues.acl).filter(f => fotoDespues.acl[f] !== fotoAntes.acl[f])
const nombres18 = ['asistencia_excepciones_inmutable', 'calcular_horas_liquidables', 'calcular_horas_reconocidas', 'cerrar_turnos_abiertos', 'evaluacion_numero_texto',
  'fact_comprobante_inmutable', 'fact_historial_inmutable', 'fact_letra', 'fact_mes_prestacion', 'grupo_orden_banco', 'repdoc_upsert_atomico', 'salida_anticipada_vigente',
  'set_actualizado_at', 'set_updated_at', 'touch_checklist_plantillas_updated_at', 'turnos_historial_inmutable', 'update_updated_at', 'validar_puesto_servicio']
const esperadas = new Set([...F32.map(x => x.f), ...nombres18.map(x => Object.keys(fotoAntes.acl).find(f => f.startsWith(`${x}(`)))])
ok('1.2/1.3 sólo cambiaron las 32 + 18 funciones previstas (ninguna RPC más)', cambiadas.length === esperadas.size && cambiadas.every(f => esperadas.has(f)),
  `cambiadas=${cambiadas.length} esperadas=${esperadas.size} ${cambiadas.filter(f => !esperadas.has(f)).join(' ')}`)

// ════════════════════════════════════════════════════════════════════════════
// 1.3 search_path
// ════════════════════════════════════════════════════════════════════════════
ok('1.3 Las 18 tienen search_path = public, pg_catalog', (await sql(`select count(*)::int c from pg_proc where pronamespace = 'public'::regnamespace
  and proname = any($1) and proconfig @> array['search_path=public, pg_catalog']`, [nombres18]))[0].c === 18)
const horasDespues = (await sql(`select calcular_horas_liquidables('22:00','06:00','21:55','06:10') a, calcular_horas_liquidables('07:00','19:00','07:40','18:00') b,
  calcular_horas_reconocidas('22:00','06:00','21:55','06:10') c, fact_letra(6) d, fact_mes_prestacion('2026-01-01') e, evaluacion_numero_texto(8.80) f,
  grupo_orden_banco('supervisor', null) g, salida_anticipada_vigente('2026-10') h`))[0]
ok('1.3 Mismo resultado en las funciones de cálculo (horas, letra, mes, texto, banco, vigencia)', JSON.stringify(horasAntes) === JSON.stringify(horasDespues), JSON.stringify(horasDespues))
await db.exec(`set search_path = pg_catalog`)
await db.exec(`begin`)
const cierreDespues = (await sql(`select * from public.cerrar_turnos_abiertos()`))[0]
const regDespues = (await sql(`select hora_salida_final::text s, horas_liquidables::text h, cierre_automatico c from public.registros_asistencia`))[0]
await db.exec(`rollback`)
ok('1.3 cerrar_turnos_abiertos funciona aun con search_path de sesión = pg_catalog y da lo mismo', cierreDespues.registros_cerrados === 1
  && JSON.stringify(regDespues) === JSON.stringify(regAntes), JSON.stringify(regDespues))
const r1 = (await sql(`select * from public.repdoc_upsert_atomico(gen_random_uuid(), 'ag', 'a/b.pdf', 'h1', 'b.pdf', 'pdf', 'application/pdf', 10, now(), now(), 'local', 'ms')`))[0]
const r2 = (await sql(`select * from public.repdoc_upsert_atomico(gen_random_uuid(), 'ag', 'a/b.pdf', 'h2', 'b.pdf', 'pdf', 'application/pdf', 11, now(), now(), 'local', 'ms')`))[0]
ok('1.3 repdoc_upsert_atomico igual (nuevo v1 → cambio de hash v2) con search_path ajeno', r1.out_fue_nuevo && r1.out_version_actual === 1 && r2.out_hash_cambio && r2.out_version_actual === 2)
ok('1.3 trigger set_actualizado_at disparó', (await sql(`select actualizado_at > creado_at t from public.repositorio_documental`))[0].t === true)
await db.exec(`set search_path = public`)
const antesUpd = (await sql(`select updated_at from turnos where id = $1`, [TB]))[0].updated_at
await sql(`update turnos set estado = 'programado' where id = $1`, [TB])
ok('1.3 trigger update_updated_at (INVOKER) disparó', (await sql(`select updated_at from turnos where id = $1`, [TB]))[0].updated_at > antesUpd)
ok('1.3 trigger fact_historial_inmutable sigue bloqueando', await falla(() => sql(`update fact_historial set dato = 'x'`), /no se modifica/))

// ════════════════════════════════════════════════════════════════════════════
// Rollback y vuelta
// ════════════════════════════════════════════════════════════════════════════
for (const m of [...MIGS].reverse()) await db.exec(leerRb(m))
const fotoRb = await foto()
ok('ROLLBACK: políticas idénticas a producción', fotoRb.pol === fotoAntes.pol)
ok('ROLLBACK: grants de tablas idénticos', fotoRb.grants === fotoAntes.grants)
const difRb = Object.keys(fotoAntes.acl).filter(f => fotoRb.acl[f] !== fotoAntes.acl[f])
ok('ROLLBACK: ACL y search_path de funciones idénticos', difRb.length === 0, difRb.map(f => f + ' antes=' + fotoAntes.acl[f] + ' rb=' + fotoRb.acl[f]).slice(0, 2).join(' / '))
await como(P.VIG, async () => { ok('ROLLBACK: (vuelve el comportamiento anterior) vigilador lee todas las intervenciones', await n(`select * from supervisor_intervenciones`) === 2) })
for (const m of MIGS) await db.exec(leerMig(m))
const fotoVuelta = await foto()
ok('IDA Y VUELTA: re-aplicar deja el mismo estado que la primera aplicación', JSON.stringify(fotoVuelta) === JSON.stringify(fotoDespues))
await como(P.VIG, async () => { ok('IDA Y VUELTA: vigilador otra vez sin intervenciones', await n(`select * from supervisor_intervenciones`) === 0) })

// ── El archivo de verificación posterior da todo true ───────────────────────
const verif = await sql(readFileSync(new URL('./verificacion-seguridad.sql', import.meta.url), 'utf8'))
ok('VERIFICACIÓN: verificacion-seguridad.sql da ok en todas sus filas', verif.length > 0 && verif.every(r => r.ok === true),
  verif.filter(r => r.ok !== true).map(r => r.control).join(' | '))

// ── Resultado ───────────────────────────────────────────────────────────────
for (const [e, nom, x] of resultados) console.log(`${e} ${nom}${x ? '  — ' + x : ''}`)
const fallas = resultados.filter(r => r[0] === 'FALLA').length
console.log(`\n${resultados.length - fallas}/${resultados.length} OK`)
process.exit(fallas ? 1 : 0)
