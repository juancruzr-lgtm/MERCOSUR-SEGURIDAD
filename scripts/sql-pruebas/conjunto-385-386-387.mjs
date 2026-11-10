// Verificación CONJUNTA de #385 + #386 + #387: las 4 migraciones en orden sobre una
// misma base (PGlite, sin producción, personas ficticias) y el circuito completo.
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
await db.query(`insert into auth.users (id, email, encrypted_password) select auth_user_id, email, 'h:' || dni from public.usuarios`)

for (const m of ['20261208100000_fichaje_solo_activos', '20261208100100_accesos_password', '20261208110000_postulaciones', '20261208120000_postulacion_lecturas_ia']) {
  const r = await intenta(() => db.exec(migracion(`migrations/${m}.sql`)))
  t.check(`migración ${m} aplica en orden`, r.ok, r.error)
}

const rpc = (p, sql, params = []) => como(db, p, () => intenta(() => db.query(sql, params)))
const dv = (c) => { const w = [5,4,3,2,7,6,5,4,3,2]; let s = 0; for (let i = 0; i < 10; i++) s += +c[i] * w[i]; let v = 11 - (s % 11); if (v === 11) v = 0; if (v === 10) v = 9; return c + v }

// 1. Administración carga la entrevista (Postulantes) ────────────────────────
let r = await rpc(P.administracion, `select public.postulacion_crear($1::jsonb) id`, [JSON.stringify({
  apellido: 'Conjunto', nombre: 'Prueba Ficticia', dni: '42111333', cuil: dv('2042111333'), telefono: '5493415550009',
  fecha_nacimiento: '1996-02-02', domicilio_calle: 'Calle Ficticia', domicilio_localidad: 'Rosario', domicilio_provincia: 'Santa Fe',
  email: 'conjunto.ficticio@example.test', campos_dudosos: ['telefono'] })])
const id = r.r?.rows[0].id
t.check('Administración carga la entrevista', r.ok, r.error)
t.check('el postulante NO es empleado: no existe en usuarios', (await db.query(`select count(*)::int n from public.usuarios where dni = '42111333'`)).rows[0].n === 0)
t.check('…por lo tanto no puede tener turnos ni fichajes (sin fila de empleado)', (await db.query(`select count(*)::int n from public.registros_asistencia r join public.usuarios u on u.id = r.guardia_id where u.dni = '42111333'`)).rows[0].n === 0)

// 2. Lectura IA registrada (simulada) no modifica la postulación ───────────────
await rpc(P.administracion, `select public.postulacion_registrar_archivo($1, '44444444-0000-0000-0000-000000000001', 'jpg', 'image/jpeg', 1500, $2, 1::smallint)`, [id, 'c'.repeat(64)])
r = await rpc(P.administracion, `select public.postulacion_preparar_lectura($1) j`, [id])
t.check('la lectura IA se autoriza con foto cargada', r.ok, r.error)
await rpc(P.administracion, `select public.postulacion_registrar_lectura($1, 'gemini-3.5-flash', null, 1, 1, null, 'ok', '{}'::jsonb, array['telefono'], null)`, [id])
t.check('registrar la lectura no toca los datos', (await db.query(`select estado from public.postulaciones where id = $1`, [id])).rows[0].estado === 'entrevistado')

// 3. Revisión y aprobación ─────────────────────────────────────────────────
r = await rpc(P.administracion, `select public.postulacion_marcar_revisada($1)`, [id])
t.check('con un dato dudoso no se puede revisar', !r.ok)
await rpc(P.administracion, `select public.postulacion_guardar($1, '{"campos_dudosos":[]}'::jsonb)`, [id])
r = await rpc(P.administracion, `select public.postulacion_marcar_revisada($1)`, [id])
t.check('confirmado el dudoso, queda revisada', r.ok, r.error)
r = await rpc(P.supervisor, `select public.postulacion_aprobar($1, current_date, null)`, [id])
t.check('Supervisión no aprueba', !r.ok)
r = await rpc(P.administracion, `select public.postulacion_aprobar($1, current_date, null)`, [id])
t.check('Administración aprueba el ingreso', r.ok, r.error)

