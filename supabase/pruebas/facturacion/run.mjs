// Prueba de 20261201120000/130000/140000 (facturación, ARCA, cuentas corrientes) sobre PGlite.
//   npm i --no-save @electric-sql/pglite@0.2.17
//   node supabase/pruebas/facturacion/run.mjs
// (o PGLITE=<ruta a node_modules/@electric-sql/pglite/dist/index.js> si está instalado en otra carpeta)
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'

const { PGlite } = await import(process.env.PGLITE ? pathToFileURL(process.env.PGLITE).href : '@electric-sql/pglite')
const REPO = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const MIGS = ['20261201120000_facturacion_base', '20261201130000_facturacion_comprobantes_arca', '20261201140000_facturacion_cuentas_corrientes']
const db = new PGlite()
const resultados = []
const ok = (nombre, cond, extra = '') => { resultados.push([cond ? 'OK ' : 'FALLA', nombre, extra]) }
const sql = async (texto, params) => (await db.query(texto, params)).rows
const uno = async (texto, params) => (await sql(texto, params))[0]

const GER = '00000000-0000-0000-0000-0000000000a1'
const ADM = '00000000-0000-0000-0000-0000000000a2'
const ADM2 = '00000000-0000-0000-0000-0000000000a3'
const SUP = '00000000-0000-0000-0000-0000000000a4'
const BAJA = '00000000-0000-0000-0000-0000000000a5'
const como = async (quien, fn) => {
  await db.exec(`select set_config('request.jwt.claim.sub', '${quien}', false); set role authenticated;`)
  try { return await fn() } finally { await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false);`) }
}
const servidor = async fn => {
  await db.exec(`set role service_role;`)
  try { return await fn() } finally { await db.exec(`reset role;`) }
}
const falla = async (fn, re) => {
  try { await fn(); return false } catch (e) { return re ? re.test(e.message) : true }
}

await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth, public to authenticated, anon, service_role; grant execute on function auth.uid() to authenticated, anon, service_role;
create table public.usuarios (id uuid primary key default gen_random_uuid(), auth_user_id uuid, nombre text, rol text, estado text,
  puesto_organizacional text, acceso_bloqueado boolean not null default false);
create table public.objetivos (id uuid primary key default gen_random_uuid(), nombre text not null, cliente text not null, estado text default 'activo');
create function public.puede_acceder_gerencia_actual() returns boolean language sql stable security definer as $$
  select exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.estado = 'activo' and u.puesto_organizacional = 'gerencia') $$;
grant execute on function public.puede_acceder_gerencia_actual() to authenticated;
create function public.acceso_habilitado_actual() returns boolean language sql stable security definer as $$
  select not exists (select 1 from public.usuarios u where u.auth_user_id = auth.uid() and u.acceso_bloqueado) $$;
grant execute on function public.acceso_habilitado_actual() to authenticated, anon;
insert into public.usuarios (id, auth_user_id, nombre, rol, estado, puesto_organizacional, acceso_bloqueado) values
  ('${GER}', '${GER}', 'GERENCIA', 'admin', 'activo', 'gerencia', false),
  ('${ADM}', '${ADM}', 'ADMINISTRACION', 'admin', 'activo', 'administracion', false),
  ('${ADM2}', '${ADM2}', 'ADMINISTRACION 2', 'admin', 'activo', 'administracion', false),
  ('${SUP}', '${SUP}', 'SERGIO', 'supervisor', 'activo', 'jefe_supervisores', false),
  ('${BAJA}', '${BAJA}', 'DE BAJA', 'admin', 'activo', 'administracion', true);
insert into public.objetivos (id, nombre, cliente) values
  ('00000000-0000-0000-0000-00000000b001', 'ALTO DELTA PORTERIA', 'CONEXION ALTO DELTA'),
  ('00000000-0000-0000-0000-00000000b002', 'LAROMET OBRADOR 1', 'LAROMET'),
  ('00000000-0000-0000-0000-00000000b003', 'LAROMET OBRADOR 2', 'LAROMET'),
  ('00000000-0000-0000-0000-00000000b004', 'ACA ROSARIO SEDE', 'ACA'),
  ('00000000-0000-0000-0000-00000000b005', 'ACA ROSARIO DEPOSITO', 'ACA');
`)
for (const m of MIGS) await db.exec(readFileSync(`${REPO}/supabase/migrations/${m}.sql`, 'utf8'))
ok('las tres migraciones aplican', true)

// ── Permisos ───────────────────────────────────────────────────────────────
const CAD = await como(ADM, async () => (await uno(`select public.fact_cliente_guardar(null, '{"razon_social":"CONEXION ALTO DELTA S.A.","cuit":"30-71234567-2"}'::jsonb) id`).catch(() => null)))
ok('CUIT con dígito verificador inválido se rechaza', CAD === null || CAD === undefined)
const cliente = async (quien, datos) => (await como(quien, () => uno(`select public.fact_cliente_guardar(null, $1::jsonb) id`, [JSON.stringify(datos)]))).id
// CUIT reales: Alto Delta según sus certificados de retención (OP 323); Laromet, La Caja y Club Uni(versitario)
// según la planilla de horas de octubre. Importes de 2018/2023/834/2047 según FACTURAS CORRELATIVAS 2026.
const altoDelta = await cliente(ADM, { razon_social: 'CONEXION ALTO DELTA S.A.', cuit: '30-71924433-1' })
const laromet = await cliente(ADM, { razon_social: 'LAROMET S.A.', cuit: '30501125594' })
const hagana = await cliente(GER, { razon_social: 'HAGANA S.A. (LA CAJA)', cuit: '30707891579' })
const univ = await cliente(ADM, { razon_social: 'CLUB UNIVERSITARIO', cuit: '30589038181' })
const arca = await cliente(ADM, { razon_social: 'AGENCIA DE RECAUDACION Y CONTROL ADUANERO', cuit: '33-69345023-9' })
ok('Administración y Gerencia cargan clientes; CUIT de ARCA válido', [altoDelta, laromet, hagana, univ, arca].every(Boolean))
ok('CUIT duplicado se rechaza', await falla(() => cliente(ADM, { razon_social: 'OTRA', cuit: '33693450239' })))
ok('supervisor (Sergio) no ve clientes', (await como(SUP, () => sql(`select * from public.fact_clientes`))).length === 0)
ok('supervisor no ejecuta RPC de facturación', await falla(() => cliente(SUP, { razon_social: 'X SA' }), /Gerencia o Administración/))
ok('nadie escribe directo en las tablas', await falla(() => como(ADM, () => sql(`insert into public.fact_clientes (razon_social) values ('X SA')`)), /permission denied/))
ok('usuario con acceso bloqueado por baja no ve nada', (await como(BAJA, () => sql(`select * from public.fact_clientes`))).length === 0)

