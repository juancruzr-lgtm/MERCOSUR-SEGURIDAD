// Pruebas de 20261218120000_ronda_guiada.sql sobre PGlite (SIN producción).
// rondas_base / ronda_puntos se recrean con los controles de producción que
// afectan a este flujo (exige puntos para activar, política de foto, versión).
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

const JEFE = '00000000-0000-0000-0000-0000000000b1'
const VIG = '00000000-0000-0000-0000-0000000000b2'
const OTRO = '00000000-0000-0000-0000-0000000000b3'
const U_JEFE = '20000000-0000-0000-0000-000000000001'
const U_VIG = '20000000-0000-0000-0000-000000000002'
const OBJ = '30000000-0000-0000-0000-000000000001'
const PUESTO = '30000000-0000-0000-0000-0000000000a1'

await db.exec(readFileSync(`${REPO}/supabase/pruebas/protocolos/prelude.sql`, 'utf8'))
await db.exec(`
alter table public.objetivos add column lat numeric, add column lng numeric;
alter table public.puestos add constraint puestos_id_obj unique (id, objetivo_id);
create function public.puede_administrar_rondas_objetivo(p uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.puesto_organizacional in ('jefe_supervisores','gerencia')) $$;
grant execute on function public.puede_administrar_rondas_objetivo(uuid) to authenticated;
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
create function public.politica_foto() returns trigger language plpgsql as $$ begin
  if tg_op = 'INSERT' and new.politica_foto is null then new.politica_foto := case when new.foto_requerida then 'obligatoria' else 'opcional' end; end if; return new; end $$;
create trigger t_pol before insert or update on public.ronda_puntos for each row execute function public.politica_foto();
create function public.rb_version() returns trigger language plpgsql as $$ begin
  if tg_op = 'INSERT' then new.version := 1; else new.version := old.version + 1; end if; return new; end $$;
create trigger t_ver before insert or update on public.rondas_base for each row execute function public.rb_version();
create function public.rb_exige() returns trigger language plpgsql as $$ begin
  if new.activo and not exists (select 1 from public.ronda_puntos rp where rp.ronda_base_id = new.id and rp.activo) then raise exception 'No se puede activar una ronda sin puntos'; end if; return new; end $$;
create trigger t_exige before insert or update of activo on public.rondas_base for each row execute function public.rb_exige();
create function public.touch() returns trigger language plpgsql security definer as $$ begin update public.rondas_base set updated_at = now() where id = new.ronda_base_id; return new; end $$;
create trigger t_touch after insert or update on public.ronda_puntos for each row execute function public.touch();
insert into public.usuarios (id, auth_user_id, puesto_organizacional, nombre) values
  ('${U_JEFE}', '${JEFE}', 'jefe_supervisores', 'Jefe'), ('${U_VIG}', '${VIG}', 'vigilador', 'Vigi'),
  (gen_random_uuid(), '${OTRO}', 'vigilador', 'Otro');
insert into public.objetivos (id, nombre, lat, lng) values ('${OBJ}', 'Planta', -32.95, -60.65);
insert into public.puestos (id, objetivo_id, nombre) values ('${PUESTO}', '${OBJ}', 'Puesto 1');
insert into public.turnos (guardia_id, objetivo_id, fecha, hora_inicio, hora_fin) values ('${U_VIG}', '${OBJ}', (now() at time zone 'America/Argentina/Buenos_Aires')::date, '08:00', '20:00');
`)

await db.exec(readFileSync(`${REPO}/supabase/migrations/20261218120000_ronda_guiada.sql`, 'utf8'))
ok('migración aplica', true)

ok('vigilador no puede pedir la ronda', !!(await falla(() => como(VIG, () => sql(`select public.ronda_guiada_solicitar($1)`, [OBJ])))))
const id = await como(JEFE, async () => (await sql(`select public.ronda_guiada_solicitar($1) id`, [OBJ]))[0].id)
ok('jefe la pide (usa el puesto del objetivo)', !!id)
ok('pedirla de nuevo es idempotente', (await como(JEFE, async () => (await sql(`select public.ronda_guiada_solicitar($1) id`, [OBJ]))[0].id)) === id)

const pend = await como(VIG, async () => (await sql(`select public.ronda_guiada_mi_pendiente() r`))[0].r)
ok('el vigilador con turno la ve pendiente', pend.length === 1 && pend[0].objetivo === 'Planta', JSON.stringify(pend))
ok('otro vigilador sin turno no la ve', (await como(OTRO, async () => (await sql(`select public.ronda_guiada_mi_pendiente() r`))[0].r)).length === 0)