// 4. Alta efectiva + acceso con DNI y cambio obligatorio (lo que hace la ruta) ─
r = await rpc(P.gerencia, `select public.postulacion_alta_efectiva($1) a`, [id])
const nuevo = r.r?.rows[0].a.usuario_id
t.check('Gerencia da el alta efectiva', r.ok && nuevo, r.error)
// La ruta /api/postulaciones/[id]/alta: ensureEmployeeAuth (cuenta con DNI) + marcarCambioObligatorio
const authNuevo = '99999999-0000-0000-0000-000000000099'
await db.query(`insert into auth.users (id, email, encrypted_password) values ($1, 'conjunto.ficticio@example.test', 'h:42111333')`, [authNuevo])
await db.query(`update public.usuarios set auth_user_id = $1 where id = $2`, [authNuevo, nuevo])
await db.query(`insert into public.accesos_password (usuario_id, cambio_obligatorio, obligatorio_desde, motivo, marcado_por) values ($1, true, now(), 'alta', $2)`, [nuevo, P.gerencia.id])
await db.query(`insert into public.accesos_password_eventos (usuario_id, evento, actor) values ($1, 'alta_con_dni', $2)`, [nuevo, P.gerencia.id])
const PN = { auth: authNuevo }

r = await como(db, PN, () => intenta(() => db.query(`select public.mi_acceso_password() j`)))
t.check('primer ingreso: la app pide la contraseña personal (obligatorio)', r.ok && r.r.rows[0].j.obligatorio === true)

// 5. Mientras tanto PUEDE fichar (el cambio pendiente no bloquea la operación) ──
r = await como(db, PN, () => intenta(() => db.query(`insert into public.registros_asistencia (guardia_id, hora_entrada_real) values ($1, '08:00') returning id`, [nuevo])))
t.check('con el cambio pendiente igual puede fichar', r.ok, r.error)

// 6. Cambia la contraseña → se registra, sin guardarla ─────────────────────────
await db.query(`update auth.users set encrypted_password = 'h:ClavePersonal7' where id = $1`, [authNuevo])
r = await como(db, PN, () => intenta(() => db.query(`select public.mi_acceso_registrar_cambio() ok`)))
t.check('cambio registrado (la base verificó que ya no es el DNI)', r.ok && r.r.rows[0].ok === true)
r = await como(db, PN, () => intenta(() => db.query(`select public.mi_acceso_password() j`)))
t.check('ya no se le pide', r.ok && r.r.rows[0].j.obligatorio === false)
const ev = (await db.query(`select string_agg(evento, ',' order by id) e from public.accesos_password_eventos where usuario_id = $1`, [nuevo])).rows[0].e
t.check('historial de acceso: alta_con_dni → cambio_realizado (sin contraseñas)', ev === 'alta_con_dni,cambio_realizado', ev)

// 7. Duplicado: la misma persona no entra dos veces ─────────────────────────
r = await rpc(P.administracion, `select public.postulacion_crear($1::jsonb) id`, [JSON.stringify({ apellido: 'Conjunto', dni: '42111333' })])
const id2 = r.r?.rows[0].id
r = await rpc(P.administracion, `select count(*)::int n from public.postulacion_duplicados('42111333', null, null, null, $1)`, [id2])
t.check('una nueva entrevista del mismo DNI muestra que ya es empleado', r.ok && r.r.rows[0].n === 1)

// 8. Baja: deja de poder fichar; su historial queda ───────────────────────────
await db.query(`update public.usuarios set estado = 'inactivo' where id = $1`, [nuevo])
r = await como(db, PN, () => intenta(() => db.query(`insert into public.registros_asistencia (guardia_id, hora_entrada_real) values ($1, '09:00')`, [nuevo])))
t.check('dado de baja (inactivo) ya no puede fichar', !r.ok)
r = await como(db, PN, () => intenta(() => db.query(`select count(*)::int n from public.registros_asistencia where guardia_id = $1`, [nuevo])))
t.check('su fichaje anterior sigue registrado', r.ok && r.r.rows[0].n === 1)

t.fin()