// Alias: equivalencia sin confirmar; el mismo alias no va a dos clientes.
await como(ADM, () => sql(`select public.fact_alias_guardar($1, 'Club Unidos', 'planilla', false, 'Vinculado en la planilla; confirmar')`, [univ]))
ok('alias pendiente de confirmar queda marcado', (await uno(`select confirmado from public.fact_cliente_alias where alias = 'Club Unidos'`)).confirmado === false)
ok('un alias no se asigna a dos clientes', await falla(() => como(ADM, () => sql(`select public.fact_alias_guardar($1, 'club unidos', 'banco', true)`, [laromet]))))

// ── Contrato, tarifas, OC ──────────────────────────────────────────────────
const contrato = async (datos) => (await como(ADM, () => uno(`select public.fact_contrato_guardar(null, $1::jsonb) id`, [JSON.stringify(datos)]))).id
const kAlto = await contrato({ cliente_id: altoDelta, nombre: 'Vigilancia', modalidad: 'por_hora', requisitos: ['oc_mensual'], tipo_comprobante: 1, estado: 'vigente' })
const kHag = await contrato({ cliente_id: hagana, nombre: 'La Caja', modalidad: 'por_hora', regla_periodo: 'corte', dia_corte: 26, dias_vencimiento: 45, tipo_comprobante: 1 })
ok('regla de corte sin día se rechaza', await falla(() => contrato({ cliente_id: hagana, nombre: 'mal', modalidad: 'por_hora', regla_periodo: 'corte' })))
ok('requisito desconocido se rechaza', await falla(() => contrato({ cliente_id: hagana, nombre: 'mal', modalidad: 'por_hora', requisitos: ['remito_sustituye_factura'] })))
const tarifa = (k, precio, iva, desde) => como(ADM, () => uno(`select public.fact_tarifa_agregar($1, null, 'hora', $2, $3, 21, $4, 'contrato') id`, [k, precio, iva, desde]))
await tarifa(kAlto, '14000', 'adicional', '2026-01-01')
await tarifa(kAlto, '14853.20', 'adicional', '2026-07-01')
const ts = await sql(`select precio::text, vigencia_desde::text d, vigencia_hasta::text h from public.fact_tarifas where contrato_id = $1 order by vigencia_desde`, [kAlto])
ok('tarifa nueva cierra la anterior el día previo', ts.length === 2 && ts[0].h === '2026-06-30' && ts[1].h === null, JSON.stringify(ts))
ok('no se carga una tarifa que pisa una vigencia posterior', await falla(() => tarifa(kAlto, '1', 'adicional', '2026-03-01')))
ok('tarifa sin tratamiento de IVA se puede guardar como sin_definir (no se infiere)', !!(await tarifa(kHag, '12345.678901', 'sin_definir', '2026-01-01')).id)

const aca = await cliente(ADM, { razon_social: 'AUTOMOVIL CLUB ARGENTINO', cuit: '30555555551' })
const oc = await como(ADM, () => uno(`select public.fact_oc_guardar(null, $1::jsonb, $2::uuid[]) id`,
  [JSON.stringify({ cliente_id: aca, numero: '295', vigencia_desde: '2026-01-01', vigencia_hasta: '2026-12-31', monto_neto_c: 1000000000 }),
   '{00000000-0000-0000-0000-00000000b004,00000000-0000-0000-0000-00000000b005}']))
const ocRows = await sql(`select o.monto_neto_c::text m, (select count(*)::int from public.fact_oc_objetivos x where x.oc_id = o.id) n from public.fact_ordenes_compra o`)
ok('OC compartida por dos objetivos: una sola fila con un solo monto', ocRows.length === 1 && ocRows[0].n === 2 && ocRows[0].m === '1000000000')
const ocIva = (datos) => como(ADM, () => uno(`select public.fact_oc_guardar(null, $1::jsonb, null) id`, [JSON.stringify({ cliente_id: aca, ...datos })]))
ok('OC con monto neto y total a la vez se rechaza', await falla(() => ocIva({ numero: 'X', monto_neto_c: 100, monto_total_c: 121 })))
const ocAca = (await ocIva({ numero: '0006-26', vigencia_desde: '2026-06-01', vigencia_hasta: '2027-05-31', monto_total_c: 12825516000 })).id
ok('OC real de ACA (0006-26) se guarda con su monto CON IVA', (await uno(`select monto_total_c::text t, monto_neto_c from public.fact_ordenes_compra where id = $1`, [ocAca])).t === '12825516000')

// ── Documentos ─────────────────────────────────────────────────────────────
const SHA1 = 'a'.repeat(64)
const doc = async (sha, tipo = 'orden_compra', path = `x/${sha.slice(0, 8)}-${Math.random()}.pdf`) =>
  (await como(ADM, () => uno(`select public.fact_documento_registrar($1::jsonb) r`, [JSON.stringify({ tipo, storage_path: path, nombre_original: 'OC -00000238.pdf', sha256: sha, datos_propuestos: { numero: '238' } })]))).r
const d1 = await doc(SHA1)
const d1b = await doc(SHA1)
ok('documento duplicado (mismo hash) devuelve el original', d1b.duplicado === true && d1b.id === d1.id)
const v1 = (await como(ADM, () => uno(`select public.fact_documento_vincular($1, 'cliente', $2) id`, [d1.id, laromet]))).id
await como(ADM, () => sql(`select public.fact_documento_desvincular($1, 'Era de Alto Delta, no de Laromet')`, [v1]))
await como(ADM, () => sql(`select public.fact_documento_vincular($1, 'cliente', $2)`, [d1.id, altoDelta]))
const vincs = await sql(`select entidad_id, anulado_at is not null anulado from public.fact_documento_vinculos where documento_id = $1 order by created_at`, [d1.id])
ok('corregir una asociación conserva la anterior anulada', vincs.length === 2 && vincs[0].anulado && !vincs[1].anulado)
ok('lo propuesto por extracción no queda como confirmado', (await uno(`select datos_confirmados, estado from public.fact_documentos where id = $1`, [d1.id])).estado === 'pendiente_revision')

// ── Horas aprobadas ────────────────────────────────────────────────────────
const OBJ_AD = '00000000-0000-0000-0000-00000000b001'
const aprobar = (reemplazar = false, min = 544 * 60) => como(ADM, () => uno(
  `select public.fact_horas_aprobar($1, $2, '2026-08-01', '2026-09-01', $3::jsonb, '[{"turno_id":"t1","minutos":60}]'::jsonb, null, $4) id`,
  [OBJ_AD, kAlto, JSON.stringify({ programados: min, cubiertos: min, superpuestos: 0, descubiertos: 0, aprobados: min }), reemplazar]))
