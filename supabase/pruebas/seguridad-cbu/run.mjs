// Pruebas de 20261207100000 (RPC de cuentas) + 20261207100100 (revocar la columna)
// sobre PGlite, con los perfiles reales: supervisor común, supervisor sin puesto,
// jefe de supervisores, jefe con admin pleno, dirección operativa, vigilador,
// Administración, Gerencia y delegación gerencial.
// Uso: PGLITE=<ruta a pglite/dist/index.js> node supabase/pruebas/seguridad-cbu/run.mjs [raíz del repo]
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const { PGlite } = await import(process.env.PGLITE ? pathToFileURL(process.env.PGLITE).href : '@electric-sql/pglite')
const REPO = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const A = readFileSync(`${REPO}/supabase/migrations/20261207100000_usuarios_cuentas_bancarias_rpc.sql`, 'utf8')
const B = readFileSync(`${REPO}/supabase/migrations/20261207100100_usuarios_revocar_cuenta_bancaria.sql`, 'utf8')
const RB_A = readFileSync(`${REPO}/supabase/rollback/20261207100000_usuarios_cuentas_bancarias_rpc_rollback.sql`, 'utf8')
const RB_B = readFileSync(`${REPO}/supabase/rollback/20261207100100_usuarios_revocar_cuenta_bancaria_rollback.sql`, 'utf8')
const COLS_TS = readFileSync(`${REPO}/lib/usuarios-columnas.ts`, 'utf8').match(/COLUMNAS_USUARIO =\s*'([^']+)'/)[1]

const db = new PGlite()
const res = []
const ok = (nombre, cond, extra = '') => res.push([cond === true ? 'OK ' : 'FALLA', nombre, cond === true ? '' : `${extra} ${cond}`])
const AUTH = n => `00000000-0000-0000-0000-00000000${String(1000 + n).padStart(4, '0')}`
const UID = n => `00000000-0000-0000-0000-00000000${String(2000 + n).padStart(4, '0')}`
const P = { SUP: 1, SUPNULL: 2, JEFE: 3, JEFEPLENO: 4, DIR: 5, VIG: 6, ADM: 7, GER: 8, DELEG: 9 }
const NO_PUEDEN = ['SUP', 'SUPNULL', 'JEFE', 'JEFEPLENO', 'DIR', 'VIG']
const PUEDEN = ['ADM', 'GER', 'DELEG']

