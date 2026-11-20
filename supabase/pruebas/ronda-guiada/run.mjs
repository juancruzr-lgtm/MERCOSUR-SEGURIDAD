// Pruebas de 20261218120000_ronda_guiada.sql sobre PGlite (SIN producción).
// rondas_base / ronda_puntos / protocolo_versiones se recrean con los
// controles de producción que afectan a este flujo.
// Uso: PGLITE_MODULE=<ruta a pglite/dist/index.js> node supabase/pruebas/ronda-guiada/run.mjs [raíz]
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite')
const REPO = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const db = new PGlite()
const resultados = []
const ok = (n, c, x = '') => resultados.push([c ? 'OK ' : 'FALLA', n, x])
const sql = async (t, p) => (await db.query(t, p)).rows
async function como(uid, fn) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role authenticated;`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`) }
}
async function falla(fn) { try { await fn(); return null } catch (e) { return e.message } }

const JEFE = '00000000-0000-0000-0000-0000000000b1', VIG = '00000000-0000-0000-0000-0000000000b2', OTRO = '00000000-0000-0000-0000-0000000000b3'
const SUP = '00000000-0000-0000-0000-0000000000b4', SUP2 = '00000000-0000-0000-0000-0000000000b5'
const U_JEFE = '20000000-0000-0000-0000-000000000001', U_VIG = '20000000-0000-0000-0000-000000000002', U_SUP = '20000000-0000-0000-0000-000000000004', U_SUP2 = '20000000-0000-0000-0000-000000000005'
const OBJ = '30000000-0000-0000-0000-000000000001', OBJ2 = '30000000-0000-0000-0000-000000000002', OBJ3 = '30000000-0000-0000-0000-000000000003'
const P1 = '30000000-0000-0000-0000-0000000000a1', P2 = '30000000-0000-0000-0000-0000000000a2', P3 = '30000000-0000-0000-0000-0000000000a3'

