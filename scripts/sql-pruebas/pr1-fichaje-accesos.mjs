// PR 1 — fichaje sólo activos + registro de invitaciones (PGlite, sin producción)
import { nuevaBase, migracion, P, cargarPersonas, como, intenta, informe } from './base.mjs'

const t = informe()
const db = await nuevaBase()
await cargarPersonas(db)

const fichar = (p) => db.query(`insert into public.registros_asistencia (guardia_id, hora_entrada_real) values ($1, '08:00') returning id`, [p.id])

// Fichajes históricos (cargados como servidor, antes de la migración)
const hist = await db.query(`insert into public.registros_asistencia (guardia_id, hora_entrada_real, hora_salida_real, horas_liquidables)
  values ($1, '08:00', '16:00', 8), ($2, '08:00', '20:00', 12) returning id, horas_liquidables`, [P.guardiaActivo.id, P.guardiaInactivo.id])
const huellaAntes = (await db.query(`select md5(string_agg(t::text, '|' order by id)) h from public.registros_asistencia t`)).rows[0].h

// ── ANTES: se reproduce el problema ─────────────────────────────────────────
const antes = await como(db, P.guardiaInactivo, () => intenta(() => fichar(P.guardiaInactivo)))
t.check('ANTES: un inactivo con cuenta puede fichar (problema reproducido)', antes.ok)
const borraAntes = await como(db, P.guardiaActivo, () => intenta(() => db.query(`delete from public.registros_asistencia where guardia_id = $1 returning id`, [P.guardiaActivo.id])))
t.check('ANTES: el vigilador puede borrar sus propios fichajes (problema reproducido)', borraAntes.ok && borraAntes.r.rows.length > 0)
// restaurar lo borrado y lo insertado para medir la huella después
await db.exec(`delete from public.registros_asistencia`)
await db.query(`insert into public.registros_asistencia (id, guardia_id, hora_entrada_real, hora_salida_real, horas_liquidables, created_at)
  select * from (values ($1::uuid, $2::uuid, '08:00'::time, '16:00'::time, 8::numeric, now()), ($3::uuid, $4::uuid, '08:00'::time, '20:00'::time, 12::numeric, now())) v`,
  [hist.rows[0].id, P.guardiaActivo.id, hist.rows[1].id, P.guardiaInactivo.id])
const huellaBase = (await db.query(`select md5(string_agg(t::text, '|' order by id)) h from public.registros_asistencia t`)).rows[0].h

// ── MIGRACIÓN ───────────────────────────────────────────────────────────────
await db.exec(migracion('migrations/20261208100000_fichaje_solo_activos.sql'))
await db.exec(migracion('migrations/20261208100000_fichaje_solo_activos.sql'))
t.check('la migración se puede aplicar dos veces (idempotente)', true)
const huellaDespues = (await db.query(`select md5(string_agg(t::text, '|' order by id)) h from public.registros_asistencia t`)).rows[0].h
t.check('fichajes históricos y horas liquidables intactos', huellaBase === huellaDespues)

// ── DESPUÉS ─────────────────────────────────────────────────────────────────
let r = await como(db, P.guardiaActivo, () => intenta(() => fichar(P.guardiaActivo)))
t.check('vigilador ACTIVO ficha su entrada', r.ok)
const idNuevo = r.ok ? r.r.rows[0].id : null
r = await como(db, P.guardiaActivo, () => intenta(() => db.query(`update public.registros_asistencia set hora_salida_real = '16:00' where id = $1 returning id`, [idNuevo])))
t.check('vigilador ACTIVO marca su salida', r.ok && r.r.rows.length === 1)

r = await como(db, P.guardiaInactivo, () => intenta(() => fichar(P.guardiaInactivo)))
t.check('vigilador INACTIVO no puede fichar', !r.ok, r.error)
r = await como(db, P.guardiaInactivo, () => intenta(() => db.query(`update public.registros_asistencia set hora_salida_real = '23:00' where guardia_id = $1 returning id`, [P.guardiaInactivo.id])))
t.check('vigilador INACTIVO no puede modificar sus fichajes', !r.ok || r.r.rows.length === 0)
r = await como(db, P.guardiaInactivo, () => intenta(() => db.query(`select count(*)::int n from public.registros_asistencia where guardia_id = $1`, [P.guardiaInactivo.id])))
t.check('vigilador INACTIVO sigue viendo su historial (lectura sin cambios)', r.ok && r.r.rows[0].n === 1)
r = await como(db, P.guardiaBloq, () => intenta(() => fichar(P.guardiaBloq)))
t.check('vigilador con acceso BLOQUEADO no puede fichar', !r.ok)