const h1 = (await aprobar()).id
ok('no se aprueban dos veces las mismas horas', await falla(() => aprobar()))

// ── Prefactura ─────────────────────────────────────────────────────────────
const lineas = [{ concepto: 'Horas de vigilancia', cantidad: '544', precio: '14853.20', tarifaId: null, importes: { neto: 808014080, iva: 169682957, total: 977697037 } }]
const datosPref = (extra = {}) => JSON.stringify({ cliente_id: altoDelta, contrato_id: kAlto, agrupacion_clave: 'cliente', periodo_mes: '2026-08',
  periodo_desde: '2026-08-01', periodo_hasta_excl: '2026-09-01', horas_aprobacion_ids: [h1], minutos_programados: 544 * 60, minutos_cubiertos: 544 * 60, minutos_aprobados: 544 * 60,
  minutos_descubiertos: 0, lineas, neto_c: 808014080, iva_c: 169682957, total_c: 977697037, cuit_receptor: '30719244331', tipo_comprobante: 1,
  punto_venta: 1, texto_factura: 'Servicio de vigilancia agosto 2026', estado: 'esperando_requisitos',
  requisitos: [{ tipo: 'oc_mensual', detalle: 'Falta la OC' }], ...extra })
const pref = (await como(ADM, () => uno(`select public.fact_prefactura_guardar(null, $1::jsonb) id`, [datosPref()]))).id
ok('una segunda prefactura para la misma prestación se rechaza', await falla(() => como(ADM, () => sql(`select public.fact_prefactura_guardar(null, $1::jsonb)`, [datosPref()])), /duplicate|unique/i))
const version = async () => (await uno(`select version from public.fact_prefacturas where id = $1`, [pref])).version
ok('no se aprueba con requisitos pendientes', await falla(() => como(ADM, async () => sql(`select public.fact_prefactura_aprobar($1, $2)`, [pref, await version()]))))
ok('no se puede saltar a emitida a mano', await falla(() => como(ADM, async () => sql(`select public.fact_prefactura_estado($1, 'emitida', $2)`, [pref, await version()]))))
await como(ADM, async () => sql(`select public.fact_prefactura_guardar($1, $2::jsonb, $3)`, [pref, datosPref({ requisitos: [], estado: 'lista_revision' }), await version()]))
await como(ADM, async () => sql(`select public.fact_prefactura_aprobar($1, $2)`, [pref, await version()]))
ok('aprobada para emitir', (await uno(`select estado from public.fact_prefacturas where id = $1`, [pref])).estado === 'aprobada_emitir')
await como(ADM, async () => sql(`select public.fact_prefactura_texto($1, 'Servicio de vigilancia AGOSTO 2026 - OC 238', $2)`, [pref, await version()]))
const tras = await uno(`select estado, huella_aprobada from public.fact_prefacturas where id = $1`, [pref])
ok('editar el texto después de aprobar vuelve a revisión', tras.estado === 'lista_revision' && tras.huella_aprobada === null, JSON.stringify(tras))
ok('…y queda registrado en el historial', !!(await uno(`select 1 x from public.fact_historial where entidad_id = $1 and accion = 'aprobacion_caida'`, [pref])))
await como(GER, async () => sql(`select public.fact_prefactura_aprobar($1, $2)`, [pref, await version()]))

// Ajuste comercial sin aprobar bloquea la aprobación.
const otraPref = (await como(ADM, () => uno(`select public.fact_prefactura_guardar(null, $1::jsonb) id`, [datosPref({ periodo_mes: '2026-09', periodo_desde: '2026-09-01', periodo_hasta_excl: '2026-10-01', requisitos: [], estado: 'lista_revision', horas_aprobacion_ids: [] })]))).id
await como(ADM, () => sql(`select public.fact_ajuste_agregar($1, 'Bonificación', -100000, 'Acuerdo comercial con el cliente')`, [otraPref]))
ok('ajuste sin resolver bloquea la aprobación', await falla(() => como(ADM, async () => sql(`select public.fact_prefactura_aprobar($1, (select version from public.fact_prefacturas where id = $1))`, [otraPref])), /ajustes/))
ok('ajuste sin motivo se rechaza', await falla(() => como(ADM, () => sql(`select public.fact_ajuste_agregar($1, 'X', 5, '')`, [otraPref]))))

// ── Emisión ARCA ───────────────────────────────────────────────────────────
const vNow = await version()
ok('emisión real deshabilitada por defecto', await falla(() => como(ADM, () => sql(`select public.fact_emision_preparar($1, $2, 'produccion')`, [pref, vNow])), /deshabilitada/))
const e1 = (await como(ADM, () => uno(`select public.fact_emision_preparar($1, $2, 'homologacion') r`, [pref, vNow]))).r
const e1b = (await como(ADM, () => uno(`select public.fact_emision_preparar($1, $2, 'homologacion') r`, [pref, vNow]))).r
ok('preparar dos veces devuelve la misma solicitud (idempotente)', e1.id === e1b.id && e1b.existente === true)
ok('el ciclo ARCA no lo ejecuta un usuario', await falla(() => como(ADM, () => sql(`select public.fact_emision_iniciar_envio($1, 1, '{}'::jsonb)`, [e1.id]))))
await servidor(() => sql(`select public.fact_emision_iniciar_envio($1, 1, '{}'::jsonb)`, [e1.id]))
await servidor(() => sql(`select public.fact_emision_resultado($1, 'incierta', '{"error":"timeout"}'::jsonb)`, [e1.id]))
ok('respuesta incierta: no se reintenta sin consultar', await falla(() => servidor(() => sql(`select public.fact_emision_iniciar_envio($1, 1, '{}'::jsonb)`, [e1.id])), /consultar/))
await servidor(() => sql(`select public.fact_emision_consulta($1, false, '{"ResultGet":null}'::jsonb)`, [e1.id]))
await servidor(() => sql(`select public.fact_emision_iniciar_envio($1, 1, '{}'::jsonb)`, [e1.id]))
await servidor(() => sql(`select public.fact_emision_resultado($1, 'A', '{"Resultado":"A"}'::jsonb, '76000000000001', '2026-09-14', '2026-09-04')`, [e1.id]))
const homo = await uno(`select ambiente, (select estado from public.fact_prefacturas where id = $1) pe from public.fact_comprobantes where cae = '76000000000001'`, [pref])
ok('homologación crea comprobante de prueba sin marcar la prefactura como emitida', homo?.ambiente === 'homologacion' && homo.pe === 'aprobada_emitir', JSON.stringify(homo))

