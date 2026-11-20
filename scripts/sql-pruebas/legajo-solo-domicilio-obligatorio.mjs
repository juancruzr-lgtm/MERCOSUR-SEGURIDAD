// "Completá tu legajo": obligatorio sólo el domicilio (20261219110000). PGlite, personas ficticias.
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

const r1 = await intenta(() => db.exec(migracion('migrations/20261219110000_legajo_solo_domicilio_obligatorio.sql')))
t.check('la migración nueva aplica', r1.ok, r1.error)

let j = await pend(g)
t.check('sin datos: faltan sólo los 5 del domicilio', JSON.stringify(j?.faltan) === JSON.stringify(['domicilio_calle', 'domicilio_numero', 'domicilio_localidad', 'domicilio_provincia', 'domicilio_cp']), JSON.stringify(j))
t.check('nacimiento y nacionalidad quedan como vacíos opcionales (para la IA)', JSON.stringify(j?.vacios) === JSON.stringify(['fecha_nacimiento', 'lugar_nacimiento', 'nacionalidad']), JSON.stringify(j?.vacios))
t.check('se le sigue pidiendo (domicilio, DNI, credencial)', j?.pedir === true)
t.check('Administración no ve la pantalla', (await pend(P.administracion))?.pedir === false)

let r = await rpc(g, `select public.mi_legajo_validar()`)
t.check('sin domicilio no puede validar', !r.ok && /faltan datos/.test(r.error ?? ''), r.error)

await db.query(`insert into public.legajo_datos_personales (empleado_id, domicilio_calle, domicilio_numero, domicilio_localidad, domicilio_provincia) values ($1, 'Calle Ficticia', '100', 'Rosario', 'Santa Fe')`, [g.id])
await db.query(`insert into public.legajo_cambios_datos (empleado_id, campo, valor_nuevo, origen, estado) values ($1, 'domicilio_cp', '2000', 'vigilador', 'pendiente')`, [g.id])
j = await pend(g)
t.check('con el domicilio cargado ya no falta nada (sin obra social ni contacto)', j.faltan.length === 0, JSON.stringify(j.faltan))
r = await rpc(g, `select public.mi_legajo_validar() j`)
t.check('valida sin obra social, contacto ni nacimiento', r.ok && r.r.rows[0].j.validado === true, r.error)

await db.query(`update public.legajo_datos_personales set fecha_nacimiento = '1990-01-01' where empleado_id = $1`, [g.id])
t.check('un opcional cargado sale de vacíos', !(await pend(g)).vacios.includes('fecha_nacimiento'))

await db.query(`insert into public.documentacion_documentos (empleado_id, tipo, estado) values ($1, 'dni', 'pendiente_aceptacion')`, [g.id])
await db.query(`insert into public.cred_simulada values ($1, false)`, [g.id])
t.check('con DNI y credencial, ya no se pide', (await pend(g)).pedir === false)

const rb = await intenta(() => db.exec(migracion('rollback/20261219110000_legajo_solo_domicilio_obligatorio_rollback.sql')))
t.check('el rollback aplica', rb.ok, rb.error)
j = await pend(g)
t.check('…y vuelve a exigir los 12 datos (faltan los 6 opcionales que no cargó)', j.faltan.length === 6 && j.vacios === undefined, JSON.stringify(j.faltan))
t.fin()
