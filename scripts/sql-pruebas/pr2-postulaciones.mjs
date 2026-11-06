// PR 2 — circuito de postulaciones y alta efectiva (PGlite, sin producción, personas ficticias)
import { nuevaBase, migracion, P, cargarPersonas, como, intenta, informe } from './base.mjs'

const t = informe()
const db = await nuevaBase()

// Piezas de producción que usa el alta (copiadas de pg_get_functiondef / pg_constraint del 06/11)
await db.exec(`
  create table public.legajo_datos_personales (
    empleado_id uuid primary key references public.usuarios(id), fecha_nacimiento date check (fecha_nacimiento is null or (fecha_nacimiento >= '1930-01-01' and fecha_nacimiento <= current_date)),
    lugar_nacimiento text, nacionalidad text, domicilio_calle text, domicilio_numero text, domicilio_piso_depto text,
    domicilio_localidad text, domicilio_provincia text, domicilio_cp text, contacto_emergencia_nombre text,
    contacto_emergencia_vinculo text, contacto_emergencia_telefono text, fecha_ingreso date, obra_social_nombre text,
    obra_social_codigo text, credencial_numero text, credencial_vencimiento date, actualizado_at timestamptz not null default now(),
    actualizado_por uuid references public.usuarios(id));
  create table public.legajo_cambios_datos (
    id uuid primary key default gen_random_uuid(), empleado_id uuid not null, campo text not null, valor_anterior text, valor_nuevo text,
    origen text not null, estado text not null, motivo text, documento_id uuid, creado_por uuid, creado_auth uuid,
    creado_at timestamptz not null default now(), revisado_por uuid, revisado_at timestamptz, motivo_rechazo text,
    constraint legajo_cambios_datos_origen_check check (origen = any (array['vigilador','administracion','planilla_legajos_2024-08','arca_relaciones_laborales','arca_constancia_alta','planillas_historicas'])));
  create function public.puede_gestionar_roles_normales_actual() returns boolean language sql stable security definer set search_path = public, pg_catalog as $$
    select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo'
      and (u.puesto_organizacional in ('administracion','gerencia') or (u.puesto_organizacional is null and lower(u.rol) = 'admin'))) $$;
  -- Versión reducida del trigger real: alta con puesto exige gestionar roles normales.
  create function public.usuarios_proteger_campos_criticos() returns trigger language plpgsql security definer set search_path = public, pg_catalog as $$
  begin
    if auth.uid() is null then return new; end if;
    if tg_op = 'INSERT' and (new.puesto_organizacional is not null or lower(new.rol) in ('admin','supervisor')) and not public.puede_gestionar_roles_normales_actual() then
      raise exception 'No autorizado a asignar rol/puesto en el alta';
    end if;
    return new;
  end; $$;
  create trigger usuarios_proteger_campos_criticos before insert or update on public.usuarios for each row execute function public.usuarios_proteger_campos_criticos();
`)
await cargarPersonas(db)
// Empleado existente (ficticio) para probar duplicados
await db.query(`insert into public.usuarios (nombre, apellido, dni, cuil, legajo, rol, estado, email, puesto_organizacional)
  values ('Existente', 'Ficticio', '30111222', '20301112229', '20301112229', 'guardia', 'activo', 'existente@example.test', 'vigilador')`)

await db.exec(migracion('migrations/20261208110000_postulaciones.sql'))
await db.exec(migracion('migrations/20261208110000_postulaciones.sql'))
t.check('la migración se puede aplicar dos veces (idempotente)', true)

const rpc = (persona, sql, params = []) => como(db, persona, () => intenta(() => db.query(sql, params)))
const fila = async (id) => (await db.query(`select * from public.postulaciones where id = $1`, [id])).rows[0]

