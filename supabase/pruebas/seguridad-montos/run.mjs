// Pruebas de 20261206100000_seguridad_montos_liquidacion_gate sobre PGlite.
// Reproduce la fuga (antes) y comprueba el cierre (después) con los perfiles
// reales: supervisor común, supervisor sin puesto, jefe de supervisores (alcance
// total), jefe con acceso admin pleno, dirección operativa, vigilador,
// Administración, Gerencia, delegación gerencial, service_role y anon.
// Las versiones "vivas" se instalan con el propio rollback (que verifica el md5
// de producción), así que también queda probado.
// Uso: PGLITE=<ruta a pglite/dist/index.js> node supabase/pruebas/seguridad-montos/run.mjs [raíz del repo]
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const { PGlite } = await import(process.env.PGLITE ? pathToFileURL(process.env.PGLITE).href : '@electric-sql/pglite')
const REPO = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const MIG = readFileSync(`${REPO}/supabase/migrations/20261206100000_seguridad_montos_liquidacion_gate.sql`, 'utf8')
const RB = readFileSync(`${REPO}/supabase/rollback/20261206100000_seguridad_montos_liquidacion_gate_rollback.sql`, 'utf8')
const VERIF = readFileSync(`${REPO}/supabase/pruebas/seguridad-montos/verificacion-seguridad-montos.sql`, 'utf8')

const db = new PGlite()
const res = []
const ok = (nombre, cond, extra = '') => res.push([cond === true ? 'OK ' : 'FALLA', nombre, cond === true ? '' : `${extra} ${cond}`])
const AUTH = n => `00000000-0000-0000-0000-00000000${String(1000 + n).padStart(4, '0')}`
const UID = n => `00000000-0000-0000-0000-00000000${String(2000 + n).padStart(4, '0')}`
const P = { SUP: 1, SUPNULL: 2, JEFE: 3, JEFEPLENO: 4, DIR: 5, VIG: 6, ADM: 7, GER: 8, DELEG: 9 }
const NO_PUEDEN = ['SUP', 'SUPNULL', 'JEFE', 'JEFEPLENO', 'DIR', 'VIG']
const PUEDEN = ['ADM', 'GER']

