// Pruebas de 20261216120000_gestion_documental_administracion.sql sobre PGlite (SIN producción).
// Uso:
//   npm i --no-save @electric-sql/pglite@0.2.17
//   node supabase/pruebas/gestion-admin/run.mjs [raíz del repo]
// (PGLITE_MODULE permite apuntar a una instalación fuera del repo.)
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite')
const REPO = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const db = new PGlite()
const resultados = []
const ok = (nombre, cond, extra = '') => resultados.push([cond ? 'OK ' : 'FALLA', nombre, extra])
const sql = async (t, p) => (await db.query(t, p)).rows
async function como(uid, fn) {
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); set role authenticated;`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`) }
}
async function falla(fn) { try { await fn(); return null } catch (e) { return e.message } }

const GER = '00000000-0000-0000-0000-0000000000a1'
const ADM = '00000000-0000-0000-0000-0000000000a5'
const ADM2 = '00000000-0000-0000-0000-0000000000a6'
const SUP = '00000000-0000-0000-0000-0000000000a2'
const U_ADM = '10000000-0000-0000-0000-000000000005'

await db.exec(readFileSync(`${REPO}/supabase/pruebas/protocolos/prelude.sql`, 'utf8'))
await db.exec(`
create function public.acceso_habilitado_actual() returns boolean language sql stable as $$ select true $$;
create function public.legajo_puede_gestionar() returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' and u.puesto_organizacional in ('administracion','gerencia')) $$;
grant execute on function public.acceso_habilitado_actual() to authenticated;
grant execute on function public.legajo_puede_gestionar() to authenticated;
insert into public.usuarios (id, auth_user_id, puesto_organizacional, nombre) values
  ('10000000-0000-0000-0000-000000000001', '${GER}', 'gerencia', 'Gerente'),
  ('${U_ADM}', '${ADM}', 'administracion', 'Admin'),
  ('10000000-0000-0000-0000-000000000006', '${ADM2}', 'administracion', 'Admin 2'),
  ('10000000-0000-0000-0000-000000000002', '${SUP}', 'supervisor', 'Supervisor');
`)

await db.exec(readFileSync(`${REPO}/supabase/migrations/20261216120000_gestion_documental_administracion.sql`, 'utf8'))
ok('migración aplica en base vacía', true)

const sinFuente = await sql(`select codigo from public.gestion_obligaciones where tipo_fuente='legal' and validacion='confirmada' and (norma is null or fuente_url is null or verificado_at is null)`)
ok('ninguna obligación legal confirmada sin fuente', sinFuente.length === 0)
ok('obligación legal confirmada sin fuente es rechazada', !!(await falla(() => sql(`insert into public.gestion_obligaciones (codigo,nombre,ambito,tipo_fuente,validacion) values ('X','x','empresa','legal','confirmada')`))))
ok('recordatorios nacen apagados', (await sql(`select activo, canal from public.gestion_recordatorios_config`))[0].activo === false)
ok('responsables sin personas precargadas', (await sql(`select count(*)::int n from public.gestion_responsables where titular_id is not null`))[0].n === 0)

// Permisos de lectura
ok('supervisor no ve documentación empresarial', (await como(SUP, () => sql('select codigo from public.gestion_obligaciones'))).length === 0)
ok('administración ve el catálogo', (await como(ADM, () => sql('select codigo from public.gestion_obligaciones'))).length > 0)
ok('nadie escribe directo', !!(await falla(() => como(GER, () => sql(`insert into public.gestion_proveedores (razon_social) values ('x')`)))))

// Documento: registrar, revisar (no el mismo que sube), versionar, no borrar
const reg = (uid, extra = {}) => como(uid, async () => (await sql(`select public.gestion_documento_registrar(
  p_titular_tipo => 'empresa', p_titular_id => null, p_tipo => 'poliza_rc', p_obligacion_codigo => 'SF-SEGURO-RC',
  p_fecha_emision => '2026-01-01', p_vence_el => $1, p_storage_path => 'gestion/empresa/poliza.pdf',
  p_sha256 => $2, p_mime => 'application/pdf', p_bytes => 1000, p_reemplaza_a => $3) id`,
  [extra.vence ?? '2027-01-01', 'a'.repeat(64), extra.reemplaza ?? null]))[0].id)