// Postulante ficticio. CUIL válido para el DNI 40999888: 20-40999888-?
const dv = (c) => { const w = [5,4,3,2,7,6,5,4,3,2]; let s = 0; for (let i = 0; i < 10; i++) s += +c[i] * w[i]; let v = 11 - (s % 11); if (v === 11) v = 0; if (v === 10) v = 9; return c + v }
const CUIL = dv('2040999888')
const datos = {
  apellido: 'Prueba', nombre: 'Postulante Uno', dni: '40.999.888', cuil: CUIL, telefono: '5493415550001',
  fecha_nacimiento: '1995-03-10', lugar_nacimiento: 'Rosario', nacionalidad: 'Argentina',
  domicilio_calle: 'Calle Ficticia', domicilio_numero: '123', domicilio_localidad: 'Rosario', domicilio_provincia: 'Santa Fe', domicilio_cp: '2000',
  datos_seleccion: { estudios: 'Secundario completo', talle_calzado: '42' },
  campos_dudosos: ['telefono'],
}

// ── Permisos de carga ───────────────────────────────────────────────────────
let r = await rpc(P.supervisor, `select public.postulacion_crear($1::jsonb) id`, [JSON.stringify(datos)])
t.check('supervisor NO habilitado no puede cargar entrevistas', !r.ok, r.error)
r = await rpc(P.guardiaActivo, `select public.postulacion_crear($1::jsonb) id`, [JSON.stringify(datos)])
t.check('un vigilador no puede cargar entrevistas', !r.ok)
r = await rpc(P.administracion, `select public.postulacion_habilitar_supervisor($1, true)`, [P.supervisor.id])
t.check('Administración habilita a un supervisor', r.ok, r.error)
r = await rpc(P.supervisor, `select public.postulacion_habilitar_supervisor($1, true)`, [P.supervisor2.id])
t.check('un supervisor no habilita a otros', !r.ok)

r = await rpc(P.supervisor, `select public.postulacion_crear($1::jsonb) id`, [JSON.stringify(datos)])
t.check('supervisor HABILITADO carga una entrevista', r.ok, r.error)
const idP = r.r?.rows[0].id
let p = await fila(idP)
t.check('queda en estado "entrevistado"', p.estado === 'entrevistado')
t.check('el DNI se guarda normalizado (sin puntos)', p.dni === '40999888')
t.check('el postulante NO existe en usuarios (no es empleado, no recibe turnos ni ficha)',
  (await db.query(`select count(*)::int n from public.usuarios where dni = '40999888'`)).rows[0].n === 0)

r = await rpc(P.supervisor, `select public.postulacion_crear($1::jsonb) id`, [JSON.stringify({ ...datos, enfermedades: 'x' })])
t.check('rechaza campos que no corresponden (p. ej. salud)', !r.ok && /no permitido/.test(r.error), r.error)
r = await rpc(P.supervisor, `select public.postulacion_crear($1::jsonb) id`, [JSON.stringify({ apellido: 'X', datos_seleccion: { medicacion: 'x' } })])
t.check('rechaza datos de selección fuera de la lista (p. ej. medicación)', !r.ok)
r = await rpc(P.supervisor, `select public.postulacion_crear($1::jsonb) id`, [JSON.stringify({ apellido: 'Otro', dni: '40999888' })])
t.check('no permite dos postulaciones abiertas con el mismo DNI', !r.ok && /abierta/.test(r.error), r.error)
r = await rpc(P.supervisor, `select public.postulacion_crear($1::jsonb) id`, [JSON.stringify({ apellido: 'X', dni: '41000000', cuil: '20410000001' })])
t.check('rechaza CUIL con dígito verificador inválido', !r.ok)
r = await rpc(P.supervisor, `select public.postulacion_crear($1::jsonb) id`, [JSON.stringify({ apellido: 'X', dni: '41000000', cuil: CUIL })])
t.check('rechaza CUIL que no corresponde al DNI', !r.ok)

