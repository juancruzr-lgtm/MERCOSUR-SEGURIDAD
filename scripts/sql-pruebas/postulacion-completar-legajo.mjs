// postulacion_completar_legajo (20261211110000): la solicitud de alguien que YA es
// empleado completa su legajo sin pisar lo que tiene. PGlite, personas ficticias.
import { nuevaBase, migracion, P, cargarPersonas, como, intenta, informe } from './base.mjs'

const t = informe()
const db = await nuevaBase()
await db.exec(`
  create table public.legajo_datos_personales (empleado_id uuid primary key references public.usuarios(id), fecha_nacimiento date, lugar_nacimiento text, nacionalidad text,
    domicilio_calle text, domicilio_numero text, domicilio_piso_depto text, domicilio_localidad text, domicilio_provincia text, domicilio_cp text,
    fecha_ingreso date, actualizado_at timestamptz, actualizado_por uuid);
  create table public.legajo_cambios_datos (id uuid primary key default gen_random_uuid(), empleado_id uuid, campo text, valor_anterior text, valor_nuevo text,
    origen text, estado text, motivo text, creado_por uuid, creado_auth uuid, revisado_por uuid, revisado_at timestamptz, creado_at timestamptz default now(),
    constraint legajo_cambios_datos_origen_check check (origen in ('vigilador','administracion')));
  create table public.legajo_campos (campo text primary key, tipo text);
  insert into public.legajo_campos values ('fecha_nacimiento','fecha'),('lugar_nacimiento','texto'),('nacionalidad','texto'),('domicilio_calle','texto'),
    ('domicilio_numero','texto'),('domicilio_piso_depto','texto'),('domicilio_localidad','texto'),('domicilio_provincia','texto'),('domicilio_cp','texto');
  create function public.legajo_aplicar(p_empleado uuid, p_campo text, p_valor text, p_actor uuid) returns void language plpgsql security definer set search_path = public, pg_catalog as $f$
  declare v_tipo text;
  begin
    v_tipo := (select c.tipo from public.legajo_campos c where c.campo = p_campo);
    if v_tipo is null then raise exception 'Campo inexistente'; end if;
    insert into public.legajo_datos_personales (empleado_id) values (p_empleado) on conflict (empleado_id) do nothing;
    execute format('update public.legajo_datos_personales set %I = $1::%s, actualizado_at = now(), actualizado_por = $2 where empleado_id = $3',
                   p_campo, case v_tipo when 'fecha' then 'date' else 'text' end)
      using nullif(btrim(coalesce(p_valor, '')), ''), p_actor, p_empleado;
  end $f$;
  alter table auth.users add column encrypted_password text, add column last_sign_in_at timestamptz;
  create function extensions.crypt(p text, h text) returns text language sql immutable as $$ select 'h:' || p $$;
  create function public.puede_gestionar_personal_actual() returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
    select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' and u.puesto_organizacional in ('administracion','gerencia')) $$;
`)
await cargarPersonas(db)
for (const m of ['20261208100000_fichaje_solo_activos', '20261208100100_accesos_password', '20261208110000_postulaciones', '20261208120000_postulacion_lecturas_ia', '20261211100000_legajo_datos_solicitud', '20261211110000_postulacion_completar_legajo']) {
  const r = await intenta(() => db.exec(migracion(`migrations/${m}.sql`)))
  t.check(`migración ${m} aplica`, r.ok, r.error)
}
const rpc = (p, sql, params = []) => como(db, p, () => intenta(() => db.query(sql, params)))
const dv = (c) => { const w = [5,4,3,2,7,6,5,4,3,2]; let s = 0; for (let i = 0; i < 10; i++) s += +c[i] * w[i]; let v = 11 - (s % 11); if (v === 11) v = 0; if (v === 10) v = 9; return c + v }

// Empleado existente FICTICIO: DNI y CUIL, legajo con calle cargada, sin celular ni email.
const emp = '11111111-0000-0000-0000-000000000099'
const cuil = dv('2043555666')
await db.query(`insert into public.usuarios (id, nombre, apellido, dni, cuil, legajo, rol, estado, puesto_organizacional) values ($1, 'Existente', 'Ficticio', '43555666', $2, 'T-99', 'guardia', 'activo', 'vigilador')`, [emp, cuil])
await db.query(`insert into public.legajo_datos_personales (empleado_id, domicilio_calle, domicilio_localidad) values ($1, 'Calle Vieja', 'Rosario')`, [emp])

let r = await rpc(P.administracion, `select public.postulacion_crear($1::jsonb) id`, [JSON.stringify({
  apellido: 'Ficticio', nombre: 'Existente', dni: '43555666', cuil, telefono: '5493415550077', email: 'existente.ficticio@example.test',
  fecha_nacimiento: '1990-05-05', lugar_nacimiento: 'Rosario', domicilio_calle: 'Calle Nueva', domicilio_numero: '123', domicilio_localidad: 'rosario',
  domicilio_provincia: 'Santa Fe', datos_seleccion: { estado_civil: 'Casado', talle_calzado: '43' } })])
