// Código postal opcional (20261222100000). PGlite, personas ficticias.
import { nuevaBase, migracion, P, cargarPersonas, como, intenta, informe } from './base.mjs'

const t = informe()
const db = await nuevaBase()
await db.exec(`
  create table public.legajo_habilitacion (modulo text primary key, empleados boolean not null default false, actualizado_por uuid, actualizado_at timestamptz);
  insert into public.legajo_habilitacion values ('pedido_credencial', true, null, now()), ('documentacion', false, null, now());
  create table public.legajo_datos_personales (empleado_id uuid primary key references public.usuarios(id), fecha_nacimiento date, lugar_nacimiento text, nacionalidad text,
    domicilio_calle text, domicilio_numero text, domicilio_piso_depto text, domicilio_localidad text, domicilio_provincia text, domicilio_cp text,
    contacto_emergencia_nombre text, contacto_emergencia_vinculo text, contacto_emergencia_telefono text, fecha_ingreso date,
    obra_social_nombre text, obra_social_codigo text, credencial_numero text, credencial_vencimiento date, actualizado_at timestamptz, actualizado_por uuid);
  create table public.legajo_cambios_datos (id uuid primary key default gen_random_uuid(), empleado_id uuid, campo text, valor_anterior text, valor_nuevo text,
    origen text, estado text, creado_at timestamptz default now());
  create table public.documentacion_documentos (id uuid primary key default gen_random_uuid(), empleado_id uuid, tipo text, estado text, motivo_rechazo text, creado_at timestamptz default now());
  create table public.cred_simulada (empleado_id uuid primary key, pedir boolean);
  create function public.credencial_mi_estado() returns jsonb language sql stable security definer set search_path = public, pg_catalog as $$
    select jsonb_build_object('pedir', coalesce((select c.pedir from public.cred_simulada c join public.usuarios u on u.id = c.empleado_id where u.auth_user_id = auth.uid()), true)) $$;
  -- Imitación mínima de la condición real de documentacion_preparar.
  create function public.documentacion_preparar(p_empleado_id uuid, p_tipo text, p_fecha_emision date, p_vence_el date, p_detalle text, p_archivos jsonb)
  returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $f$
  begin
    if not (coalesce((select h.empleados from public.legajo_habilitacion h where h.modulo = 'pedido_credencial'), false)
            and (p_tipo = 'credencial' or false)) then
      if not coalesce((select h.empleados from public.legajo_habilitacion h where h.modulo = 'documentacion'), false) then
        raise exception 'Esta sección del legajo todavía no está habilitada';
      end if;
    end if;
    return jsonb_build_object('ok', true);
  end $f$;
`)
await cargarPersonas(db)
const r0 = await intenta(() => db.exec(migracion('migrations/20261215100000_completar_legajo_vigilador.sql')))
t.check('la migración aplica', r0.ok, r0.error)

const rpc = (p, sql, params = []) => como(db, p, () => intenta(() => db.query(sql, params)))
const pend = async (p) => (await rpc(p, `select public.mi_legajo_pendiente() j`)).r?.rows[0].j
const g = P.guardiaActivo

for (const m of ['migrations/20261219120000_legajo_solo_domicilio_obligatorio.sql', 'migrations/20261222100000_legajo_codigo_postal_opcional.sql']) {
  const r = await intenta(() => db.exec(migracion(m)))
  t.check(`aplica ${m.split('/')[1]}`, r.ok, r.error)
}
let j = await pend(g)
t.check('sin datos: faltan calle, número, localidad y provincia (sin CP)', JSON.stringify(j?.faltan) === JSON.stringify(['domicilio_calle', 'domicilio_numero', 'domicilio_localidad', 'domicilio_provincia']), JSON.stringify(j?.faltan))
t.check('el CP queda como vacío opcional', j?.vacios?.[0] === 'domicilio_cp', JSON.stringify(j?.vacios))
await db.query(`insert into public.legajo_datos_personales (empleado_id, domicilio_calle, domicilio_numero, domicilio_localidad, domicilio_provincia) values ($1, 'Calle Ficticia', '100', 'Rosario', 'Santa Fe')`, [g.id])
j = await pend(g)
t.check('con domicilio sin CP ya no falta nada', j.faltan.length === 0, JSON.stringify(j.faltan))
const v = await rpc(g, `select public.mi_legajo_validar() j`)
t.check('valida sin CP', v.ok && v.r.rows[0].j.validado === true, v.error)
const rb = await intenta(() => db.exec(migracion('rollback/20261222100000_legajo_codigo_postal_opcional_rollback.sql')))
t.check('el rollback aplica', rb.ok, rb.error)
t.check('…y el CP vuelve a faltar', JSON.stringify((await pend(g)).faltan) === JSON.stringify(['domicilio_cp']))
t.fin()
