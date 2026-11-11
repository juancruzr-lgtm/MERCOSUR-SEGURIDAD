// legajo_datos_solicitud (20261211100000): los datos de la solicitud se ven desde el
// legajo SÓLO para Administración/Gerencia. PGlite, personas ficticias, sin producción.
import { nuevaBase, migracion, P, cargarPersonas, como, intenta, informe } from './base.mjs'

const t = informe()
const db = await nuevaBase()
await db.exec(`
  create table public.legajo_datos_personales (empleado_id uuid primary key references public.usuarios(id), fecha_nacimiento date, lugar_nacimiento text, nacionalidad text,
    domicilio_calle text, domicilio_numero text, domicilio_piso_depto text, domicilio_localidad text, domicilio_provincia text, domicilio_cp text,
    fecha_ingreso date, actualizado_por uuid);
  create table public.legajo_cambios_datos (id uuid primary key default gen_random_uuid(), empleado_id uuid, campo text, valor_anterior text, valor_nuevo text,
    origen text, estado text, motivo text, creado_por uuid, creado_auth uuid, revisado_por uuid, revisado_at timestamptz,
    constraint legajo_cambios_datos_origen_check check (origen in ('vigilador','administracion')));
  alter table auth.users add column encrypted_password text, add column last_sign_in_at timestamptz;
  create function extensions.crypt(p text, h text) returns text language sql immutable as $$ select 'h:' || p $$;
  create function public.puede_gestionar_personal_actual() returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
    select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' and u.puesto_organizacional in ('administracion','gerencia')) $$;
`)
await cargarPersonas(db)
for (const m of ['20261208100000_fichaje_solo_activos', '20261208100100_accesos_password', '20261208110000_postulaciones', '20261208120000_postulacion_lecturas_ia', '20261211100000_legajo_datos_solicitud']) {
  const r = await intenta(() => db.exec(migracion(`migrations/${m}.sql`)))
  t.check(`migración ${m} aplica`, r.ok, r.error)
}
const rpc = (p, sql, params = []) => como(db, p, () => intenta(() => db.query(sql, params)))
const dv = (c) => { const w = [5,4,3,2,7,6,5,4,3,2]; let s = 0; for (let i = 0; i < 10; i++) s += +c[i] * w[i]; let v = 11 - (s % 11); if (v === 11) v = 0; if (v === 10) v = 9; return c + v }

let r = await rpc(P.administracion, `select public.postulacion_crear($1::jsonb) id`, [JSON.stringify({
  apellido: 'Legajo', nombre: 'Solicitud Ficticia', dni: '42111444', cuil: dv('2042111444'), telefono: '5493415550010',
  fecha_nacimiento: '1994-04-04', domicilio_calle: 'Calle Ficticia', domicilio_localidad: 'Rosario', domicilio_provincia: 'Santa Fe',
  email: 'legajo.ficticio@example.test', observaciones: 'Buena presencia',
  datos_seleccion: { estado_civil: 'Soltero', hijos: '2', estudios: 'Secundario completo', talle_calzado: '42' } })])
const id = r.r?.rows[0].id
t.check('se carga la postulación con datos de la solicitud', r.ok, r.error)
await rpc(P.administracion, `select public.postulacion_registrar_archivo($1, '55555555-0000-0000-0000-000000000001', 'jpg', 'image/jpeg', 1500, $2, 1::smallint)`, [id, 'd'.repeat(64)])
await rpc(P.administracion, `select public.postulacion_marcar_revisada($1)`, [id])
await rpc(P.administracion, `select public.postulacion_aprobar($1, current_date, null)`, [id])
r = await rpc(P.gerencia, `select public.postulacion_alta_efectiva($1) a`, [id])
const emp = r.r?.rows[0].a.usuario_id
t.check('alta efectiva', r.ok && !!emp, r.error)

r = await rpc(P.administracion, `select public.legajo_datos_solicitud($1) s`, [emp])
const s = r.r?.rows[0].s
t.check('Administración ve los datos de la solicitud desde el legajo', r.ok && s?.datos?.estado_civil === 'Soltero' && s?.datos?.talle_calzado === '42', r.error ?? JSON.stringify(s))
t.check('…con las observaciones y la foto original', s?.observaciones === 'Buena presencia' && s?.archivos?.length === 1)
r = await rpc(P.gerencia, `select public.legajo_datos_solicitud($1) s`, [emp])
t.check('Gerencia también', r.ok && r.r.rows[0].s?.datos?.hijos === '2')
r = await rpc(P.supervisor, `select public.legajo_datos_solicitud($1) s`, [emp])
t.check('Supervisión NO (devuelve null)', r.ok && r.r.rows[0].s === null, r.error)
r = await rpc(P.guardiaActivo, `select public.legajo_datos_solicitud($1) s`, [emp])
t.check('un vigilador NO (devuelve null)', r.ok && r.r.rows[0].s === null, r.error)
r = await rpc(P.administracion, `select public.legajo_datos_solicitud($1) s`, [P.guardiaActivo.id])
t.check('empleado que no entró por Postulantes: null', r.ok && r.r.rows[0].s === null, r.error)
const anon = await intenta(() => db.query(`set local role anon; select public.legajo_datos_solicitud($1)`, [emp]))
t.check('sin sesión (anon) no puede ejecutarla', !anon.ok)

const rb = await intenta(() => db.exec(migracion('rollback/20261211100000_legajo_datos_solicitud_rollback.sql')))
t.check('el rollback aplica', rb.ok, rb.error)
t.fin()