// ── Visibilidad ─────────────────────────────────────────────────────────────
r = await rpc(P.supervisor2, `select count(*)::int n from public.postulaciones`)
t.check('otro supervisor no ve postulaciones ajenas', r.ok && r.r.rows[0].n === 0)
await rpc(P.administracion, `select public.postulacion_habilitar_supervisor($1, true)`, [P.supervisor2.id])
r = await rpc(P.supervisor2, `select count(*)::int n from public.postulaciones`)
t.check('aunque esté habilitado, sólo ve las que cargó él', r.ok && r.r.rows[0].n === 0)
r = await rpc(P.administracion, `select count(*)::int n from public.postulaciones`)
t.check('Administración ve todas', r.ok && r.r.rows[0].n === 1)
r = await rpc(P.supervisor, `insert into public.postulaciones (creado_por) values ($1)`, [P.supervisor.id])
t.check('nadie escribe la tabla directamente', !r.ok)

// ── Revisión ────────────────────────────────────────────────────────────────
r = await rpc(P.supervisor, `select public.postulacion_marcar_revisada($1)`, [idP])
t.check('no se puede marcar revisada con campos dudosos', !r.ok && /dudosos/.test(r.error), r.error)
r = await rpc(P.supervisor, `select public.postulacion_guardar($1, $2::jsonb)`, [idP, JSON.stringify({ telefono: '+54 9 341 555-0001', campos_dudosos: [] })])
t.check('el revisor confirma el dato dudoso', r.ok, r.error)
r = await rpc(P.supervisor, `select public.postulacion_marcar_revisada($1)`, [idP])
t.check('supervisor habilitado marca "revisado"', r.ok, r.error)

// ── Aprobación: sólo Administración/Gerencia ───────────────────────────────
r = await rpc(P.supervisor, `select public.postulacion_aprobar($1, current_date, null)`, [idP])
t.check('el supervisor NO puede aprobar el ingreso', !r.ok)
r = await rpc(P.administracion, `select public.postulacion_aprobar($1, current_date, null)`, [idP])
t.check('no se aprueba sin email', !r.ok && /email/.test(r.error), r.error)
r = await rpc(P.supervisor, `select public.postulacion_guardar($1, $2::jsonb)`, [idP, JSON.stringify({ email: 'postulante.uno@example.test' })])
t.check('el supervisor puede completar datos de su revisada', r.ok, r.error)
p = await fila(idP)
t.check('si el supervisor cambia una revisada, vuelve a "entrevistado"', p.estado === 'entrevistado')
await rpc(P.supervisor, `select public.postulacion_marcar_revisada($1)`, [idP])
r = await rpc(P.administracion, `select public.postulacion_aprobar($1, '2026-12-01', null)`, [idP])
t.check('Administración aprueba el ingreso', r.ok, r.error)
p = await fila(idP)
t.check('legajo propuesto = CUIL (convención vigente)', p.legajo_propuesto === CUIL)
r = await rpc(P.supervisor, `select public.postulacion_guardar($1, $2::jsonb)`, [idP, JSON.stringify({ apellido: 'Cambio' })])
t.check('el supervisor ya no modifica una aprobada', !r.ok)

// ── Alta efectiva ───────────────────────────────────────────────────────────
r = await rpc(P.supervisor, `select public.postulacion_alta_efectiva($1) r`, [idP])
t.check('el supervisor NO puede activar al empleado', !r.ok)
r = await rpc(P.administracion, `select public.postulacion_alta_efectiva($1) r`, [idP])
t.check('Administración da el alta efectiva', r.ok, r.error)
const alta = r.r?.rows[0].r
const emp = (await db.query(`select * from public.usuarios where id = $1`, [alta?.usuario_id])).rows[0]
t.check('se creó UN empleado activo, rol guardia, puesto vigilador', emp && emp.estado === 'activo' && emp.rol === 'guardia' && emp.puesto_organizacional === 'vigilador')
t.check('el empleado nace SIN cuenta de acceso (la invitación va aparte)', emp && emp.auth_user_id === null)
t.check('legajo y datos de identidad correctos', emp && emp.legajo === CUIL && emp.dni === '40999888' && emp.email === 'postulante.uno@example.test' && emp.telefono === '5493415550001')
const ldp = (await db.query(`select * from public.legajo_datos_personales where empleado_id = $1`, [alta?.usuario_id])).rows[0]
t.check('Legajo Digital: nacimiento, domicilio y fecha de ingreso cargados', ldp && ldp.domicilio_calle === 'Calle Ficticia' && String(ldp.fecha_ingreso).includes('2026'))
const camb = (await db.query(`select count(*)::int n, min(origen) o from public.legajo_cambios_datos where empleado_id = $1`, [alta?.usuario_id])).rows[0]
t.check('historial del legajo con origen "solicitud_empleo"', camb.n >= 8 && camb.o === 'solicitud_empleo', `${camb.n} cambios`)