const d1 = await reg(ADM)
ok('administración registra documento', !!d1)
ok('supervisor no registra', !!(await falla(() => reg(SUP))))
ok('quien subió no aprueba su propio documento', /no puede aprobarlo/.test(await falla(() => como(ADM, () => sql(`select public.gestion_documento_revisar($1,'aprobado')`, [d1]))) ?? ''))
ok('observar exige comentario', !!(await falla(() => como(ADM2, () => sql(`select public.gestion_documento_revisar($1,'observado')`, [d1])))))
await como(ADM2, () => sql(`select public.gestion_documento_revisar($1,'aprobado')`, [d1]))
ok('otra persona de administración aprueba', (await sql(`select estado_revision from public.gestion_documentos where id=$1`, [d1]))[0].estado_revision === 'aprobado')
ok('no se borra un documento', !!(await falla(() => sql(`delete from public.gestion_documentos where id=$1`, [d1]))))
ok('no se reescribe el archivo de un documento', !!(await falla(() => sql(`update public.gestion_documentos set sha256=$2 where id=$1`, [d1, 'b'.repeat(64)]))))
const d2 = await reg(ADM, { vence: '2028-01-01', reemplaza: d1 })
const [v] = await sql(`select d2.version, d1.reemplazado_por = d2.id as enlazado from public.gestion_documentos d1, public.gestion_documentos d2 where d1.id=$1 and d2.id=$2`, [d1, d2])
ok('versión nueva enlazada a la anterior', v.version === 2 && v.enlazado === true, JSON.stringify(v))
ok('no se reemplaza dos veces la misma versión', !!(await falla(() => reg(ADM, { reemplaza: d1 }))))

// Trámite: iniciado/presentado no renuevan; aprobar exige documento aprobado
const [{ id: seg }] = await sql(`insert into public.gestion_seguimientos (obligacion_codigo, titular_tipo, titular_id, documento_vigente_id, vence_el, validado_por, validado_at)
  values ('SF-SEGURO-RC','empresa',null,$1,'2027-01-01','10000000-0000-0000-0000-000000000001', now()) returning id`, [d1])
const acc = (uid, args) => como(uid, async () => {
  const n = Object.keys(args)
  return (await sql(`select public.gestion_seguimiento_accion(${n.map((k, i) => `${k} => $${i + 1}`).join(', ')}) r`, n.map(k => args[k])))[0].r
})
const op = () => crypto.randomUUID()
let r = await acc(ADM, { p_operacion_id: op(), p_seguimiento_id: seg, p_accion: 'iniciar', p_version: 1 })
ok('iniciar trámite', r.tramite === 'iniciado')
const o2 = op()
r = await acc(ADM, { p_operacion_id: o2, p_seguimiento_id: seg, p_accion: 'presentar', p_version: 2, p_faltantes: ['certificado'] })
ok('presentar', r.tramite === 'presentado')
ok('operación repetida es idempotente', (await acc(ADM, { p_operacion_id: o2, p_seguimiento_id: seg, p_accion: 'presentar', p_version: 2 })).duplicada === true)
ok('vencimiento NO cambia al presentar', (await sql(`select vence_el::text v from public.gestion_seguimientos where id=$1`, [seg]))[0].v === '2027-01-01')
ok('aprobar con documento pendiente de revisión: rechazado', /no alcanza/.test(await falla(() => acc(ADM, { p_operacion_id: op(), p_seguimiento_id: seg, p_accion: 'aprobar', p_version: 3, p_documento_id: d2, p_nuevo_vencimiento: '2028-01-01' })) ?? ''))
await como(GER, () => sql(`select public.gestion_documento_revisar($1,'aprobado')`, [d2]))
ok('aprobar con vencimiento no posterior: rechazado', /posterior/.test(await falla(() => acc(ADM, { p_operacion_id: op(), p_seguimiento_id: seg, p_accion: 'aprobar', p_version: 3, p_documento_id: d2, p_nuevo_vencimiento: '2026-12-01' })) ?? ''))
r = await acc(ADM, { p_operacion_id: op(), p_seguimiento_id: seg, p_accion: 'aprobar', p_version: 3, p_documento_id: d2, p_nuevo_vencimiento: '2028-01-01' })
const [s] = await sql(`select tramite, vence_el::text v, documento_vigente_id = $2 as doc from public.gestion_seguimientos where id=$1`, [seg, d2])
ok('aprobar renueva con documento aprobado y validación', r.ok && s.tramite === 'aprobado' && s.v === '2028-01-01' && s.doc, JSON.stringify(s))
ok('versión vieja → conflicto', (await acc(ADM, { p_operacion_id: op(), p_seguimiento_id: seg, p_accion: 'iniciar', p_version: 1 })).error === 'conflicto')
ok('eventos de seguimiento inmutables', !!(await falla(() => sql(`update public.gestion_seguimiento_eventos set accion='x'`))))