r = await como(db, P.guardiaActivo, () => intenta(() => db.query(`delete from public.registros_asistencia where guardia_id = $1 returning id`, [P.guardiaActivo.id])))
t.check('el vigilador ya no puede borrar fichajes', !r.ok || r.r.rows.length === 0)
r = await como(db, P.supervisor, () => intenta(() => db.query(`update public.registros_asistencia set hora_salida_real = '20:00' where guardia_id = $1 returning id`, [P.guardiaInactivo.id])))
t.check('supervisor activo puede corregir el fichaje VIEJO de un inactivo', r.ok && r.r.rows.length === 1)
r = await como(db, P.supervisor, () => intenta(() => db.query(`delete from public.registros_asistencia where id = $1 returning id`, [idNuevo])))
t.check('conducción (supervisor activo) conserva el borrado', r.ok && r.r.rows.length === 1)

r = await como(db, P.guardiaInactivo, () => intenta(() => db.query(`insert into public.evidencias (guardia_id, proceso_tipo) values ($1, 'ingreso')`, [P.guardiaInactivo.id])))
t.check('INACTIVO no registra evidencias de ingreso', !r.ok)
r = await como(db, P.guardiaActivo, () => intenta(() => db.query(`insert into public.evidencias (guardia_id, proceso_tipo) values ($1, 'ingreso')`, [P.guardiaActivo.id])))
t.check('ACTIVO registra evidencias de ingreso', r.ok)

r = await como(db, P.guardiaInactivo, () => intenta(() => db.query(`insert into storage.objects (bucket_id, name) values ('ingreso-evidencias', 'x/libro.jpg')`)))
t.check('INACTIVO no sube fotos al bucket ingreso-evidencias', !r.ok)
r = await como(db, P.guardiaActivo, () => intenta(() => db.query(`insert into storage.objects (bucket_id, name) values ('ingreso-evidencias', 'x/libro.jpg')`)))
t.check('ACTIVO sube fotos al bucket ingreso-evidencias', r.ok)
r = await como(db, P.guardiaInactivo, () => intenta(() => db.query(`insert into storage.objects (bucket_id, name) values ('supervision-fotos', 'y/z.jpg')`)))
t.check('la restricción no afecta a otros buckets', r.ok)

const pol = await db.query(`select count(*)::int n from pg_policies where tablename = 'registros_asistencia' and policyname = 'guardias_insertan_asistencia'`)
t.check('se quitó la política muerta guardias_insertan_asistencia', pol.rows[0].n === 0)
const tr = await db.query(`select has_table_privilege('authenticated', 'public.registros_asistencia', 'TRUNCATE') t`)
t.check('authenticated ya no tiene TRUNCATE sobre registros_asistencia', tr.rows[0].t === false)

// ── ROLLBACK ────────────────────────────────────────────────────────────────
await db.exec(migracion('rollback/20261208100000_fichaje_solo_activos_rollback.sql'))
r = await como(db, P.guardiaInactivo, () => intenta(() => fichar(P.guardiaInactivo)))
t.check('rollback: vuelve la conducta anterior', r.ok)
await db.exec(migracion('migrations/20261208100000_fichaje_solo_activos.sql'))

// ── accesos_invitaciones ────────────────────────────────────────────────────
await db.exec(migracion('migrations/20261208100100_accesos_invitaciones.sql'))
await db.exec(`reset role`)
await db.query(`insert into public.accesos_invitaciones (usuario_id, email, tipo, origen, resultado, enviado_por) values ($1, 'x@example.test', 'invitacion', 'administracion', 'enviado', $2)`, [P.guardiaActivo.id, P.administracion.id])
r = await como(db, P.administracion, () => intenta(() => db.query(`select count(*)::int n from public.accesos_invitaciones`)))
t.check('Administración lee el registro de invitaciones', r.ok && r.r.rows[0].n === 1)
r = await como(db, P.supervisor, () => intenta(() => db.query(`select count(*)::int n from public.accesos_invitaciones`)))
t.check('Supervisión NO ve el registro de invitaciones', r.ok && r.r.rows[0].n === 0)
r = await como(db, P.administracion, () => intenta(() => db.query(`insert into public.accesos_invitaciones (usuario_id, origen, resultado) values ($1, 'administracion', 'enviado')`, [P.guardiaActivo.id])))
t.check('nadie escribe el registro desde la app (sólo el servidor)', !r.ok)
r = await intenta(() => db.query(`update public.accesos_invitaciones set resultado = 'error'`))
t.check('el registro no se edita (ni con permisos de dueño)', !r.ok)
r = await intenta(() => db.query(`delete from public.accesos_invitaciones`))
t.check('el registro no se borra', !r.ok)

t.fin()
