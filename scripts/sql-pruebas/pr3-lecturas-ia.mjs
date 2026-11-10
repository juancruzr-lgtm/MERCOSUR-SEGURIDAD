// PR 3 — registro y límites de las lecturas con IA (PGlite, sin producción, ficticio)
import { nuevaBase, migracion, P, cargarPersonas, como, intenta, informe } from './base.mjs'

const t = informe()
const db = await nuevaBase()
await db.exec(`
  create table public.legajo_datos_personales (empleado_id uuid primary key, fecha_nacimiento date, lugar_nacimiento text, nacionalidad text,
    domicilio_calle text, domicilio_numero text, domicilio_piso_depto text, domicilio_localidad text, domicilio_provincia text, domicilio_cp text,
    fecha_ingreso date, actualizado_por uuid);
  create table public.legajo_cambios_datos (id uuid primary key default gen_random_uuid(), empleado_id uuid, campo text, valor_anterior text, valor_nuevo text,
    origen text, estado text, motivo text, creado_por uuid, creado_auth uuid, revisado_por uuid, revisado_at timestamptz,
    constraint legajo_cambios_datos_origen_check check (origen in ('vigilador')));
`)
await cargarPersonas(db)
await db.exec(migracion('migrations/20261208110000_postulaciones.sql'))
await db.exec(migracion('migrations/20261208120000_postulacion_lecturas_ia.sql'))
await db.exec(migracion('migrations/20261208120000_postulacion_lecturas_ia.sql'))
t.check('la migración se puede aplicar dos veces (idempotente)', true)

const rpc = (p, sql, params = []) => como(db, p, () => intenta(() => db.query(sql, params)))
await rpc(P.administracion, `select public.postulacion_habilitar_supervisor($1, true)`, [P.supervisor.id])
await rpc(P.administracion, `select public.postulacion_habilitar_supervisor($1, true)`, [P.supervisor2.id])
const id = (await rpc(P.supervisor, `select public.postulacion_crear('{"apellido":"Ficticio"}'::jsonb) id`)).r.rows[0].id

let r = await rpc(P.supervisor, `select public.postulacion_preparar_lectura($1) j`, [id])
t.check('sin foto no se puede leer', !r.ok && /foto/.test(r.error), r.error)
await rpc(P.supervisor, `select public.postulacion_registrar_archivo($1, '33333333-0000-0000-0000-000000000001', 'jpg', 'image/jpeg', 2000, $2, 1::smallint)`, [id, 'b'.repeat(64)])
r = await rpc(P.supervisor, `select public.postulacion_preparar_lectura($1) j`, [id])
t.check('quien cargó la entrevista puede pedir la lectura y recibe la ruta privada', r.ok && r.r.rows[0].j.archivos[0].ruta.startsWith(id))
r = await rpc(P.supervisor2, `select public.postulacion_preparar_lectura($1) j`, [id])
t.check('otro supervisor no puede leer una solicitud ajena', !r.ok)
r = await rpc(P.guardiaActivo, `select public.postulacion_preparar_lectura($1) j`, [id])
t.check('un vigilador no puede pedir lecturas', !r.ok)

const reg = (p) => rpc(p, `select public.postulacion_registrar_lectura($1, 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 5000, 3000, 0.0345, 'ok', '{"campos":[]}'::jsonb, array['dni'], null) id`, [id])
for (let i = 0; i < 5; i++) await reg(P.supervisor)
const fila = (await db.query(`select * from public.postulacion_lecturas_ia limit 1`)).rows[0]
t.check('cada lectura queda registrada con modelo, tokens y costo', fila.modelo === 'gemini-3.5-flash' && fila.tokens_entrada === 5000 && Number(fila.costo_estimado_usd) === 0.0345)
t.check('y deja un evento en el historial de la postulación', (await db.query(`select count(*)::int n from public.postulacion_eventos where accion = 'lectura_ia'`)).rows[0].n === 5)
r = await rpc(P.supervisor, `select public.postulacion_preparar_lectura($1) j`, [id])
t.check('límite de 5 lecturas por solicitud', !r.ok && /5 veces/.test(r.error), r.error)
r = await rpc(P.supervisor, `insert into public.postulacion_lecturas_ia (postulacion_id, pedido_por, estado) values ($1, $2, 'ok')`, [id, P.supervisor.id])
t.check('nadie escribe el registro directamente', !r.ok)
r = await intenta(() => db.query(`update public.postulacion_lecturas_ia set costo_estimado_usd = 0`))
t.check('el registro de lecturas no se edita', !r.ok)
r = await rpc(P.supervisor2, `select count(*)::int n from public.postulacion_lecturas_ia`)
t.check('otro supervisor no ve las lecturas ajenas', r.ok && r.r.rows[0].n === 0)
r = await rpc(P.gerencia, `select count(*)::int n from public.postulacion_lecturas_ia`)
t.check('Gerencia ve las lecturas (control de costos)', r.ok && r.r.rows[0].n === 5)
const p = (await db.query(`select estado, campos_dudosos from public.postulaciones where id = $1`, [id])).rows[0]
t.check('registrar una lectura NO modifica la postulación', p.estado === 'entrevistado' && p.campos_dudosos.length === 0)

r = await intenta(() => db.exec(migracion('rollback/20261208120000_postulacion_lecturas_ia_rollback.sql')))
t.check('el rollback se ejecuta', r.ok, r.error)
t.fin()
