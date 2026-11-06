// Base mínima que imita producción (políticas copiadas de pg_policies del 06/11/2026)
// para probar migraciones con PGlite (Postgres real en WASM), sin tocar Supabase.
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'

import { fileURLToPath } from 'node:url'
export const REPO = process.env.REPO || fileURLToPath(new URL('../..', import.meta.url))

export async function nuevaBase() {
  const db = new PGlite({ extensions: {} })
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage; create schema extensions;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select jsonb_build_object('email', current_setting('test.email', true)) $$;
    create function auth.role() returns text language sql stable as $$ select current_user::text $$;
    create table auth.users (id uuid primary key, email text);
    grant usage on schema auth, storage, extensions to anon, authenticated, service_role;
    grant execute on all functions in schema auth to anon, authenticated, service_role;

    create table public.usuarios (
      id uuid primary key default gen_random_uuid(), nombre text not null, apellido text not null,
      dni text, telefono text, legajo text not null unique, rol text not null check (rol in ('admin','supervisor','guardia')),
      estado text not null check (estado in ('activo','inactivo')), auth_user_id uuid, email text, cuil text,
      legajo_visual text, cuenta_bancaria text, es_prueba boolean not null default false,
      puesto_organizacional text check (puesto_organizacional is null or puesto_organizacional in ('vigilador','supervisor','jefe_supervisores','direccion_operativa','administracion','gerencia')),
      acceso_bloqueado boolean not null default false, created_at timestamptz default now()
    );
    create unique index usuarios_cuil_unico on public.usuarios (cuil) where cuil is not null;

    create function public.es_operador_actual() returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
      select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo'
        and (u.puesto_organizacional in ('supervisor','jefe_supervisores','direccion_operativa','administracion','gerencia')
             or (u.puesto_organizacional is null and lower(u.rol) in ('admin','supervisor')))) $$;
    create function public.acceso_habilitado_actual() returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
      select not exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.acceso_bloqueado) $$;
    create function public.rondas_usuario_actual_id() returns uuid language sql stable security definer set search_path = public, pg_catalog as $$
      select u.id from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' limit 1 $$;
    create function public.alcance_operativo_de(p uuid) returns text language sql stable security definer set search_path = public, pg_catalog as $$
      select case when exists (select 1 from public.usuarios u where u.id = p and u.puesto_organizacional in ('jefe_supervisores','direccion_operativa','administracion','gerencia','supervisor')) then 'todas' else 'propio' end $$;
    create function public.alcanza_turno_actual(p uuid) returns boolean language sql stable as $$ select false $$;
    create function public.legajo_puede_gestionar() returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
      select auth.uid() is not null and exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' and u.puesto_organizacional in ('administracion','gerencia')) $$;

    create table public.registros_asistencia (
      id uuid primary key default gen_random_uuid(), turno_id uuid, guardia_id uuid references public.usuarios(id),
      hora_entrada_real time, hora_salida_real time, horas_liquidables numeric, created_at timestamptz default now()
    );
    alter table public.registros_asistencia enable row level security;
    create policy "Guardia gestiona sus registros" on public.registros_asistencia for all to authenticated
      using (exists (select 1 from usuarios where usuarios.auth_user_id = auth.uid() and usuarios.rol = any (array['guardia','vigilador']) and usuarios.id = registros_asistencia.guardia_id))
      with check (exists (select 1 from usuarios where usuarios.auth_user_id = auth.uid() and usuarios.rol = any (array['guardia','vigilador']) and usuarios.id = registros_asistencia.guardia_id));
    create policy "acceso_bloqueado_baja" on public.registros_asistencia as restrictive for all to authenticated
      using ((select acceso_habilitado_actual())) with check ((select acceso_habilitado_actual()));
    create policy "guardias pueden insertar su asistencia" on public.registros_asistencia for insert to authenticated
      with check (guardia_id in (select usuarios.id from usuarios where usuarios.auth_user_id = auth.uid()));
    create policy "guardias pueden ver su asistencia" on public.registros_asistencia for select to authenticated
      using (guardia_id in (select usuarios.id from usuarios where usuarios.auth_user_id = auth.uid()));
    create policy "guardias_insertan_asistencia" on public.registros_asistencia for insert to authenticated with check (guardia_id = auth.uid());
    create policy "registros_asistencia_alcance_total" on public.registros_asistencia for all to authenticated
      using (alcance_operativo_de(rondas_usuario_actual_id()) = 'todas') with check (alcance_operativo_de(rondas_usuario_actual_id()) = 'todas');
    create policy "registros_asistencia_select_alcance" on public.registros_asistencia for select to authenticated using (alcanza_turno_actual(turno_id));
    grant all on public.registros_asistencia to authenticated;

    create table public.evidencias (id uuid primary key default gen_random_uuid(), guardia_id uuid, proceso_tipo text);
    alter table public.evidencias enable row level security;
    create policy "Guardia inserta sus evidencias" on public.evidencias for insert to authenticated
      with check (exists (select 1 from usuarios where usuarios.auth_user_id = auth.uid() and usuarios.id = evidencias.guardia_id and usuarios.rol = any (array['guardia','vigilador'])));
    create policy "Guardia actualiza sus evidencias" on public.evidencias for update to authenticated
      using (exists (select 1 from usuarios where usuarios.auth_user_id = auth.uid() and usuarios.id = evidencias.guardia_id and usuarios.rol = any (array['guardia','vigilador'])));
    create policy "acceso_bloqueado_baja" on public.evidencias as restrictive for all to authenticated
      using ((select acceso_habilitado_actual())) with check ((select acceso_habilitado_actual()));
    grant all on public.evidencias to authenticated;

    create table storage.buckets (id text primary key, name text, public boolean default false, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
    alter table storage.objects enable row level security;
    create policy "Guardia sube evidencias de ingreso" on storage.objects for insert to authenticated
      with check (bucket_id = 'ingreso-evidencias' and exists (select 1 from public.usuarios where usuarios.auth_user_id = auth.uid() and usuarios.rol = any (array['guardia','vigilador'])));
    create policy "Otro bucket abierto (control)" on storage.objects for insert to authenticated with check (bucket_id = 'supervision-fotos');
    create policy "acceso_bloqueado_baja" on storage.objects as restrictive for all to authenticated
      using ((select public.acceso_habilitado_actual())) with check ((select public.acceso_habilitado_actual()));
    grant all on storage.objects to authenticated;
    grant select on storage.buckets to authenticated;
    grant usage on schema public to authenticated, anon, service_role;
    grant select on public.usuarios to authenticated;
  `)
  return db
}

export const migracion = (archivo) => readFileSync(`${REPO}/supabase/${archivo}`, 'utf8')

// Personas de prueba (ficticias)
export const P = {
  guardiaActivo:   { id: '11111111-0000-0000-0000-000000000001', auth: 'aaaaaaaa-0000-0000-0000-000000000001', rol: 'guardia', puesto: 'vigilador', estado: 'activo' },
  guardiaInactivo: { id: '11111111-0000-0000-0000-000000000002', auth: 'aaaaaaaa-0000-0000-0000-000000000002', rol: 'guardia', puesto: 'vigilador', estado: 'inactivo' },
  guardiaBloq:     { id: '11111111-0000-0000-0000-000000000003', auth: 'aaaaaaaa-0000-0000-0000-000000000003', rol: 'guardia', puesto: 'vigilador', estado: 'inactivo', bloq: true },
  supervisor:      { id: '11111111-0000-0000-0000-000000000004', auth: 'aaaaaaaa-0000-0000-0000-000000000004', rol: 'supervisor', puesto: 'supervisor', estado: 'activo' },
  administracion:  { id: '11111111-0000-0000-0000-000000000005', auth: 'aaaaaaaa-0000-0000-0000-000000000005', rol: 'admin', puesto: 'administracion', estado: 'activo' },
  gerencia:        { id: '11111111-0000-0000-0000-000000000006', auth: 'aaaaaaaa-0000-0000-0000-000000000006', rol: 'admin', puesto: 'gerencia', estado: 'activo' },
  supervisor2:     { id: '11111111-0000-0000-0000-000000000007', auth: 'aaaaaaaa-0000-0000-0000-000000000007', rol: 'supervisor', puesto: 'supervisor', estado: 'activo' },
}

export async function cargarPersonas(db) {
  let n = 0
  for (const [k, p] of Object.entries(P)) {
    n += 1
    await db.query(
      `insert into public.usuarios (id, nombre, apellido, dni, legajo, rol, estado, auth_user_id, email, puesto_organizacional, acceso_bloqueado)
       values ($1, 'Ficticio', $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [p.id, k, String(40000000 + n), `T-${n}`, p.rol, p.estado, p.auth, `${k}@example.test`, p.puesto, !!p.bloq],
    )
  }
}

export async function como(db, persona, fn) {
  await db.exec(`set role authenticated`)
  await db.query(`select set_config('test.uid', $1, false)`, [persona ? persona.auth : ''])
  try { return await fn() } finally { await db.exec(`reset role`); await db.query(`select set_config('test.uid', '', false)`) }
}

export async function intenta(fn) {
  try { const r = await fn(); return { ok: true, r } } catch (e) { return { ok: false, error: e.message } }
}

export function informe() {
  const filas = []
  let fallas = 0
  return {
    check(nombre, cond, detalle = '') {
      filas.push(`${cond ? 'OK  ' : 'FALLA'} ${nombre}${detalle ? ' — ' + detalle : ''}`)
      if (!cond) fallas += 1
    },
    fin() { console.log(filas.join('\n')); console.log(`\n${filas.length - fallas}/${filas.length} verificaciones OK`); if (fallas) process.exitCode = 1 },
  }
}