async function como(quien, fn) {
  const rol = typeof quien === 'number' ? 'authenticated' : quien
  const sub = typeof quien === 'number' ? AUTH(quien) : ''
  await db.exec(`select set_config('request.jwt.claim.sub', '${sub}', false); set role ${rol};`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`) }
}
const uno = async q => Object.values((await db.query(q)).rows[0] ?? { v: null })[0]
async function execTx(t) { try { await db.exec(t) } catch (e) { try { await db.exec('rollback') } catch {} throw e } }
async function intentar(q) { try { return { v: await uno(q) } } catch (e) { return { e: e.message, code: e.code } } }

// ── Esquema mínimo (columnas reales de usuarios y helpers reales de producción) ──
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table public.usuarios (id uuid primary key, nombre text, apellido text, dni text, telefono text, legajo text, rol text,
  estado text default 'activo', foto_url text, auth_user_id uuid, created_at timestamptz default now(), email text, cuil text,
  legajo_visual text, cuenta_bancaria text, es_prueba boolean default false, puesto_organizacional text,
  acceso_interfaz_admin boolean default false, acceso_admin_pleno boolean default false, excluir_pago_banco boolean default false,
  acceso_bloqueado boolean default false, acceso_bloqueado_motivo text, acceso_bloqueado_at timestamptz, acceso_bloqueado_por uuid,
  acceso_auth_bloqueado_at timestamptz);
create table public.gerencia_delegaciones (usuario_id uuid, activo boolean default true, revocado_at timestamptz, desde timestamptz default now() - interval '1 day', hasta timestamptz);
grant select, insert, update, delete on public.usuarios to authenticated;
grant all on public.usuarios to service_role;

create function public.es_gerencia_actual() returns boolean language sql stable security definer set search_path = public, pg_catalog as $f$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo'
    and (u.puesto_organizacional = 'gerencia' or (u.puesto_organizacional is null and lower(u.rol) = 'admin'))) $f$;
create function public.puede_liquidar_actual() returns boolean language sql stable security definer set search_path = public, pg_catalog as $f$
  select public.es_gerencia_actual() or exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo'
    and u.puesto_organizacional = 'administracion') $f$;
create function public.tiene_delegacion_gerencia(p_usuario_id uuid) returns boolean language sql stable security definer set search_path = public, pg_catalog as $f$
  select exists (select 1 from public.gerencia_delegaciones d where d.usuario_id = p_usuario_id and d.activo = true and d.revocado_at is null
    and d.desde <= now() and (d.hasta is null or d.hasta > now())) $f$;
create function public.tiene_delegacion_gerencia_actual() returns boolean language sql stable security definer set search_path = public, pg_catalog as $f$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' and public.tiene_delegacion_gerencia(u.id)) $f$;
create function public.puede_acceder_gerencia_actual() returns boolean language sql stable security definer set search_path = public, pg_catalog as $f$
  select public.es_gerencia_actual() or public.tiene_delegacion_gerencia_actual() $f$;
-- Lector SECURITY DEFINER existente (como pagos_banco_destinatarios): no debe cambiar.
create function public.lector_definer_cbu() returns int language sql stable security definer set search_path = public, pg_catalog as $f$
  select count(*)::int from public.usuarios where cuenta_bancaria is not null $f$;
grant execute on function public.lector_definer_cbu() to authenticated;

-- RLS como producción: operativos ven a todos; el vigilador, su fila.
alter table public.usuarios enable row level security;
create function public.es_operador_actual() returns boolean language sql stable security definer set search_path = public, pg_catalog as $f$
  select exists (select 1 from public.usuarios y where y.auth_user_id = auth.uid() and y.rol in ('admin','supervisor')) $f$;
create policy ver on public.usuarios for select to authenticated using (auth_user_id = auth.uid() or public.es_operador_actual());
create policy editar_propio on public.usuarios for update to authenticated using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());
create policy editar_gerencia on public.usuarios for update to authenticated using (public.puede_acceder_gerencia_actual());
`)
await db.exec(`
insert into usuarios (id, auth_user_id, nombre, apellido, rol, puesto_organizacional, acceso_admin_pleno, cuenta_bancaria) values
 ('${UID(1)}','${AUTH(1)}','S','Uno','supervisor','supervisor',false,null),
 ('${UID(2)}','${AUTH(2)}','S','Dos','supervisor',null,false,null),
 ('${UID(3)}','${AUTH(3)}','J','Tres','supervisor','jefe_supervisores',false,null),
 ('${UID(4)}','${AUTH(4)}','J','Cuatro','admin','jefe_supervisores',true,null),
 ('${UID(5)}','${AUTH(5)}','D','Cinco','admin','direccion_operativa',false,null),
 ('${UID(6)}','${AUTH(6)}','V','Seis','guardia','vigilador',false,'0123456789012'),
 ('${UID(7)}','${AUTH(7)}','A','Siete','admin','administracion',false,null),
 ('${UID(8)}','${AUTH(8)}','G','Ocho','admin','gerencia',false,null),
 ('${UID(9)}','${AUTH(9)}','X','Nueve','supervisor','supervisor',false,null),
 ('${UID(10)}',null,'V','Diez','guardia','vigilador',false,'2850590940090418135201');
insert into gerencia_delegaciones (usuario_id) values ('${UID(9)}');
`)

const CBU_DIRECTO = `select count(*)::int from public.usuarios where cuenta_bancaria is not null`
const RPC = `select public.usuarios_cuentas_bancarias()::text`

// ── ANTES: la fuga ──────────────────────────────────────────────────────────
for (const p of ['SUP', 'JEFE', 'DIR']) {
  const x = await como(P[p], () => intentar(CBU_DIRECTO))
  ok(`ANTES (fuga reproducida): ${p} lee los CBU de otros por REST`, x.v === 2, JSON.stringify(x))
}

// ── PASO A ──────────────────────────────────────────────────────────────────
try { await execTx(A); ok('paso A se aplica', true) } catch (e) { ok('paso A se aplica', false, e.message) }
const esperado = JSON.stringify({ [UID(6)]: '0123456789012', [UID(10)]: '2850590940090418135201' })
for (const p of NO_PUEDEN) {
  const x = await como(P[p], () => intentar(RPC))
  ok(`A: ${p} no obtiene las cuentas por la RPC (42501)`, x.code === '42501', JSON.stringify(x))
}
for (const p of PUEDEN) {
  const x = await como(P[p], () => intentar(RPC))
  ok(`A: ${p} obtiene las cuentas por la RPC`, x.v && JSON.stringify(JSON.parse(x.v)) === esperado, JSON.stringify(x))
}
ok('A: service_role (sin usuario) obtiene las cuentas', JSON.stringify(JSON.parse((await como('service_role', () => intentar(RPC))).v)) === esperado)
ok('A: anon no ejecuta la RPC', /permission denied/.test((await como('anon', () => intentar(RPC))).e ?? ''))
ok('A: el paso A sólo no cierra la lectura directa (por eso va el B)', (await como(P.SUP, () => intentar(CBU_DIRECTO))).v === 2)
ok("A: select('*') sigue funcionando (el código viejo no se rompe con A)", (await como(P.SUP, () => intentar(`select count(*)::int from (select * from public.usuarios) x`))).v === 10)

// ── PASO B ──────────────────────────────────────────────────────────────────
try { await execTx(B); ok('paso B se aplica', true) } catch (e) { ok('paso B se aplica', false, e.message) }
for (const p of [...NO_PUEDEN, ...PUEDEN]) {
  const x = await como(P[p], () => intentar(CBU_DIRECTO))
  ok(`B: ${p} ya no lee cuenta_bancaria directo`, /permission denied/.test(x.e ?? ''), JSON.stringify(x))
}
for (const p of PUEDEN) {
  const x = await como(P[p], () => intentar(RPC))
  ok(`B: ${p} sigue obteniendo las cuentas por la RPC`, x.v && JSON.stringify(JSON.parse(x.v)) === esperado, JSON.stringify(x))
}
const sel = `select count(*)::int from (select ${COLS_TS} from public.usuarios) x`
ok('B: el supervisor lee todas las columnas de COLUMNAS_USUARIO (operación intacta)', (await como(P.SUP, () => intentar(sel))).v === 10)
ok('B: el vigilador lee su propia fila con COLUMNAS_USUARIO (login)', (await como(P.VIG, () => intentar(`select count(*)::int from (select ${COLS_TS} from public.usuarios where auth_user_id = '${AUTH(6)}') x`))).v === 1)
ok("B: select('*') falla (por eso el código cambia antes)", /permission denied/.test((await como(P.SUP, () => intentar(`select count(*) from (select * from public.usuarios) x`))).e ?? ''))
ok('B: el vigilador actualiza su teléfono', (await como(P.VIG, () => intentar(`with u as (update public.usuarios set telefono = '341' where auth_user_id = '${AUTH(6)}' returning id) select count(*)::int from u`))).v === 1)
ok('B: Gerencia sigue cargando un CBU (escribir no requiere leer)', (await como(P.GER, () => intentar(`with u as (update public.usuarios set cuenta_bancaria = '999' where id = '${UID(1)}' returning id) select count(*)::int from u`))).v === 1)
ok('B: el CBU cargado por Gerencia se ve por la RPC', JSON.parse((await como(P.GER, () => intentar(RPC))).v)[UID(1)] === '999')
ok('B: lector SECURITY DEFINER existente sigue igual', (await como(P.SUP, () => intentar(`select public.lector_definer_cbu()`))).v === 3)
ok('B: service_role conserva SELECT completo', (await como('service_role', () => intentar(CBU_DIRECTO))).v === 3)

// Re-aplicar B es idempotente.
try { await execTx(B); ok('re-aplicar B no falla', true) } catch (e) { ok('re-aplicar B no falla', false, e.message) }

// Columna nueva fuera de la lista: B frena.
await db.exec(`alter table public.usuarios add column columna_nueva text`)
let r = null
try { await execTx(B); r = 'NO FRENÓ' } catch (e) { r = /fuera de la lista/.test(e.message) ? true : e.message }
ok('B frena si usuarios tiene una columna fuera de la lista', r)
await db.exec(`alter table public.usuarios drop column columna_nueva`)

// ── Rollback ────────────────────────────────────────────────────────────────
try { await execTx(RB_B); ok('rollback de B se aplica', true) } catch (e) { ok('rollback de B se aplica', false, e.message) }
ok("tras rollback de B, select('*') vuelve a funcionar", (await como(P.SUP, () => intentar(`select count(*)::int from (select * from public.usuarios) x`))).v === 10)
try { await execTx(RB_A); ok('rollback de A se aplica', true) } catch (e) { ok('rollback de A se aplica', false, e.message) }
ok('tras rollback de A no existe la RPC', (await uno(`select to_regprocedure('public.usuarios_cuentas_bancarias()') is null`)) === true)
r = null
try { await execTx(B); r = 'NO FRENÓ' } catch (e) { r = /paso A/.test(e.message) ? true : e.message }
ok('B frena si falta el paso A', r)

for (const [e, n, x] of res) console.log(e, n, x)
const malos = res.filter(x => x[0] !== 'OK ').length
console.log(`\n${res.length - malos}/${res.length} OK`)
process.exit(malos ? 1 : 0)