await db.exec(`update public.fact_config set valor = valor || '{"produccion_habilitada": true}' where clave = 'emision'`)
const e2 = (await como(ADM, async () => uno(`select public.fact_emision_preparar($1, $2, 'produccion') r`, [pref, await version()]))).r
await servidor(() => sql(`select public.fact_emision_iniciar_envio($1, 2047, '{}'::jsonb)`, [e2.id]))
await servidor(() => sql(`select public.fact_emision_resultado($1, 'A', '{"Resultado":"A"}'::jsonb, '76111111111111', '2026-09-14', '2026-09-04')`, [e2.id]))
const fa2047 = await uno(`select id, total_c::text t, tipo, numero::int n from public.fact_comprobantes where ambiente = 'produccion' and numero = 2047`)
ok('Alto Delta FA 0001-2047 autorizada por $9.776.970,37', fa2047?.t === '977697037' && fa2047.tipo === 1, JSON.stringify(fa2047))
ok('la prefactura queda emitida', (await uno(`select estado from public.fact_prefacturas where id = $1`, [pref])).estado === 'emitida')
ok('una prefactura emitida no se modifica', await falla(() => como(ADM, async () => sql(`select public.fact_prefactura_texto($1, 'otro', $2)`, [pref, await version()]))))
ok('un comprobante autorizado no se modifica', await falla(() => sql(`update public.fact_comprobantes set total_c = 1 where id = $1`, [fa2047.id]), /no se modifica/))
ok('un comprobante autorizado no se borra', await falla(() => sql(`delete from public.fact_comprobantes where id = $1`, [fa2047.id]), /no se borra/))
ok('no se reemplazan horas ya facturadas', await falla(() => aprobar(true, 500 * 60), /nota de crédito/))

// ── Importación ARCA (Laromet, Hagana, Universitario) ──────────────────────
const fila = (tipo, pv, numero, fecha, cuit, total_c, extra = {}) => ({ clave: `${tipo}-${pv}-${numero}`, tipo, punto_venta: pv, numero, fecha, doc_tipo_receptor: 80, doc_nro_receptor: cuit, total_c, neto_c: Math.round(total_c / 1.21), ...extra })
const filas = [
  fila(1, 1, 2018, '2026-08-01', '30501125594', 185901901), fila(3, 3, 186, '2026-08-01', '30501125594', 185901901),
  fila(1, 1, 2023, '2026-08-04', '30707891579', 436037536), fila(3, 3, 187, '2026-08-04', '30707891579', 218018768),
  fila(6, 1, 834, '2026-10-01', '30589038181', 926155020),
  fila(1, 1, 2047, '2026-09-04', '30719244331', 977697037), // ya registrada por la app
]
const SHA_CSV = 'b'.repeat(64)
const imp = (await como(ADM, () => uno(`select public.fact_importacion_arca_crear('comprobantes_consulta_csv_emitidos.csv', $1, null, $2::jsonb) r`, [SHA_CSV, JSON.stringify([...filas, filas[0]])]))).r
const imp2 = (await como(ADM, () => uno(`select public.fact_importacion_arca_crear('copia (2).csv', $1, null, $2::jsonb) r`, [SHA_CSV, JSON.stringify(filas)]))).r
ok('el mismo CSV (copias del ZIP) no se importa dos veces', imp2.duplicado === true && imp2.id === imp.id)
const res = (await uno(`select resumen from public.fact_importaciones where id = $1`, [imp.id])).resumen
ok('filas repetidas dentro del archivo no se multiplican', res.comprobantes_unicos === 6 && res.repetidas === 1, JSON.stringify(res))
ok('el comprobante ya emitido por la app figura como ya existente', res.por_estado.ya_existe === 1, JSON.stringify(res.por_estado))
ok('la importación queda en revisión', (await uno(`select estado from public.fact_importaciones where id = $1`, [imp.id])).estado === 'en_revision')
const nConf = (await como(ADM, () => uno(`select public.fact_importacion_arca_confirmar($1, $2::text[]) n`, [imp.id, filas.map(f => f.clave)]))).n
ok('se confirman sólo las nuevas', nConf === 5, String(nConf))
const comp = async n => uno(`select id, cliente_id from public.fact_comprobantes where ambiente = 'produccion' and numero = $1 and tipo in (1,3,6)`, [n])
const fa2018 = await comp(2018), nc186 = await comp(186), fa2023 = await comp(2023), nc187 = await comp(187), fb834 = await comp(834)
ok('cliente asociado por CUIT al confirmar', fa2018.cliente_id === laromet && fb834.cliente_id === univ)
ok('NC A no se asocia a factura B', await falla(() => como(ADM, () => sql(`select public.fact_comprobante_asociar($1, null, $2, null)`, [nc186.id, fb834.id]))))
await como(ADM, () => sql(`select public.fact_comprobante_asociar($1, null, $2, null, 'Reversión total: obradores facturados juntos')`, [nc186.id, fa2018.id]))
await como(ADM, () => sql(`select public.fact_comprobante_asociar($1, null, $2, null, 'Corrección de 152 horas')`, [nc187.id, fa2023.id]))
const alc = async id => (await uno(`select alcance_nota from public.fact_comprobantes where id = $1`, [id])).alcance_nota
const saldo = async id => Number((await uno(`select saldo_c from public.fact_v_saldos where comprobante_id = $1`, [id])).saldo_c)
ok('Laromet: NC 186 es reversión TOTAL y la FA 2018 queda en cero', await alc(nc186.id) === 'total' && await saldo(fa2018.id) === 0)
ok('Hagana: NC 187 es corrección PARCIAL y quedan $2.180.187,68', await alc(nc187.id) === 'parcial' && await saldo(fa2023.id) === 218018768)
ok('una asociación fijada no se cambia', await falla(() => como(ADM, () => sql(`select public.fact_comprobante_asociar($1, null, $2, null)`, [nc187.id, fa2018.id]))) ||
  (await uno(`select asociado_id from public.fact_comprobantes where id = $1`, [nc187.id])).asociado_id === fa2023.id)
ok('NC que excede lo que queda por acreditar no se solicita', await falla(() => como(ADM, () => sql(`select public.fact_nota_solicitar($1, 3, 200000000, 42000000, 'excede')`, [fa2023.id])), /supera/))
const nota = (await como(ADM, () => uno(`select public.fact_nota_solicitar($1, 3, 100000, 21000, 'Ajuste menor') id`, [fa2023.id]))).id
ok('NC parcial solicitada queda pendiente y marcada como parcial', (await uno(`select estado, alcance_nota from public.fact_emisiones where id = $1`, [nota])).alcance_nota === 'parcial')
// Regla comercial: Administración puede aprobar su propia NC; queda registrado quién pidió y quién aprobó.
await como(ADM, () => sql(`select public.fact_nota_aprobar($1)`, [nota]))
const notaAp = await uno(`select estado, creado_por, aprobado_por from public.fact_emisiones where id = $1`, [nota])
ok('Administración aprueba su propia NC y queda registrado', notaAp.estado === 'preparada' && notaAp.creado_por === ADM && notaAp.aprobado_por === ADM)
ok('…la aprobación queda en el historial', !!(await uno(`select 1 x from public.fact_historial where accion = 'nota_aprobada' and por = $1`, [ADM])))