await db.exec(readFileSync(`${REPO}/supabase/pruebas/protocolos/prelude.sql`, 'utf8'))
await db.exec(`
alter table public.objetivos add column lat numeric, add column lng numeric, add column radio_metros integer, add column created_at timestamptz default now();
alter table public.puestos add constraint puestos_id_obj unique (id, objetivo_id);
create or replace function public.alcanza_objetivo(p_usuario_id uuid, p_objetivo_id uuid) returns boolean language sql stable as $$ select p_usuario_id = '${U_SUP}' and p_objetivo_id in ('${OBJ}', '${OBJ2}', '${OBJ3}') $$;
create or replace function public.puede_administrar_rondas_objetivo(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.puesto_organizacional in ('jefe_supervisores','gerencia','supervisor')) $$;
create or replace function public.protocolo_puede_preparar() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.puesto_organizacional in ('jefe_supervisores','gerencia','direccion_operativa')) $$;
grant execute on function public.alcanza_objetivo(uuid, uuid), public.puede_administrar_rondas_objetivo(uuid), public.protocolo_puede_preparar() to authenticated;
create table public.protocolo_versiones (
  id uuid primary key default gen_random_uuid(), objetivo_id uuid not null, puesto_id uuid, numero integer not null, titulo text not null, texto text not null,
  texto_sha256 text not null, fuente_tipo text not null, fuente_descripcion text not null, asociacion text not null default 'confirmada',
  asociacion_confirmada_por uuid, asociacion_confirmada_at timestamptz, estado text not null default 'borrador'
  check (estado in ('borrador','pendiente_aprobacion','vigente','reemplazado','descartado')), enviado_aprobacion_por uuid, enviado_aprobacion_at timestamptz,
  devuelto_motivo text, creado_por uuid, creado_at timestamptz default now());
create table public.rondas_base (
  id uuid primary key default gen_random_uuid(), objetivo_id uuid not null references public.objetivos(id), puesto_id uuid not null,
  nombre text not null, descripcion text, intervalo_minutos integer not null check (intervalo_minutos between 15 and 10080),
  activo boolean not null default true, version integer not null default 1, creado_por uuid, actualizado_por uuid,
  created_at timestamptz default now(), updated_at timestamptz default now(), hora_inicio time,
  foreign key (puesto_id, objetivo_id) references public.puestos(id, objetivo_id));
create table public.ronda_puntos (
  id uuid primary key default gen_random_uuid(), ronda_base_id uuid not null references public.rondas_base(id), nombre text not null,
  descripcion text, orden integer not null, foto_requerida boolean not null default true, gps_requerido boolean not null default true,
  latitud double precision, longitud double precision, precision_metros double precision, radio_metros double precision, activo boolean not null default true,
  created_at timestamptz default now(), updated_at timestamptz default now(), origen_posicion text check (origen_posicion in ('gps','manual')),
  politica_foto text not null check (politica_foto in ('obligatoria','opcional','solo_novedad')), posicion_capturada_at timestamptz,
  check ((not gps_requerido) or (latitud is not null and longitud is not null and radio_metros is not null)), unique (ronda_base_id, orden));
create function public.pv_nace_borrador() returns trigger language plpgsql as $$ begin
  if new.estado <> 'borrador' then raise exception 'Una version de protocolo nace como borrador'; end if; return new; end $$;
create trigger t_pv_borrador before insert on public.protocolo_versiones for each row execute function public.pv_nace_borrador();
create function public.politica_foto() returns trigger language plpgsql as $$ begin
  if tg_op = 'INSERT' and new.politica_foto is null then new.politica_foto := case when new.foto_requerida then 'obligatoria' else 'opcional' end; end if; return new; end $$;
create trigger t_pol before insert or update on public.ronda_puntos for each row execute function public.politica_foto();
create function public.rb_exige() returns trigger language plpgsql as $$ begin
  if new.activo and not exists (select 1 from public.ronda_puntos rp where rp.ronda_base_id = new.id and rp.activo) then raise exception 'No se puede activar una ronda sin puntos'; end if; return new; end $$;
create trigger t_exige before insert or update of activo on public.rondas_base for each row execute function public.rb_exige();
insert into public.usuarios (id, auth_user_id, puesto_organizacional, nombre) values
  ('${U_JEFE}', '${JEFE}', 'jefe_supervisores', 'Aldo'), ('${U_VIG}', '${VIG}', 'vigilador', 'Martín'),
  (gen_random_uuid(), '${OTRO}', 'vigilador', 'Otro'), ('${U_SUP}', '${SUP}', 'supervisor', 'Sergio'), ('${U_SUP2}', '${SUP2}', 'supervisor', 'Otra zona');
insert into public.objetivos (id, nombre, lat, lng, radio_metros, created_at) values
  ('${OBJ}', 'Depósito', -32.95, -60.65, 100, now() - interval '30 days'),
  ('${OBJ2}', 'Planta nueva', -32.95, -60.65, 100, now()),
  ('${OBJ3}', 'Planta frecuencia propia', -32.95, -60.65, 100, now());
insert into public.puestos (id, objetivo_id, nombre) values ('${P1}', '${OBJ}', 'P1'), ('${P2}', '${OBJ2}', 'P2'), ('${P3}', '${OBJ3}', 'P3');
insert into public.turnos (guardia_id, objetivo_id, puesto_id, fecha, hora_inicio, hora_fin) values
  ('${U_VIG}', '${OBJ}', '${P1}', (now() at time zone 'America/Argentina/Buenos_Aires')::date, '06:00', '18:00'),
  ('${U_VIG}', '${OBJ2}', '${P2}', (now() at time zone 'America/Argentina/Buenos_Aires')::date, '06:00', '18:00'),
  ('${U_VIG}', '${OBJ3}', '${P3}', (now() at time zone 'America/Argentina/Buenos_Aires')::date, '06:00', '18:00');
`)

await db.exec(readFileSync(`${REPO}/supabase/migrations/20261218120000_ronda_guiada.sql`, 'utf8'))
ok('migración aplica', true)

const pendiente = uid => como(uid, async () => (await sql(`select public.ronda_guiada_mi_pendiente() r`))[0].r)
const marcar = (uid, obj, n, lat, lng, prec = 6, cap = null) => como(uid, async () => (await sql(`select public.ronda_guiada_marcar_punto($1, $2, $3, $4, $5, $6) r`, [obj, n, lat, lng, prec, cap]))[0].r)