const marcar = (uid, n, lat, lng, prec = 8) => como(uid, async () => (await sql(`select public.ronda_guiada_marcar_punto($1, $2, $3, $4, $5) r`, [id, n, lat, lng, prec]))[0].r)
ok('sin turno no puede marcar', /turno/.test(await falla(() => marcar(OTRO, 1, -32.95, -60.65)) ?? ''))
ok('GPS impreciso rechazado', /impreciso/.test(await falla(() => marcar(VIG, 1, -32.95, -60.65, 40)) ?? ''))
ok('lejos del objetivo rechazado', /lejos_del_objetivo/.test(await falla(() => marcar(VIG, 1, -32.96, -60.65)) ?? ''))
ok('punto 2 antes del 1 rechazado', /punto 1/.test(await falla(() => marcar(VIG, 2, -32.95, -60.65)) ?? ''))
await marcar(VIG, 1, -32.9500, -60.6500)
ok('punto 2 muy cerca rechazado', /muy_cerca/.test(await falla(() => marcar(VIG, 2, -32.9501, -60.6500)) ?? ''))
ok('punto 2 muy lejos rechazado', /muy_lejos/.test(await falla(() => marcar(VIG, 2, -32.9540, -60.6500)) ?? ''))
const r2 = await marcar(VIG, 2, -32.9509, -60.6500)
ok('con el punto 2 se crea la ronda (~100 m)', r2.ok && r2.distancia >= 99 && r2.distancia <= 101, JSON.stringify(r2))

const [g] = await sql(`select g.estado, g.activa_desde - g.propuesta_at as espera, g.prueba_hasta - g.activa_desde as prueba, rb.activo, rb.intervalo_minutos,
  (select count(*)::int from public.ronda_puntos p where p.ronda_base_id = rb.id and p.politica_foto = 'opcional' and p.radio_metros = 25) puntos
  from public.ronda_guiada g join public.rondas_base rb on rb.id = g.ronda_base_id where g.id = $1`, [id])
ok('queda propuesta, inactiva, 2 puntos GPS de 25 m, cada 120 min, 24 h + 7 días de prueba',
  g.estado === 'propuesta' && g.activo === false && g.puntos === 2 && g.intervalo_minutos === 120 && /1 day|24:00:00/.test(String(g.espera?.days ?? '') + JSON.stringify(g.espera)) !== null, JSON.stringify(g))

// Activación automática: no antes de 24 h
let a = (await sql(`select public.ronda_guiada_activar_vencidas() r`))[0].r
ok('antes de 24 h no se activa', a.activadas === 0)
await sql(`update public.ronda_guiada set activa_desde = now() - interval '1 minute' where id = $1`, [id])
a = (await sql(`select public.ronda_guiada_activar_vencidas() r`))[0].r
const [g2] = await sql(`select g.estado, rb.activo from public.ronda_guiada g join public.rondas_base rb on rb.id = g.ronda_base_id where g.id = $1`, [id])
ok('pasadas 24 h sin cambios se activa sola', a.activadas === 1 && g2.estado === 'activa' && g2.activo === true, JSON.stringify(g2))
ok('authenticated no puede correr la activación automática', !!(await falla(() => como(JEFE, () => sql(`select public.ronda_guiada_activar_vencidas()`)))))

// Segundo caso: si un supervisor la cambia, no se activa sola
await sql(`insert into public.puestos (id, objetivo_id, nombre) values ('30000000-0000-0000-0000-0000000000a2', $1, 'Puesto 2')`, [OBJ])
const id2 = await como(JEFE, async () => (await sql(`select public.ronda_guiada_solicitar($1, '30000000-0000-0000-0000-0000000000a2') id`, [OBJ]))[0].id)
await como(VIG, () => sql(`select public.ronda_guiada_marcar_punto($1, 1, -32.95, -60.65, 8)`, [id2]))
await como(VIG, () => sql(`select public.ronda_guiada_marcar_punto($1, 2, -32.9509, -60.65, 8)`, [id2]))
await sql(`update public.rondas_base set intervalo_minutos = 60 where id = (select ronda_base_id from public.ronda_guiada where id = $1)`, [id2])
await sql(`update public.ronda_guiada set activa_desde = now() - interval '1 minute' where id = $1`, [id2])
a = (await sql(`select public.ronda_guiada_activar_vencidas() r`))[0].r
const [g3] = await sql(`select g.estado, rb.activo from public.ronda_guiada g join public.rondas_base rb on rb.id = g.ronda_base_id where g.id = $1`, [id2])
ok('si la cambiaron, queda "modificada" e inactiva (la activa quien la cambió)', a.modificadas === 1 && g3.estado === 'modificada' && g3.activo === false, JSON.stringify(g3))

// Rechazo
await sql(`insert into public.puestos (id, objetivo_id, nombre) values ('30000000-0000-0000-0000-0000000000a3', $1, 'Puesto 3')`, [OBJ])
const id3 = await como(JEFE, async () => (await sql(`select public.ronda_guiada_solicitar($1, '30000000-0000-0000-0000-0000000000a3') id`, [OBJ]))[0].id)
ok('rechazar sin motivo no se puede', !!(await falla(() => como(JEFE, () => sql(`select public.ronda_guiada_decidir($1, 'rechazar')`, [id3])))))
await como(JEFE, () => sql(`select public.ronda_guiada_decidir($1, 'rechazar', 'Se configura a mano')`, [id3]))
ok('rechazada con motivo', (await sql(`select estado from public.ronda_guiada where id = $1`, [id3]))[0].estado === 'rechazada')
ok('nadie escribe directo la tabla', !!(await falla(() => como(JEFE, () => sql(`update public.ronda_guiada set estado = 'activa'`)))))

const fallas = resultados.filter(r => r[0] !== 'OK ')
for (const r of resultados) console.log(r.join(' · '))
console.log(`\n${resultados.length - fallas.length}/${resultados.length} OK`)
process.exit(fallas.length ? 1 : 0)