// ── Extracto y conciliación ────────────────────────────────────────────────
const movs = [
  { fecha: '2026-10-09', importe_c: 876829617, concepto: 'TRANSFERENCIA RECIBIDA', cuit_contraparte: '30719244331', hash: 'h1', clasificacion: 'cobranza_posible' },
  { fecha: '2026-10-26', importe_c: 926155020, concepto: 'CR TRANSF', cuit_contraparte: '30589038181', hash: 'h2', clasificacion: 'cobranza_posible' },
  { fecha: '2026-10-15', importe_c: 50000000, concepto: 'RESCATE FCI', hash: 'h3', clasificacion: 'no_cobranza', clasificacion_motivo: 'Rescate o movimiento de inversión' },
]
const CTA_GAL = (await como(ADM, () => uno(`select public.fact_cuenta_bancaria_guardar('{"banco":"galicia","numero":"511522209"}'::jsonb) id`))).id
const CTA_MUN = (await como(ADM, () => uno(`select public.fact_cuenta_bancaria_guardar('{"banco":"municipal_rosario","numero":"12345678"}'::jsonb) id`))).id
const ex1 = (await como(ADM, () => uno(`select public.fact_extracto_importar('${CTA_GAL}', 'EXTRACTO oct.csv', $1, null, $2::jsonb) r`, ['c'.repeat(64), JSON.stringify(movs)]))).r
const ex2 = (await como(ADM, () => uno(`select public.fact_extracto_importar('${CTA_GAL}', 'EXTRACTO oct (2).csv', $1, null, $2::jsonb) r`, ['d'.repeat(64), JSON.stringify(movs.slice(0, 1))]))).r
ok('extracto: líneas ya importadas no se duplican', ex1.nuevos === 3 && ex2.nuevos === 0 && ex2.ya_importados === 1, JSON.stringify([ex1, ex2]))
const mov = async h => (await uno(`select id from public.fact_movimientos_bancarios where hash_linea = $1`, [h])).id
ok('un rescate de inversión no se registra como cobro', await falla(() => como(ADM, async () => sql(`select public.fact_cobro_registrar($1::jsonb)`,
  [JSON.stringify({ cliente_id: univ, fecha: '2026-10-15', importe_c: 50000000, medio: 'transferencia', movimiento_id: await mov('h3') })])), /no está clasificado/))

const ret = async (datos) => (await como(ADM, () => uno(`select public.fact_retencion_registrar($1::jsonb) id`, [JSON.stringify({ cliente_id: altoDelta, fecha: '2026-10-09', ...datos })]))).id
const estimada = await ret({ impuesto: 'iibb', importe_c: 5000, estado: 'estimada' })
const g409 = await ret({ impuesto: 'ganancias', certificado: '409', importe_c: 16025942, orden_pago: '323', estado: 'certificado_recibido' })
const i8 = await ret({ impuesto: 'iva', certificado: '8', importe_c: 84841478, orden_pago: '323', estado: 'certificado_recibido' })
ok('el mismo certificado no se carga dos veces', await falla(() => ret({ impuesto: 'iva', certificado: '8', importe_c: 84841478, orden_pago: '323', estado: 'certificado_recibido' })))
ok('una retención estimada no cancela deuda', await falla(() => como(ADM, () => sql(`select public.fact_aplicar('retencion', $1, $2, null, 5000)`, [estimada, fa2047.id])), /sin certificado/))

const m1 = await mov('h1')
// Propuesta tal como la arma lib/facturacion/conciliacion (fuerte, certificados con vínculo inferido).
const propAlto = [{ clienteId: altoDelta, fuerza: 'fuerte', motivos: ['CUIT coincide', 'Todos los certificados remiten a la orden de pago 323.'],
  advertencias: ['Los certificados no citan la factura'], aplicaciones: [
    { comprobanteId: fa2047.id, origen: 'retencion', origenId: g409, importe: 16025942, vinculo: 'inferido' },
    { comprobanteId: fa2047.id, origen: 'retencion', origenId: i8, importe: 84841478, vinculo: 'inferido' },
    { comprobanteId: fa2047.id, origen: 'cobro', origenId: m1, importe: 876829617, vinculo: 'inferido' }] }]
await como(ADM, () => sql(`select public.fact_propuestas_guardar($1, $2::jsonb)`, [m1, JSON.stringify(propAlto)]))
const pAlto = (await uno(`select id from public.fact_propuestas where movimiento_id = $1 and estado = 'propuesta'`, [m1])).id
await como(ADM, () => sql(`select public.fact_propuesta_aceptar($1)`, [pAlto]))
ok('Alto Delta: transferencia + retenciones cancelan la FA 2047 exacto', await saldo(fa2047.id) === 0)
ok('…las aplicaciones conservan el vínculo inferido y la evidencia', (await sql(`select vinculo from public.fact_aplicaciones where propuesta_id = $1`, [pAlto])).every(r => r.vinculo === 'inferido'))
ok('una propuesta aceptada no se acepta otra vez', await falla(() => como(ADM, () => sql(`select public.fact_propuesta_aceptar($1)`, [pAlto]))))
ok('un certificado no se aplica dos veces', await falla(() => como(ADM, () => sql(`select public.fact_aplicar('retencion', $1, $2, null, 1)`, [g409, fa2047.id]))))
await como(ADM, () => sql(`select public.fact_propuestas_guardar($1, $2::jsonb)`, [m1, JSON.stringify(propAlto)]))
const pDup = (await uno(`select id from public.fact_propuestas where movimiento_id = $1 and estado = 'propuesta'`, [m1])).id
ok('el mismo movimiento no genera un segundo cobro', await falla(() => como(ADM, () => sql(`select public.fact_propuesta_aceptar($1)`, [pDup]))))

const m2 = await mov('h2')
await como(ADM, () => sql(`select public.fact_propuestas_guardar($1, $2::jsonb)`, [m2, JSON.stringify([{ clienteId: univ, fuerza: 'fuerte', motivos: ['CUIT'], advertencias: [],
  aplicaciones: [{ comprobanteId: fb834.id, origen: 'cobro', origenId: m2, importe: 926155020, vinculo: 'inferido' }] }])]))