// Apagado: sin solicitud ni pedido automático, no se pide nada.
ok('apagado: el vigilador no ve pedidos', (await pendiente(VIG)).length === 0)
ok('apagado: no puede marcar puntos', /pendiente/.test(await falla(() => marcar(VIG, OBJ, 1, -32.95, -60.65)) ?? ''))

// Solicitud de supervisión
ok('vigilador no puede solicitar', !!(await falla(() => como(VIG, () => sql(`select public.ronda_guiada_solicitar($1)`, [OBJ])))))
await como(JEFE, () => sql(`select public.ronda_guiada_solicitar($1)`, [OBJ]))
const p = await pendiente(VIG)
ok('con solicitud, el vigilador de turno la ve', p.length === 1 && p[0].objetivo === 'Depósito' && p[0].frecuencia_minutos === 120, JSON.stringify(p))
ok('otro vigilador sin turno no la ve', (await pendiente(OTRO)).length === 0)

// Validaciones
ok('sin turno no puede marcar', /turno/.test(await falla(() => marcar(OTRO, OBJ, 1, -32.95, -60.65)) ?? ''))
ok('GPS con más de ±30 m rechazado', /impreciso/.test(await falla(() => marcar(VIG, OBJ, 1, -32.95, -60.65, 35)) ?? ''))
ok('fuera del área del objetivo rechazado', /fuera_del_objetivo/.test(await falla(() => marcar(VIG, OBJ, 1, -32.952, -60.65)) ?? ''))
ok('punto 2 antes del 1 rechazado', /punto 1/.test(await falla(() => marcar(VIG, OBJ, 2, -32.95, -60.65)) ?? ''))
await marcar(VIG, OBJ, 1, -32.9500, -60.6500, 7)
ok('puntos indistinguibles (11 m con ±7 y ±6) rechazados', /indistinguible/.test(await falla(() => marcar(VIG, OBJ, 2, -32.9501, -60.6500, 6)) ?? ''))
ok('punto a 14 m con ±7 y ±6 sí se acepta (sin mínimo fijo)', true) // se prueba abajo con otra ronda
const antes = (await sql(`select now() t`))[0].t
const r = await marcar(VIG, OBJ, 2, -32.95077, -60.6500, 6)
ok('punto 2 válido: ronda ACTIVA al instante', r.ok && r.frecuencia_minutos === 120 && r.distancia >= 84 && r.distancia <= 88, JSON.stringify(r))
const [g] = await sql(`select g.estado, g.capturada_por, rb.activo, rb.created_at >= $1 as sin_retroactivo,
  (select count(*)::int from public.ronda_puntos p where p.ronda_base_id = rb.id and p.politica_foto = 'opcional' and p.radio_metros >= 25) puntos
  from public.ronda_guiada g join public.rondas_base rb on rb.id = g.ronda_base_id where g.objetivo_id = $2`, [antes, OBJ])
ok('activa, 2 puntos, configurada por el vigilador, creada al activar (sin ventanas hacia atrás)',
  g.estado === 'activa' && g.activo === true && g.puntos === 2 && g.capturada_por === U_VIG && g.sin_retroactivo === true, JSON.stringify(g))
ok('ya no se le pide más', (await pendiente(VIG)).filter(x => x.objetivo === 'Depósito').length === 0)
ok('historial: punto 1 y activada', (await sql(`select string_agg(accion, ',' order by id) a from public.ronda_guiada_eventos`))[0].a === 'solicitada,punto_1,activada')

// Pedido automático sólo para objetivos nuevos
await sql(`update public.ronda_guiada_config set pedido_automatico = true, objetivos_desde = now() - interval '1 hour'`)
const auto = await pendiente(VIG)
ok('automático: sólo objetivos creados desde la activación', auto.map(x => x.objetivo).sort().join() === 'Planta frecuencia propia,Planta nueva', JSON.stringify(auto.map(x => x.objetivo)))
await sql(`update public.objetivos set frecuencia_ronda_minutos = 90 where id = $1`, [OBJ3])
await marcar(VIG, OBJ3, 1, -32.9500, -60.6500, 7)
const r3 = await marcar(VIG, OBJ3, 2, -32.95013, -60.6500, 6)
ok('usa la frecuencia del objetivo (90) y acepta 14 m con ±7/±6', r3.frecuencia_minutos === 90 && r3.distancia >= 14, JSON.stringify(r3))