r = await rpc(P.administracion, `select public.postulacion_alta_efectiva($1) r`, [idP])
t.check('reintento del alta: devuelve el mismo empleado, no crea otro', r.ok && r.r.rows[0].r.usuario_id === alta?.usuario_id && r.r.rows[0].r.ya_existia === true)
t.check('sigue habiendo un solo empleado con ese DNI', (await db.query(`select count(*)::int n from public.usuarios where dni = '40999888'`)).rows[0].n === 1)
const ev = (await db.query(`select string_agg(accion, ',' order by id) a from public.postulacion_eventos where postulacion_id = $1`, [idP])).rows[0].a
t.check('historial con responsable y fecha de cada paso', /creada.*revisada.*aprobada.*alta_efectiva/.test(ev), ev)
const detalle = (await db.query(`select string_agg(detalle::text, ' ') d from public.postulacion_eventos where postulacion_id = $1 and accion = 'datos_guardados'`, [idP])).rows[0].d
t.check('el historial no copia datos personales (sólo nombres de campos)', !detalle.includes('40999888') && !detalle.includes('Ficticia'))
r = await rpc(P.administracion, `select public.postulacion_guardar($1, $2::jsonb)`, [idP, JSON.stringify({ apellido: 'X' })])
t.check('una postulación dada de alta queda cerrada', !r.ok)
r = await intenta(() => db.query(`delete from public.postulacion_eventos where postulacion_id = $1`, [idP]))
t.check('el historial no se borra', !r.ok)

// ── Duplicados ──────────────────────────────────────────────────────────────
r = await rpc(P.supervisor, `select public.postulacion_crear($1::jsonb) id`, [JSON.stringify({ apellido: 'Repetido', nombre: 'Ficticio', dni: '30111222' })])
const idDup = r.r?.rows[0].id
t.check('se puede cargar la entrevista de alguien que ya es empleado (para detectarlo)', r.ok, r.error)
r = await rpc(P.administracion, `select * from public.postulacion_duplicados('30111222', null, null, null, $1)`, [idDup])
t.check('Administración ve con quién coincide (legajo y estado)', r.ok && r.r.rows[0]?.coincide_por === 'dni' && r.r.rows[0]?.legajo === '20301112229')
r = await rpc(P.supervisor, `select * from public.postulacion_duplicados('30111222', null, null, null, $1)`, [idDup])
t.check('el supervisor sólo sabe que existe (sin nombre ni legajo)', r.ok && r.r.rows.length === 1 && r.r.rows[0].legajo === null && r.r.rows[0].nombre === null)
await rpc(P.supervisor, `select public.postulacion_guardar($1, $2::jsonb)`, [idDup, JSON.stringify({
  cuil: dv('2030111222'), telefono: '5493415550002', fecha_nacimiento: '1990-01-01', domicilio_calle: 'X', domicilio_localidad: 'Rosario',
  domicilio_provincia: 'Santa Fe', email: 'otro@example.test' })])