await como(ADM, async () => sql(`select public.fact_propuesta_aceptar((select id from public.fact_propuestas where movimiento_id = $1 and estado = 'propuesta'))`, [m2]))
ok('Universitario: FB 834 cobrada por el ingreso del 26/10', await saldo(fb834.id) === 0)
const apUniv = (await uno(`select id from public.fact_aplicaciones where comprobante_id = $1 and revertida_at is null`, [fb834.id])).id
ok('revertir sin motivo no se permite', await falla(() => como(ADM, () => sql(`select public.fact_aplicacion_revertir($1, '')`, [apUniv]))))
await como(GER, () => sql(`select public.fact_aplicacion_revertir($1, 'Prueba de reversión')`, [apUniv]))
ok('reversión auditada devuelve el saldo', await saldo(fb834.id) === 926155020 && !!(await uno(`select 1 x from public.fact_historial where entidad_id = $1 and accion = 'revertida'`, [apUniv])))

// Cheque rechazado revierte su aplicación.
const ch = (await como(ADM, () => uno(`select public.fact_cobro_registrar($1::jsonb) id`, [JSON.stringify({ cliente_id: hagana, fecha: '2026-10-20', importe_c: 100000000, medio: 'echeq', cheque_numero: '123' })]))).id
await como(ADM, () => sql(`select public.fact_aplicar('cobro', $1, $2, null, 100000000)`, [ch, fa2023.id]))
ok('pago parcial reduce el saldo', await saldo(fa2023.id) === 118018768)
await como(ADM, () => sql(`select public.fact_cheque_estado($1, 'depositado')`, [ch]))
await como(ADM, () => sql(`select public.fact_cheque_estado($1, 'rechazado', 'Sin fondos')`, [ch]))
ok('cheque rechazado revierte su aplicación', await saldo(fa2023.id) === 218018768)
ok('no se aplica un cobro a otro cliente', await falla(() => como(ADM, () => sql(`select public.fact_aplicar('cobro', (select id from public.fact_cobros where movimiento_id = $1), $2, null, 1)`, [m1, fa2018.id]))))

ok('saldo inicial sin documento se rechaza', await falla(() => como(ADM, () => sql(`select public.fact_saldo_inicial_registrar($1, '2026-01-01', 1000, 'Saldo según extracto', null)`, [univ]))))

// ── Tablero ────────────────────────────────────────────────────────────────
const tab = (await como(ADM, () => uno(`select public.fact_tablero('2026-10', '2026-11-03') t`))).t
ok('tablero: emisión de octubre separada (sólo FB 834)', tab.emision.facturas_total_c === 926155020, JSON.stringify(tab.emision))
ok('tablero: cobrado y retenciones por separado; rescate fuera de cobranza', tab.cobro.cobrado_c === 876829617 + 926155020 && tab.cobro.retenciones_certificadas_c === 16025942 + 84841478
  && tab.cobro.ingresos_no_cobranza_c === 50000000, JSON.stringify(tab.cobro))
ok('tablero: cobro de Universitario revertido queda pendiente de aplicar', tab.sin_aplicar.cobros_c === 926155020, JSON.stringify(tab.sin_aplicar))
ok('tablero: sin rentabilidad por falta de costos', tab.rentabilidad.disponible === false)
const tabAgo = (await como(ADM, () => uno(`select public.fact_tablero('2026-08', '2026-11-03') t`))).t
ok('tablero: horas de agosto programadas, cubiertas y facturadas (de la foto aprobada)', Number(tabAgo.horas.programadas) === 544 && Number(tabAgo.horas.facturadas) === 544
  && Number(tabAgo.horas.pendientes_facturar) === 0 && Number(tabAgo.precio_hora.promedio_c) === 1485320, JSON.stringify([tabAgo.horas, tabAgo.precio_hora]))
ok('supervisor no ve el tablero', await falla(() => como(SUP, () => sql(`select public.fact_tablero('2026-10')`))))

// ══ Auditoría: escenarios agregados ══════════════════════════════════════════

// Permisos: no alcanza con ocultar el menú.
const INACT = '00000000-0000-0000-0000-0000000000a6'
await db.exec(`insert into public.usuarios (id, auth_user_id, nombre, rol, estado, puesto_organizacional) values ('${INACT}', '${INACT}', 'ADMIN INACTIVO', 'admin', 'inactivo', 'administracion')`)
ok('administración inactiva no ve ni ejecuta', (await como(INACT, () => sql(`select * from public.fact_comprobantes`))).length === 0
  && await falla(() => como(INACT, () => sql(`select public.fact_tablero('2026-10')`)), /Gerencia o Administración/))
ok('supervisor no puede leer el saldo fiscal por RPC directa', await falla(() => como(SUP, () => sql(`select public.fact_saldo_fiscal($1)`, [fa2047.id])), /permission denied/))
ok('supervisor no ve saldos ni movimientos bancarios', (await como(SUP, () => sql(`select * from public.fact_v_saldos`))).length === 0
  && (await como(SUP, () => sql(`select * from public.fact_movimientos_bancarios`))).length === 0)
ok('supervisor no accede a la serie gerencial', await falla(() => como(SUP, () => sql(`select public.fact_tablero_serie('2026-01', '2026-10')`)), /Gerencia o Administración/))
ok('supervisor no ejecuta funciones internas del tablero', await falla(() => como(SUP, () => sql(`select public.fact_montos_mes('2026-10', null, null)`)), /permission denied/))
ok('Gerencia aplica y revierte como Administración', !!(await como(GER, () => uno(`select public.fact_tablero('2026-10') t`))).t)

// Inmutabilidad fiscal.
ok('los comprobantes no se pueden truncar', await falla(() => sql(`truncate public.fact_comprobantes cascade`), /no se borra/))

// Tarifas: valor anterior, nuevo, fecha, usuario y motivo.
const kTar = await contrato({ cliente_id: aca, nombre: 'ACA', modalidad: 'por_hora', requisitos: ['oc_vigente'] })
await como(ADM, () => sql(`select public.fact_tarifa_agregar($1, null, 'hora', 10000, 'adicional', 21, '2026-01-01', 'Contrato inicial')`, [kTar]))
await como(GER, () => sql(`select public.fact_tarifa_agregar($1, null, 'hora', 11500, 'adicional', 21, '2026-07-01', 'Aumento paritario julio')`, [kTar]))
const hTar = (await uno(`select datos, por from public.fact_historial where entidad = 'contrato' and entidad_id = $1 and accion = 'tarifa' order by id desc limit 1`, [kTar]))
ok('cambio de tarifa guarda anterior, nueva, vigencia, usuario y motivo', hTar.por === GER && Number(hTar.datos.precio) === 11500
  && Number(hTar.datos.anteriores[0].precio) === 10000 && hTar.datos.anteriores[0].hasta === '2026-06-30' && hTar.datos.motivo === 'Aumento paritario julio', JSON.stringify(hTar))