// Tareas
const tarea = await como(ADM, async () => (await sql(`select public.gestion_tarea_crear('Renovar póliza','obligaciones','2026-12-01',$1) id`, [U_ADM]))[0].id)
const tacc = (uid, args) => como(uid, async () => {
  const n = Object.keys(args)
  return (await sql(`select public.gestion_tarea_accion(${n.map((k, i) => `${k} => $${i + 1}`).join(', ')}) r`, n.map(k => args[k])))[0].r
})
ok('supervisor no ve tareas ajenas', (await como(SUP, () => sql('select id from public.gestion_tareas_admin'))).length === 0)
ok('resolver sin comentario: rechazado', !!(await falla(() => tacc(ADM, { p_operacion_id: op(), p_tarea_id: tarea, p_accion: 'resolver', p_version: 1 }))))
r = await tacc(ADM, { p_operacion_id: op(), p_tarea_id: tarea, p_accion: 'resolver', p_version: 1, p_comentario: 'Póliza renovada' })
ok('resolver tarea', r.estado === 'resuelta')
ok('tarea cerrada no admite acciones', !!(await falla(() => tacc(ADM, { p_operacion_id: op(), p_tarea_id: tarea, p_accion: 'tomar', p_version: 2 }))))

// Reclamos e informes
const rec = await como(ADM, async () => (await sql(`select public.gestion_reclamo_registrar('2026-11-10','telefono','Puesto sin vigilador a las 6') id`))[0].id)
ok('administración registra reclamo', !!rec)
ok('administración no guarda cierre mensual', !!(await falla(() => como(ADM, () => sql(`select public.gestion_informe_guardar('2026-10','{}', $1)`, ['c'.repeat(64)])))))
const i1 = await como(GER, async () => (await sql(`select public.gestion_informe_guardar('2026-10','{"horas":1}', $1) r`, ['c'.repeat(64)]))[0].r)
ok('gerencia guarda versión 1', i1.version === 1)
ok('versión 2 sin motivo: rechazada', !!(await falla(() => como(GER, () => sql(`select public.gestion_informe_guardar('2026-10','{"horas":2}', $1)`, ['d'.repeat(64)])))))
const i2 = await como(GER, async () => (await sql(`select public.gestion_informe_guardar('2026-10','{"horas":2}', $1, 'Corrección de horas') r`, ['d'.repeat(64)]))[0].r)
ok('versión 2 con motivo; la 1 queda intacta', i2.version === 2 && (await sql(`select contenido->>'horas' h from public.gestion_informes_mensuales where mes='2026-10' and version=1`))[0].h === '1')
ok('informe inmutable', !!(await falla(() => sql(`update public.gestion_informes_mensuales set motivo='x'`))))
ok('administración no lee informes de gerencia', (await como(ADM, () => sql('select id from public.gestion_informes_mensuales'))).length === 0)

const fallas = resultados.filter(r => r[0] !== 'OK ')
for (const r of resultados) console.log(r.join(' · '))
console.log(`\n${resultados.length - fallas.length}/${resultados.length} OK`)
process.exit(fallas.length ? 1 : 0)