// El vigilador no puede llegar a un extremo
ok('motivo inválido rechazado', !!(await falla(() => como(VIG, () => sql(`select public.ronda_guiada_reportar_problema($1, 'x')`, [OBJ2])))))
await como(VIG, () => sql(`select public.ronda_guiada_reportar_problema($1, 'cerrado', 'Portón del fondo con candado')`, [OBJ2]))
const [rv] = await sql(`select estado, motivo_revision, ronda_base_id from public.ronda_guiada where objetivo_id = $1`, [OBJ2])
ok('no puede llegar: requiere revisión, sin ronda creada', rv.estado === 'requiere_revision' && rv.motivo_revision === 'cerrado' && rv.ronda_base_id === null, JSON.stringify(rv))
ok('en revisión no se le vuelve a pedir', (await pendiente(VIG)).length === 0)
await como(JEFE, () => sql(`select public.ronda_guiada_solicitar($1)`, [OBJ2]))
ok('supervisión vuelve a pedirlo', (await pendiente(VIG)).some(x => x.objetivo === 'Planta nueva'))

// Desactivar con motivo
const gid = (await sql(`select id from public.ronda_guiada where objetivo_id = $1`, [OBJ]))[0].id
ok('desactivar sin motivo no se puede', !!(await falla(() => como(JEFE, () => sql(`select public.ronda_guiada_desactivar($1, '')`, [gid])))))
await como(JEFE, () => sql(`select public.ronda_guiada_desactivar($1, 'Puntos marcados desde la garita')`, [gid]))
ok('desactivada: la ronda deja de exigirse', (await sql(`select rb.activo from public.ronda_guiada g join public.rondas_base rb on rb.id = g.ronda_base_id where g.id = $1`, [gid]))[0].activo === false)
ok('nadie escribe directo la tabla', !!(await falla(() => como(JEFE, () => sql(`update public.ronda_guiada set estado = 'activa'`)))))
ok('historial inmutable', !!(await falla(() => sql(`delete from public.ronda_guiada_eventos`))))

// Protocolo guiado
const enviar = (uid, obj) => como(uid, async () => (await sql(`select public.protocolo_guiado_enviar($1, 'Protocolo del puesto — X', 'PROTOCOLO…') r`, [obj]))[0].r)
ok('vigilador no puede enviar protocolo', !!(await falla(() => enviar(VIG, OBJ2))))
ok('supervisor de otra zona no puede', !!(await falla(() => enviar(SUP2, OBJ2))))
const pr = await enviar(SUP, OBJ2)
const [pv] = await sql(`select estado, enviado_aprobacion_por, asociacion from public.protocolo_versiones where id = $1`, [pr.id])
ok('supervisor de la zona lo envía: pendiente de aprobación (no vigente)', pv.estado === 'pendiente_aprobacion' && pv.enviado_aprobacion_por === U_SUP && pv.asociacion === 'confirmada', JSON.stringify(pv))
ok('no se duplica mientras espera aprobación', /esperando aprobación/.test(await falla(() => enviar(SUP, OBJ2)) ?? ''))
ok('supervisor no puede devolver/aprobar', !!(await falla(() => como(SUP, () => sql(`select public.protocolo_guiado_devolver($1, 'x')`, [pr.id])))))
await como(JEFE, () => sql(`select public.protocolo_guiado_devolver($1, 'Falta el teléfono del encargado')`, [pr.id]))
ok('jefe lo devuelve con motivo', (await sql(`select estado, devuelto_motivo from public.protocolo_versiones where id = $1`, [pr.id]))[0].devuelto_motivo === 'Falta el teléfono del encargado')

const fallas = resultados.filter(r => r[0] !== 'OK ')
for (const r of resultados) console.log(r.join(' · '))
console.log(`\n${resultados.length - fallas.length}/${resultados.length} OK`)
process.exit(fallas.length ? 1 : 0)