ok('una tarifa sin motivo se rechaza', await falla(() => como(ADM, () => sql(`select public.fact_tarifa_agregar($1, null, 'hora', 1, 'adicional', 21, '2026-09-01', '')`, [kTar])), /motivo/))
ok('la factura emitida conserva su precio aunque luego cambie la tarifa',
  (await uno(`select (lineas->0->>'precio') p from public.fact_prefacturas where id = $1`, [pref])).p === '14853.20')

// Horas: decisión comercial sobre descubiertos, sin tocar lo cubierto.
const OBJ2 = '00000000-0000-0000-0000-00000000b004'
ok('facturar horas descubiertas exige motivo', await falla(() => como(ADM, () => sql(
  `select public.fact_horas_aprobar($1, $2, '2026-10-01', '2026-11-01', '{"programados":720,"cubiertos":480,"descubiertos":240,"aprobados":720,"tratamiento":"facturar"}'::jsonb, '[]'::jsonb, null)`, [OBJ2, kTar]))))
ok('lo aprobado debe ser exactamente lo cubierto (+ descubierto si se decidió facturarlo)', await falla(() => como(ADM, () => sql(
  `select public.fact_horas_aprobar($1, $2, '2026-10-01', '2026-11-01', '{"programados":720,"cubiertos":480,"descubiertos":240,"aprobados":600}'::jsonb, '[]'::jsonb, null)`, [OBJ2, kTar]))))
const hDesc = (await como(ADM, () => uno(
  `select public.fact_horas_aprobar($1, $2, '2026-10-01', '2026-11-01', '{"programados":720,"cubiertos":480,"descubiertos":240,"aprobados":720,"tratamiento":"facturar"}'::jsonb, '[]'::jsonb, 'Cliente aceptó facturar el descubierto del 10/10 (acta)') id`, [OBJ2, kTar]))).id
const hD = await uno(`select minutos_cubiertos, minutos_aprobados, tratamiento_descubiertos from public.fact_horas_aprobaciones where id = $1`, [hDesc])
ok('la decisión queda en la foto: cubiertas 8 h, aprobadas 12 h', hD.minutos_cubiertos === 480 && hD.minutos_aprobados === 720 && hD.tratamiento_descubiertos === 'facturar')

// Reemplazar horas de una prefactura NO emitida la reabre, con rastro.
const prefAca = (await como(ADM, () => uno(`select public.fact_prefactura_guardar(null, $1::jsonb) id`, [JSON.stringify({ cliente_id: aca, contrato_id: kTar,
  agrupacion_clave: 'contrato:aca', periodo_mes: '2026-10', periodo_desde: '2026-10-01', periodo_hasta_excl: '2026-11-01', horas_aprobacion_ids: [hDesc],
  minutos_aprobados: 720, lineas: [], neto_c: 13800000, iva_c: 2898000, total_c: 16698000, cuit_receptor: '30555555551', tipo_comprobante: 1, punto_venta: 1,
  estado: 'lista_revision', requisitos: [] })]))).id
await como(ADM, async () => sql(`select public.fact_prefactura_aprobar($1, (select version from public.fact_prefacturas where id = $1))`, [prefAca]))
await como(ADM, () => sql(`select public.fact_horas_aprobar($1, $2, '2026-10-01', '2026-11-01', '{"programados":720,"cubiertos":720,"descubiertos":0,"aprobados":720}'::jsonb, '[]'::jsonb, null, true)`, [OBJ2, kTar]))
ok('cambiar las horas de una prefactura aprobada la reabre y deja rastro', (await uno(`select estado from public.fact_prefacturas where id = $1`, [prefAca])).estado === 'en_preparacion'
  && !!(await uno(`select 1 x from public.fact_historial where entidad_id = $1 and accion = 'horas_reemplazadas'`, [prefAca])))

// ARCA: concurrencia e idempotencia (nunca una segunda factura por un error de red).
await db.exec(`update public.fact_config set valor = valor || '{"produccion_habilitada": true}' where clave = 'emision'`)
await como(ADM, () => sql(`select public.fact_prefactura_guardar($1, $2::jsonb, (select version from public.fact_prefacturas where id = $1))`, [prefAca, JSON.stringify({ cliente_id: aca, contrato_id: kTar,
  agrupacion_clave: 'contrato:aca', periodo_mes: '2026-10', periodo_desde: '2026-10-01', periodo_hasta_excl: '2026-11-01', minutos_aprobados: 720, lineas: [],
  neto_c: 13800000, iva_c: 2898000, total_c: 16698000, cuit_receptor: '30555555551', tipo_comprobante: 1, punto_venta: 1, estado: 'lista_revision', requisitos: [] })]))
await como(ADM, async () => sql(`select public.fact_prefactura_aprobar($1, (select version from public.fact_prefacturas where id = $1))`, [prefAca]))
const eA = (await como(ADM, async () => uno(`select public.fact_emision_preparar($1, (select version from public.fact_prefacturas where id = $1), 'produccion') r`, [prefAca]))).r
await servidor(() => sql(`select public.fact_emision_iniciar_envio($1, 3000, '{}'::jsonb)`, [eA.id]))
ok('un segundo envío simultáneo se rechaza (fila bloqueada / estado enviando)', await falla(() => servidor(() => sql(`select public.fact_emision_iniciar_envio($1, 3001, '{}'::jsonb)`, [eA.id])), /enviando/))
ok('mientras hay un envío en curso no se consulta ni se marca "no existe"', await falla(() => servidor(() => sql(`select public.fact_emision_consulta($1, false, '{}'::jsonb)`, [eA.id])), /en curso/))
// ARCA rechaza (R): el número queda registrado como intentado.
await servidor(() => sql(`select public.fact_emision_resultado($1, 'R', '{"Resultado":"R"}'::jsonb, null, null, null, 'Error 10016')`, [eA.id]))
ok('el rechazo conserva el número intentado para verificarlo antes de reintentar', (await uno(`select numeros_intentados from public.fact_emisiones where id = $1`, [eA.id])).numeros_intentados.map(Number).includes(3000))
// …pero si la consulta muestra que ese número SÍ quedó autorizado, se registra ése (no se emite otro).
await servidor(() => sql(`select public.fact_emision_consulta($1, true, '{"ResultGet":{}}'::jsonb, '76999', '2026-11-13', '2026-11-03', 16698000, 3000)`, [eA.id]))
const recup = await uno(`select (select count(*)::int from public.fact_comprobantes where prefactura_id = $1 and ambiente = 'produccion') n,
  (select estado from public.fact_prefacturas where id = $1) pe, (select numero::int from public.fact_comprobantes where prefactura_id = $1) num`, [prefAca])