await rpc(P.supervisor, `select public.postulacion_marcar_revisada($1)`, [idDup])
r = await rpc(P.administracion, `select public.postulacion_aprobar($1, current_date, 'LEG-NUEVO')`, [idDup])
t.check('no se aprueba a alguien que ya está en el personal', !r.ok && /ya existe/.test(r.error), r.error)
r = await rpc(P.administracion, `select public.postulacion_descartar($1, '')`, [idDup])
t.check('descartar exige motivo', !r.ok)
r = await rpc(P.administracion, `select public.postulacion_descartar($1, 'Ya es empleado')`, [idDup])
p = await fila(idDup)
t.check('descartada, con fecha de eliminación a 180 días', r.ok && p.estado === 'descartado' && p.eliminar_desde !== null)

// Menor de edad
r = await rpc(P.supervisor, `select public.postulacion_crear($1::jsonb) id`, [JSON.stringify({
  apellido: 'Menor', nombre: 'Ficticio', dni: '50111222', cuil: dv('2050111222'), telefono: '5493415550003', fecha_nacimiento: '2010-01-01',
  domicilio_calle: 'X', domicilio_localidad: 'Rosario', domicilio_provincia: 'Santa Fe' })])
const idMenor = r.r?.rows[0].id
r = await rpc(P.supervisor, `select public.postulacion_marcar_revisada($1)`, [idMenor])
t.check('no se revisa a un menor de 18 años', !r.ok && /menor/.test(r.error), r.error)

// ── Archivos ────────────────────────────────────────────────────────────────
const sha = 'a'.repeat(64)
const arch = '22222222-0000-0000-0000-000000000001'
r = await rpc(P.supervisor2, `select public.postulacion_registrar_archivo($1, $2, 'jpg', 'image/jpeg', 1000, $3, 1::smallint)`, [idMenor, arch, sha])
t.check('un supervisor no sube archivos a una postulación ajena', !r.ok)
r = await rpc(P.supervisor, `select public.postulacion_registrar_archivo($1, $2, 'jpg', 'image/jpeg', 1000, $3, 1::smallint) p`, [idMenor, arch, sha])
t.check('el que cargó la entrevista registra la foto', r.ok && r.r.rows[0].p === `${idMenor}/${arch}.jpg`, r.error)
r = await rpc(P.supervisor, `select public.postulacion_registrar_archivo($1, $2, 'jpg', 'image/jpeg', 1000, $3, 2::smallint) p`, [idMenor, '22222222-0000-0000-0000-000000000002', sha])
t.check('la misma imagen no se carga dos veces', !r.ok)
r = await rpc(P.supervisor2, `select public.postulacion_abrir_archivo($1)`, [arch])
t.check('otro supervisor no puede abrir la foto', !r.ok)
r = await rpc(P.gerencia, `select public.postulacion_abrir_archivo($1) p`, [arch])
t.check('Gerencia abre la foto y queda registrado', r.ok && (await db.query(`select count(*)::int n from public.postulacion_eventos where accion = 'archivo_visto'`)).rows[0].n === 1)
const pol = (await db.query(`select count(*)::int n from pg_policies where schemaname = 'storage' and (qual like '%postulaciones%' or with_check like '%postulaciones%')`)).rows[0].n
const bk = (await db.query(`select public from storage.buckets where id = 'postulaciones'`)).rows[0]
t.check('bucket "postulaciones" privado y sin políticas de acceso directo', bk && bk.public === false && pol === 0)

// Deshabilitar supervisor
await rpc(P.administracion, `select public.postulacion_habilitar_supervisor($1, false)`, [P.supervisor.id])
r = await rpc(P.supervisor, `select count(*)::int n from public.postulaciones`)
t.check('al deshabilitarlo deja de ver sus postulaciones', r.ok && r.r.rows[0].n === 0)

// ── Rollback ────────────────────────────────────────────────────────────────
r = await intenta(() => db.exec(migracion('rollback/20261208110000_postulaciones_rollback.sql')))
t.check('el rollback se ejecuta', r.ok, r.error)

t.fin()