const id = r.r?.rows[0].id
t.check('se carga la solicitud del empleado existente', r.ok, r.error)
r = await rpc(P.administracion, `select * from public.postulacion_duplicados('43555666', null, null, null, $1)`, [id])
t.check('el control de duplicados lo encuentra en el personal', r.ok && r.r.rows.some(x => x.donde === 'personal' && x.referencia_id === emp), r.error)

r = await rpc(P.supervisor, `select public.postulacion_completar_legajo($1, $2)`, [id, emp])
t.check('Supervisión NO puede completar legajos', !r.ok)
r = await rpc(P.administracion, `select public.postulacion_completar_legajo($1, $2)`, [id, P.guardiaActivo.id])
t.check('no se puede vincular a otro empleado (no coincide DNI/CUIL)', !r.ok && /no coincide/.test(r.error ?? ''), r.error)
await rpc(P.administracion, `select public.postulacion_guardar($1, '{"campos_dudosos":["dni"]}'::jsonb)`, [id])
r = await rpc(P.administracion, `select public.postulacion_completar_legajo($1, $2)`, [id, emp])
t.check('con datos dudosos sin confirmar, no deja', !r.ok && /dudosos/.test(r.error ?? ''), r.error)
await rpc(P.administracion, `select public.postulacion_guardar($1, '{"campos_dudosos":[]}'::jsonb)`, [id])

r = await rpc(P.administracion, `select public.postulacion_completar_legajo($1, $2) j`, [id, emp])
const j = r.r?.rows[0].j
t.check('Administración completa el legajo', r.ok, r.error)
const l = (await db.query(`select * from public.legajo_datos_personales where empleado_id = $1`, [emp])).rows[0]
t.check('carga lo que faltaba (nacimiento, número, provincia)', String(l.fecha_nacimiento).includes('1990') && l.domicilio_numero === '123' && l.domicilio_provincia === 'Santa Fe' && j.cargados.includes('fecha_nacimiento'), JSON.stringify(j))
t.check('NO pisa la calle que ya tenía: queda pendiente para Administración', l.domicilio_calle === 'Calle Vieja' && j.a_revisar.includes('domicilio_calle'))
const pend = (await db.query(`select * from public.legajo_cambios_datos where empleado_id = $1 and estado = 'pendiente'`, [emp])).rows
t.check('…en Control de cambios, con origen solicitud de empleo', pend.length === 1 && pend[0].campo === 'domicilio_calle' && pend[0].valor_nuevo === 'Calle Nueva' && pend[0].origen === 'solicitud_empleo')
t.check('mismo dato con distinta mayúscula no se toca', j.iguales.includes('domicilio_localidad') && l.domicilio_localidad === 'Rosario')
t.check('lo cargado queda en el historial como aplicado', (await db.query(`select count(*)::int n from public.legajo_cambios_datos where empleado_id = $1 and estado = 'aplicado' and origen = 'solicitud_empleo'`, [emp])).rows[0].n === 4)
const u = (await db.query(`select telefono, email, estado from public.usuarios where id = $1`, [emp])).rows[0]
t.check('celular y email vacíos se completan', u.telefono === '5493415550077' && u.email === 'existente.ficticio@example.test')
t.check('el empleado no cambia de estado ni se crea otro', u.estado === 'activo' && (await db.query(`select count(*)::int n from public.usuarios where dni = '43555666'`)).rows[0].n === 1)
const p = (await db.query(`select estado, usuario_id from public.postulaciones where id = $1`, [id])).rows[0]
t.check('la postulación queda "legajo_completado" y vinculada', p.estado === 'legajo_completado' && p.usuario_id === emp)
r = await rpc(P.administracion, `select public.legajo_datos_solicitud($1) s`, [emp])
t.check('el legajo muestra los datos de la solicitud', r.ok && r.r.rows[0].s?.datos?.talle_calzado === '43', r.error)
r = await rpc(P.administracion, `select public.postulacion_completar_legajo($1, $2)`, [id, emp])
t.check('no se puede repetir (ya cerrada)', !r.ok)

// Email y celular existentes nunca se reemplazan
const emp2 = '11111111-0000-0000-0000-000000000098'
await db.query(`insert into public.usuarios (id, nombre, apellido, dni, legajo, rol, estado, email, telefono) values ($1, 'Otro', 'Ficticio', '43555777', 'T-98', 'guardia', 'activo', 'su.usuario@example.test', '5493410000000')`, [emp2])
r = await rpc(P.administracion, `select public.postulacion_crear($1::jsonb) id`, [JSON.stringify({ apellido: 'Ficticio', nombre: 'Otro', dni: '43555777', email: 'otro.distinto@example.test', telefono: '5493415550088' })])
r = await rpc(P.administracion, `select public.postulacion_completar_legajo($1, $2) j`, [r.r.rows[0].id, emp2])
const u2 = (await db.query(`select telefono, email from public.usuarios where id = $1`, [emp2])).rows[0]
t.check('el email y el celular que ya tiene NO se reemplazan', r.ok && u2.email === 'su.usuario@example.test' && u2.telefono === '5493410000000', r.error)

const rb = await intenta(() => db.exec(migracion('rollback/20261211110000_postulacion_completar_legajo_rollback.sql')))
t.check('el rollback aplica', rb.ok, rb.error)
t.fin()