ok('recuperación: el número intentado autorizado queda como la única factura', recup.n === 1 && recup.pe === 'emitida' && recup.num === 3000, JSON.stringify(recup))
ok('ya autorizada, no se puede preparar otra emisión', await falla(() => como(ADM, async () => sql(`select public.fact_emision_preparar($1, (select version from public.fact_prefacturas where id = $1), 'produccion')`, [prefAca]))))
ok('una consulta con otro importe no autoriza nada', await (async () => {
  const p2 = (await como(ADM, () => uno(`select public.fact_prefactura_guardar(null, $1::jsonb) id`, [JSON.stringify({ cliente_id: aca, contrato_id: kTar,
    agrupacion_clave: 'contrato:aca2', periodo_mes: '2026-10', periodo_desde: '2026-10-01', periodo_hasta_excl: '2026-11-01', lineas: [], neto_c: 100, iva_c: 21, total_c: 121,
    cuit_receptor: '30555555551', tipo_comprobante: 1, punto_venta: 1, estado: 'lista_revision', requisitos: [] })]))).id
  await como(ADM, async () => sql(`select public.fact_prefactura_aprobar($1, (select version from public.fact_prefacturas where id = $1))`, [p2]))
  const e = (await como(ADM, async () => uno(`select public.fact_emision_preparar($1, (select version from public.fact_prefacturas where id = $1), 'produccion') r`, [p2]))).r
  await servidor(() => sql(`select public.fact_emision_iniciar_envio($1, 3001, '{}'::jsonb)`, [e.id]))
  await servidor(() => sql(`select public.fact_emision_resultado($1, 'incierta', '{}'::jsonb)`, [e.id]))
  await servidor(() => sql(`select public.fact_emision_consulta($1, true, '{}'::jsonb, '7', '2026-11-13', '2026-11-03', 999, 3001)`, [e.id]))
  const x = await uno(`select estado, observaciones from public.fact_emisiones where id = $1`, [e.id])
  return x.estado === 'incierta' && /otros datos/.test(x.observaciones) && !(await uno(`select 1 x from public.fact_comprobantes where prefactura_id = $1`, [p2]))
})())

// Cuentas corrientes: $9.500.000 de banco + $500.000 de retención cancelan $10.000.000; el banco sigue en $9.500.000.
const cli10 = await cliente(ADM, { razon_social: 'CLIENTE DIEZ MILLONES', cuit: '30712345671' })
await db.exec(`insert into public.fact_comprobantes (ambiente, cuit_emisor, tipo, punto_venta, numero, fecha_emision, cliente_id, total_c, neto_c, iva_c, origen)
  values ('produccion', '30710705417', 1, 1, 5000, '2026-10-05', '${cli10}', 1000000000, 826446281, 173553719, 'carga_manual')`)
const f10 = (await uno(`select id from public.fact_comprobantes where numero = 5000`)).id
const c95 = (await como(ADM, () => uno(`select public.fact_cobro_registrar($1::jsonb) id`, [JSON.stringify({ cliente_id: cli10, fecha: '2026-10-20', importe_c: 950000000, medio: 'transferencia' })]))).id
const r05 = (await como(ADM, () => uno(`select public.fact_retencion_registrar($1::jsonb) id`, [JSON.stringify({ cliente_id: cli10, fecha: '2026-10-20', importe_c: 50000000, impuesto: 'ganancias', certificado: 'G-1', estado: 'certificado_recibido' })]))).id
await como(ADM, () => sql(`select public.fact_aplicar('cobro', $1, $2, null, 950000000)`, [c95, f10]))
await como(ADM, () => sql(`select public.fact_aplicar('retencion', $1, $2, null, 50000000)`, [r05, f10]))
const t10 = (await como(ADM, () => uno(`select public.fact_tablero('2026-10', '2026-11-03', $1) t`, [cli10]))).t
ok('$9,5 M banco + $0,5 M retención cancelan $10 M; el cobrado bancario sigue siendo $9,5 M', await saldo(f10) === 0
  && t10.cobro.cobrado_c === 950000000 && t10.cobro.retenciones_certificadas_c === 50000000, JSON.stringify(t10.cobro))

// Bancos: Galicia y Municipal no se mezclan; la misma línea en dos cuentas son dos movimientos.
const linea = [{ fecha: '2026-10-21', importe_c: 100000, concepto: 'DEPOSITO', hash: 'igual', clasificacion: 'cobranza_posible' }]
await como(ADM, () => sql(`select public.fact_extracto_importar($1, 'mun.csv', $2, null, $3::jsonb)`, [CTA_MUN, 'e'.repeat(64), JSON.stringify(linea)]))
await como(ADM, () => sql(`select public.fact_extracto_importar($1, 'gal.csv', $2, null, $3::jsonb)`, [CTA_GAL, 'f'.repeat(64), JSON.stringify(linea)]))
const porCuenta = await sql(`select cuenta_id, count(*)::int n from public.fact_movimientos_bancarios where hash_linea = 'igual' group by cuenta_id`)
ok('cada movimiento pertenece a una sola cuenta', porCuenta.length === 2 && porCuenta.every(x => x.n === 1))
ok('no se importa a una cuenta inexistente', await falla(() => como(ADM, () => sql(`select public.fact_extracto_importar(gen_random_uuid(), 'x.csv', $1, null, '[]'::jsonb)`, ['9'.repeat(64)])), /inexistente/))

// Serie gerencial: evolución mensual y comparación interanual.
const serie = (await como(GER, () => uno(`select public.fact_tablero_serie('2025-10', '2026-10') s`))).s
const oct26 = serie.find(x => x.mes === '2026-10'), oct25 = serie.find(x => x.mes === '2025-10'), ago26 = serie.find(x => x.mes === '2026-08')
ok('serie de 13 meses con prestación, emisión y cobro separados', serie.length === 13 && Number(ago26.horas.facturadas) === 544
  && oct26.montos.cobrado_c > 0 && oct25.montos.cobrado_c === 0, JSON.stringify([ago26.horas, oct26.montos.cobrado_c, oct25.montos]))
ok('la serie rechaza rangos excesivos', await falla(() => como(GER, () => sql(`select public.fact_tablero_serie('2020-01', '2026-10')`)), /Rango/))

// ── Rollback ───────────────────────────────────────────────────────────────
for (const m of [...MIGS].reverse()) await db.exec(readFileSync(`${REPO}/supabase/rollback/${m}_rollback.sql`, 'utf8'))
ok('rollback completo deja el esquema sin tablas de facturación', (await uno(`select count(*)::int n from pg_tables where schemaname = 'public' and tablename like 'fact_%'`)).n === 0)
ok('…ni funciones', (await uno(`select count(*)::int n from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and (p.proname like 'fact_%' or p.proname like 'facturacion_%')`)).n === 0)

for (const r of resultados) console.log(r.join(' | '))
const fallas = resultados.filter(r => r[0] === 'FALLA').length
console.log(`\nRESULTADO: ${resultados.length - fallas}/${resultados.length} OK`)
process.exit(fallas ? 1 : 0)