async function como(quien, fn) {
  const rol = typeof quien === 'number' ? 'authenticated' : quien
  const sub = typeof quien === 'number' ? AUTH(quien) : ''
  await db.exec(`select set_config('request.jwt.claim.sub', '${sub}', false); set role ${rol};`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`) }
}
const uno = async q => Object.values((await db.query(q)).rows[0])[0]
async function execTx(t) { try { await db.exec(t) } catch (e) { try { await db.exec("rollback") } catch {} throw e } }
async function intentar(q) { try { return { v: await uno(q) } } catch (e) { return { e: e.message, code: e.code } } }

const MES = '2026-10'
const LLAMADAS = {
  sueldo: `select public.sueldo_mensual_vigente('${UID(6)}', '${MES}')::text`,
  extra: `select public.extra_mensual_vigente('${UID(6)}', '${MES}')::text`,
  pagadas: `select public.liquidacion_final_extras_pagadas('${UID(6)}', '${MES}')::text`,
  liquidado: `select public.liquidacion_final_ya_liquidado('20111111112', '${MES}')::text`,
}

// ── Esquema mínimo con los helpers reales de producción ─────────────────────
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create table public.usuarios (id uuid primary key, auth_user_id uuid, rol text, puesto_organizacional text,
  estado text default 'activo', acceso_admin_pleno boolean default false);
create table public.gerencia_delegaciones (usuario_id uuid, activa boolean default true);
create table public.liquidacion_sueldo_mensual (usuario_id uuid, importe numeric, vigencia_desde date, vigencia_hasta date);
create table public.liquidacion_extra_mensual (usuario_id uuid, importe numeric, vigencia_desde date, vigencia_hasta date);
create table public.liquidacion_periodo (id uuid primary key, mes text, estado text);
create table public.liquidacion_pago_lote (id uuid primary key, anulado_at timestamptz);
create table public.liquidacion_pago_registrado (lote_id uuid, periodo_id uuid, usuario_id uuid, tipo text, importe numeric);
create table public.liquidacion_enviado_visual (periodo_id uuid, cuil text, codigo text, cantidad numeric, importe numeric);
alter table public.liquidacion_sueldo_mensual enable row level security;
alter table public.liquidacion_extra_mensual enable row level security;

create function public.tiene_delegacion_gerencia_actual() returns boolean language sql stable security definer set search_path = public, pg_catalog as $f$
  select exists (select 1 from public.gerencia_delegaciones d join public.usuarios u on u.id = d.usuario_id
                  where u.auth_user_id = auth.uid() and d.activa) $f$;
create function public.es_gerencia_actual() returns boolean language sql stable security definer set search_path = public, pg_catalog as $f$
  select exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and ( u.puesto_organizacional = 'gerencia'
            or (u.puesto_organizacional is null and lower(u.rol) = 'admin') )
  ) $f$;
create function public.puede_liquidar_actual() returns boolean language sql stable security definer set search_path = public, pg_catalog as $f$
  select public.es_gerencia_actual() or exists (
    select 1 from public.usuarios u
    where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and u.puesto_organizacional = 'administracion') $f$;
-- Una función interna SECURITY DEFINER que ya exige el permiso y llama a una de
-- las cuatro (como pagos_banco_por_usuario / liquidacion_final_exportar).
create function public.interna_con_gate() returns numeric language plpgsql stable security definer set search_path = public, pg_catalog as $f$
begin
  if auth.uid() is null or not public.puede_liquidar_actual() then raise exception 'Sólo Gerencia o Administración' using errcode = '42501'; end if;
  return public.sueldo_mensual_vigente('${UID(6)}', '${MES}');
end $f$;
grant execute on function public.interna_con_gate() to authenticated;
`)
await db.exec(`
insert into usuarios (id, auth_user_id, rol, puesto_organizacional, acceso_admin_pleno) values
 ('${UID(1)}','${AUTH(1)}','supervisor','supervisor',false),
 ('${UID(2)}','${AUTH(2)}','supervisor',null,false),
 ('${UID(3)}','${AUTH(3)}','supervisor','jefe_supervisores',false),
 ('${UID(4)}','${AUTH(4)}','admin','jefe_supervisores',true),
 ('${UID(5)}','${AUTH(5)}','admin','direccion_operativa',false),
 ('${UID(6)}','${AUTH(6)}','guardia','vigilador',false),
 ('${UID(7)}','${AUTH(7)}','admin','administracion',false),
 ('${UID(8)}','${AUTH(8)}','admin','gerencia',false),
 ('${UID(9)}','${AUTH(9)}','admin','administracion',false);
insert into gerencia_delegaciones values ('${UID(9)}', true);
insert into liquidacion_sueldo_mensual values ('${UID(6)}', 812345.67, '2026-01-01', null);
insert into liquidacion_extra_mensual values ('${UID(6)}', 55000, '2026-01-01', null);
insert into liquidacion_periodo values ('00000000-0000-0000-0000-00000000e001', '${MES}', 'exportada');
insert into liquidacion_pago_lote values ('00000000-0000-0000-0000-00000000e101', null);
insert into liquidacion_pago_registrado values ('00000000-0000-0000-0000-00000000e101','00000000-0000-0000-0000-00000000e001','${UID(6)}','extras', 12345.5);
insert into liquidacion_enviado_visual values ('00000000-0000-0000-0000-00000000e001','20-11111111-2','120003', 1, 99999.99);
`)

// ── Estado vivo (instalado con el rollback, que verifica el md5 de producción) ─
let r
try { await execTx(RB); ok('rollback instala las 4 definiciones vivas con su md5 de producción', true) }
catch (e) { ok('rollback instala las 4 definiciones vivas con su md5 de producción', false, e.message) }

const antes = {}
for (const [k, q] of Object.entries(LLAMADAS)) antes[k] = (await como(P.ADM, () => intentar(q))).v
ok('ANTES: Administración obtiene los 4 montos', Object.values(antes).every(v => v != null && v !== '0' && v !== '[]'), JSON.stringify(antes))
for (const p of ['SUP', 'JEFE', 'VIG']) {
  const v = (await como(P[p], () => intentar(LLAMADAS.sueldo))).v
  ok(`ANTES (fuga reproducida): ${p} lee el sueldo de otro empleado`, v === antes.sueldo, v)
}

// ── Migración ───────────────────────────────────────────────────────────────
try { await execTx(MIG); ok('la migración se aplica', true) } catch (e) { ok('la migración se aplica', false, e.message) }

for (const p of NO_PUEDEN) {
  for (const [k, q] of Object.entries(LLAMADAS)) {
    const x = await como(P[p], () => intentar(q))
    ok(`DESPUÉS: ${p} no obtiene ${k} (42501)`, x.code === '42501', JSON.stringify(x))
  }
}
for (const p of [...PUEDEN, 'DELEG']) {
  for (const [k, q] of Object.entries(LLAMADAS)) {
    const x = await como(P[p], () => intentar(q))
    ok(`DESPUÉS: ${p} obtiene ${k} igual que antes`, x.v === antes[k], JSON.stringify(x))
  }
}
for (const [k, q] of Object.entries(LLAMADAS)) {
  const x = await como('service_role', () => intentar(q))
  ok(`DESPUÉS: service_role (sin usuario) obtiene ${k} igual que antes`, x.v === antes[k], JSON.stringify(x))
  const a = await como('anon', () => intentar(q))
  ok(`DESPUÉS: anon no ejecuta ${k}`, /permission denied/.test(a.e ?? ''), JSON.stringify(a))
}
ok('DESPUÉS: owner/postgres (cron) obtiene el sueldo', (await intentar(LLAMADAS.sueldo)).v === antes.sueldo)
ok('DESPUÉS: función interna con gate funciona para Administración', (await como(P.ADM, () => intentar('select public.interna_con_gate()::text'))).v === antes.sueldo)
ok('DESPUÉS: función interna con gate sigue negando al supervisor', (await como(P.SUP, () => intentar('select public.interna_con_gate()::text'))).code === '42501')
ok('DESPUÉS: el gate no lo ejecuta authenticated directo', /permission denied/.test((await como(P.ADM, () => intentar('select public.liquidacion_montos_gate()::text'))).e ?? ''))
ok('DESPUÉS: resultados vacíos siguen iguales (mes sin datos → 0 y [])',
  (await como(P.ADM, () => intentar(`select public.liquidacion_final_extras_pagadas('${UID(6)}', '1999-01')::text`))).v === '0.00'
  && (await como(P.ADM, () => intentar(`select public.liquidacion_final_ya_liquidado('1', '1999-01')::text`))).v === '[]')

const ver = (await db.query(VERIF)).rows
ok(`verificación posterior: ${ver.filter(f => f.ok === true).length}/${ver.length} ok`, ver.every(f => f.ok === true), JSON.stringify(ver.filter(f => f.ok !== true)))

// Re-aplicar: la precondición de md5 la frena (las funciones ya cambiaron).
r = null
try { await execTx(MIG); r = 'NO FALLÓ' } catch (e) { r = /cambió desde la auditoría/.test(e.message) ? true : e.message }
ok('re-aplicar aborta por la precondición (no pisa definiciones distintas)', r)

// Rollback y re-aplicación.
try { await execTx(RB); ok('rollback restaura el md5 vivo de las 4', true) } catch (e) { ok('rollback restaura el md5 vivo de las 4', false, e.message) }
ok('tras el rollback no existe el gate', (await uno(`select to_regprocedure('public.liquidacion_montos_gate()') is null`)) === true)
try { await execTx(MIG); ok('se puede volver a aplicar tras el rollback', true) } catch (e) { ok('se puede volver a aplicar tras el rollback', false, e.message) }
ok('tras re-aplicar el supervisor sigue sin acceso', (await como(P.SUP, () => intentar(LLAMADAS.sueldo))).code === '42501')

for (const [e, n, x] of res) console.log(e, n, x)
const malos = res.filter(x => x[0] !== 'OK ').length
console.log(`\n${res.length - malos}/${res.length} OK`)
process.exit(malos ? 1 : 0)
