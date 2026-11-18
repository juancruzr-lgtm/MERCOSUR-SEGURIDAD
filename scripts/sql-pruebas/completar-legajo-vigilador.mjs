// Pantalla "Completá tu legajo" (20261215100000): qué le falta al vigilador,
// posponer hasta 3 veces, validar, y el DNI que ahora puede subir. PGlite, personas ficticias.
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

let j = await pend(g)
t.check('a un vigilador sin datos se le pide', j?.pedir === true && j.faltan.length === 12 && j.dni === false && j.credencial === false, JSON.stringify(j))
t.check('Administración / supervisores no ven la pantalla', (await pend(P.administracion))?.pedir === false && (await pend(P.supervisor))?.pedir === false)
t.check('un inactivo no', (await pend(P.guardiaInactivo))?.pedir === false)

// Validar con faltantes: no deja
let r = await rpc(g, `select public.mi_legajo_validar()`)
t.check('no puede validar si faltan datos', !r.ok && /faltan datos/.test(r.error ?? ''), r.error)

// Posponer 3 veces y la cuarta no
for (let i = 1; i <= 3; i++) {
  r = await rpc(g, `select public.mi_legajo_posponer() j`)
  t.check(`posponer vez ${i}`, r.ok && r.r.rows[0].j.quedan === 3 - i, r.error)
}
r = await rpc(g, `select public.mi_legajo_posponer()`)
t.check('la cuarta vez no se puede posponer', !r.ok && /3 veces/.test(r.error ?? ''))
t.check('…y la pantalla ya no ofrece "más tarde"', (await pend(g))?.puede_posponer === false)

// Completa: algunos en el legajo, otros propuestos (esperan validación)
await db.query(`insert into public.legajo_datos_personales (empleado_id, fecha_nacimiento, lugar_nacimiento, nacionalidad, domicilio_calle, domicilio_numero, domicilio_localidad, domicilio_provincia)
  values ($1, '1990-01-01', 'Rosario', 'Argentina', 'Calle Ficticia', '100', 'Rosario', 'Santa Fe')`, [g.id])
for (const [campo, valor] of [['domicilio_cp', '2000'], ['contacto_emergencia_nombre', 'Persona Ficticia'], ['contacto_emergencia_vinculo', 'Hermana'], ['contacto_emergencia_telefono', '5493415550000'], ['obra_social_nombre', 'OSPSIP']])
  await db.query(`insert into public.legajo_cambios_datos (empleado_id, campo, valor_nuevo, origen, estado) values ($1, $2, $3, 'vigilador', 'pendiente')`, [g.id, campo, valor])
j = await pend(g)
t.check('lo propuesto que espera validación cuenta como cargado', j.faltan.length === 0, JSON.stringify(j.faltan))

// Datos de la planilla por confirmar
await db.query(`insert into public.legajo_cambios_datos (empleado_id, campo, valor_nuevo, origen, estado) values ($1, 'domicilio_piso_depto', '2B', 'planilla_legajos_2024-08', 'pendiente_confirmacion')`, [g.id])
r = await rpc(g, `select public.mi_legajo_validar()`)
t.check('con datos de la planilla sin confirmar, no valida', !r.ok && /planilla/.test(r.error ?? ''), r.error)
await db.query(`update public.legajo_cambios_datos set estado = 'aplicado' where estado = 'pendiente_confirmacion'`)
r = await rpc(g, `select public.mi_legajo_validar() j`)
t.check('valida sus datos', r.ok && r.r.rows[0].j.validado === true, r.error)
t.check('…pero sigue pidiendo DNI y credencial', r.r?.rows[0].j.pedir === true)

// DNI: antes no podía subirlo; con el interruptor sí
r = await rpc(g, `select public.documentacion_preparar($1, 'dni', null, null, null, '[]'::jsonb)`, [g.id])
t.check('el vigilador ahora puede preparar la subida de su DNI', r.ok, r.error)
r = await rpc(g, `select public.documentacion_preparar($1, 'antecedentes_provincia', null, null, null, '[]'::jsonb)`, [g.id])
t.check('otros documentos siguen cerrados (módulo Documentación apagado)', !r.ok)
await db.query(`insert into public.documentacion_documentos (empleado_id, tipo, estado, motivo_rechazo) values ($1, 'dni', 'rechazado', 'Foto borrosa')`, [g.id])
j = await pend(g)
t.check('DNI rechazado: se vuelve a pedir con el motivo', j.dni === false && j.dni_rechazo === 'Foto borrosa')
await db.query(`insert into public.documentacion_documentos (empleado_id, tipo, estado) values ($1, 'dni', 'pendiente_revision')`, [g.id])
await db.query(`insert into public.cred_simulada values ($1, false)`, [g.id])
j = await pend(g)
t.check('con DNI subido y credencial respondida, ya no se pide', j.pedir === false && j.dni === true && j.credencial === true, JSON.stringify(j))

// Interruptor apagado: no se pide a nadie
await db.query(`update public.legajo_habilitacion set empleados = false where modulo = 'completar_legajo'`)
t.check('con el interruptor apagado no se pide', (await pend(P.guardiaBloq))?.pedir === false)
const tabla = await rpc(g, `select * from public.legajo_completar_estado`)
t.check('el vigilador no puede leer la tabla directo', !tabla.ok)

const rb = await intenta(() => db.exec(migracion('rollback/20261215100000_completar_legajo_vigilador_rollback.sql')))
t.check('el rollback aplica', rb.ok, rb.error)
r = await rpc(g, `select public.documentacion_preparar($1, 'dni', null, null, null, '[]'::jsonb)`, [g.id])
t.check('…y el DNI vuelve a estar cerrado', !r.ok)
t.fin()
