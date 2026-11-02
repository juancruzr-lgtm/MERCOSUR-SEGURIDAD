// Pruebas de 20261121130000_whatsapp_envios_reclamo_reintentos.sql sobre PGlite.
// Esqueleto: escalamiento_whatsapp_envios con las columnas y el CHECK de nivel
// de producción (leídos el 02/11/2026) y ronda_alertas mínima.
// PGlite tiene una sola conexión: la "concurrencia" de dos crons se prueba como
// carrera intercalada (las dos leen antes de reclamar) y, para el índice único,
// con un insert directo del mismo (clave, intento).
// Uso: npm i --no-save @electric-sql/pglite@0.2.17 && node supabase/pruebas/whatsapp-envios/run.mjs
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const REPO = process.argv[2] ?? fileURLToPath(new URL('../../..', import.meta.url))
const db = new PGlite()
process.on('unhandledRejection', e => { console.error('ERROR:', e.message, e.where ?? ''); process.exit(2) })
const resultados = []
const ok = (nombre, cond, extra = '') => { resultados.push([cond ? 'OK ' : 'FALLA', nombre, extra]) }
const sql = async (t, p) => (await db.query(t, p)).rows

await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create table public.usuarios (id uuid primary key default gen_random_uuid(), nombre text);
create table public.ronda_alertas (id uuid primary key default gen_random_uuid(), estado text not null default 'pendiente',
  accion text, resultado_intervencion text, detectada_at timestamptz default now());
create table public.escalamiento_whatsapp_envios (
  id uuid primary key default gen_random_uuid(), turno_id uuid, objetivo_id uuid, puesto_id uuid, guardia_id uuid,
  nivel text not null, destinatario_id uuid references public.usuarios(id), telefono text, plantilla text,
  turno_inicio timestamptz, detectado_at timestamptz default now(), minutos_descubierto integer, resultado text not null,
  id_proveedor text, proveedor text, error text, created_at timestamptz not null default now(),
  ronda_alerta_id uuid references public.ronda_alertas(id) on delete set null,
  constraint escalamiento_envios_nivel_check check (nivel = any (array['escalamiento_wa_15','escalamiento_wa_30','escalamiento_wa_ronda_no_iniciada','wa_ronda_pendiente_vigilador'])));
`)
// Historial previo (sin clave): no debe molestar.
const [jl] = await sql(`insert into usuarios(nombre) values ('JL') returning id`)
const [ar] = await sql(`insert into usuarios(nombre) values ('AR') returning id`)
const [sm] = await sql(`insert into usuarios(nombre) values ('SM') returning id`)
await sql(`insert into escalamiento_whatsapp_envios(nivel, resultado, destinatario_id) values ('escalamiento_wa_ronda_no_iniciada','enviado',$1)`, [jl.id])

const mig = readFileSync(`${REPO}/supabase/migrations/20261121130000_whatsapp_envios_reclamo_reintentos.sql`, 'utf8')
await db.exec(mig)
await db.exec(mig) // idempotente
ok('Migración idempotente (se aplica dos veces)', true)

const NIVEL = 'escalamiento_wa_ronda_no_iniciada'
const T0 = '2026-11-02T10:00:00-03:00'
const mas = (min) => new Date(Date.parse(T0) + min * 60000).toISOString()
const clave = (alerta, dest) => `wa|${NIVEL}|ronda_alerta:${alerta}|${dest}`
async function reclamar(cl, fila, o = {}) {
  const r = await sql(`select public.reclamar_envio_whatsapp($1, $2::jsonb, $3, $4, $5, $6, $7) as r`,
    [cl, JSON.stringify(fila), o.max ?? 3, o.backoff ?? 10, o.topeDest ?? null, o.topeEvento ?? null, o.ahora ?? T0])
  return r[0].r
}
const completar = async (id, okEnvio, reint = false, ahora = T0, err = null) =>
  (await sql(`select public.completar_envio_whatsapp($1, $2, $3, $4, $5, $6) as r`, [id, okEnvio, okEnvio ? 'wamid.x' : null, err, reint, ahora]))[0].r
const nuevaAlerta = async (campos = {}) => (await sql(
  `insert into ronda_alertas(estado, accion, resultado_intervencion) values ($1,$2,$3) returning id`,
  [campos.estado ?? 'pendiente', campos.accion ?? null, campos.resultado ?? null]))[0].id

// ── 1. Dos crons simultáneos sobre la misma alerta ──────────────────────────
{
  const a = await nuevaAlerta()
  const fila = { nivel: NIVEL, destinatario_id: jl.id, ronda_alerta_id: a }
  // Las dos corridas leyeron "no avisada" (dedup previa vacía) y llegan a reclamar.
  const r1 = await reclamar(clave(a, jl.id), fila)
  const r2 = await reclamar(clave(a, jl.id), fila)
  ok('Concurrencia: la primera corrida reclama', r1.ok === true && r1.intento === 1)
  ok('Concurrencia: la segunda corrida NO reclama (en curso)', r2.ok === false && r2.motivo === 'en_curso_o_incierto', JSON.stringify(r2))
  const n = (await sql(`select count(*)::int n from escalamiento_whatsapp_envios where clave_envio = $1`, [clave(a, jl.id)]))[0].n
  ok('Concurrencia: una sola fila por clave', n === 1, `n=${n}`)
  // Carrera en el índice: un insert del mismo (clave, intento) choca.
  let choca = false
  try {
    await sql(`insert into escalamiento_whatsapp_envios(nivel, resultado, clave_envio, intento) values ($1,'reclamado',$2,1)`, [NIVEL, clave(a, jl.id)])
  } catch (e) { choca = /unique|duplicate/i.test(e.message) }
  ok('Concurrencia: el índice único rechaza el mismo (clave, intento)', choca)
  // Completada como enviada → nunca más.
  ok('Completar: enviado', await completar(r1.id, true) === true)
  ok('Completar es idempotente (segunda vez no cambia nada)', await completar(r1.id, false) === false)
  const r3 = await reclamar(clave(a, jl.id), fila, { ahora: mas(600) })
  ok('Duplicado: ya enviado no vuelve a salir (ni 10 h después)', r3.ok === false && r3.motivo === 'ya_enviado')
  // El mismo hecho a OTRO destinatario es otra clave (dos supervisores de guardia).
  const r4 = await reclamar(clave(a, ar.id), { ...fila, destinatario_id: ar.id })
  ok('Otro destinatario de guardia: clave propia', r4.ok === true)
}

// ── 2. Reintento después de un fallo (backoff y máximo) ─────────────────────
{
  const a = await nuevaAlerta()
  const fila = { nivel: NIVEL, destinatario_id: sm.id, ronda_alerta_id: a }
  const cl = clave(a, sm.id)
  const r1 = await reclamar(cl, fila)
  await completar(r1.id, false, true, T0, 'HTTP 503')
  const r2 = await reclamar(cl, fila, { ahora: mas(5) })
  ok('Reintento: antes del backoff (10\') espera', r2.ok === false && r2.motivo === 'esperando_reintento', JSON.stringify(r2))
  const r3 = await reclamar(cl, fila, { ahora: mas(10) })
  ok('Reintento: pasado el backoff reclama el intento 2', r3.ok === true && r3.intento === 2, JSON.stringify(r3))
  await completar(r3.id, false, true, mas(10), 'HTTP 503')
  const r4 = await reclamar(cl, fila, { ahora: mas(25) })
  ok('Reintento: backoff exponencial (20\' después del 2.º fallo)', r4.ok === false && r4.motivo === 'esperando_reintento')
  const r5 = await reclamar(cl, fila, { ahora: mas(30) })
  ok('Reintento: intento 3 a los 20\'', r5.ok === true && r5.intento === 3)
  await completar(r5.id, false, true, mas(30), 'HTTP 503')
  const r6 = await reclamar(cl, fila, { ahora: mas(600) })
  ok('Reintento: máximo de 3 intentos → agotado', r6.ok === false && r6.motivo === 'agotado')

  const b = await nuevaAlerta()
  const clb = clave(b, sm.id)
  const s1 = await reclamar(clb, { ...fila, ronda_alerta_id: b })
  await completar(s1.id, false, false, T0, 'número no registrado en WhatsApp')
  const s2 = await reclamar(clb, { ...fila, ronda_alerta_id: b }, { ahora: mas(600) })
  ok('Fallo NO reintentable → fallo_definitivo', s2.ok === false && s2.motivo === 'fallo_definitivo')

  const c = await nuevaAlerta()
  const clc = clave(c, sm.id)
  await reclamar(clc, { ...fila, ronda_alerta_id: c })
  const c2 = await reclamar(clc, { ...fila, ronda_alerta_id: c }, { ahora: mas(600) })
  ok('Corrida cortada a mitad (fila reclamado sin resultado) → no se reintenta', c2.ok === false && c2.motivo === 'en_curso_o_incierto')
}

// ── 3. Supervisor sin guardia asignada / sin destinatario ───────────────────
{
  const a = await nuevaAlerta()
  const r = await reclamar(`wa|${NIVEL}|ronda_alerta:${a}|-`, { nivel: NIVEL, ronda_alerta_id: a })
  ok('Sin destinatario: no se reclama ni se envía', r.ok === false && r.motivo === 'sin_destinatario')
  const n = (await sql(`select count(*)::int n from escalamiento_whatsapp_envios where ronda_alerta_id = $1`, [a]))[0].n
  ok('Sin destinatario: no deja fila reclamada', n === 0)
  const r2 = await reclamar('', { nivel: NIVEL, destinatario_id: jl.id })
  ok('Sin clave: rechazado', r2.ok === false && r2.motivo === 'sin_clave')
}

// ── 4. Fuera de límites ──────────────────────────────────────────────────────
{
  const [u] = await sql(`insert into usuarios(nombre) values ('TOPE') returning id`)
  const res = []
  for (let i = 0; i < 4; i++) {
    const a = await nuevaAlerta()
    const r = await reclamar(clave(a, u.id), { nivel: NIVEL, destinatario_id: u.id, ronda_alerta_id: a }, { topeDest: 3, ahora: mas(i) })
    if (r.ok) await completar(r.id, true, false, mas(i))
    res.push(r)
  }
  ok('Tope por destinatario y día: 3 salen, el 4.º no', res.slice(0, 3).every(r => r.ok) && res[3].motivo === 'tope_destinatario', JSON.stringify(res[3]))
  const a = await nuevaAlerta()
  const r = await reclamar(clave(a, u.id), { nivel: NIVEL, destinatario_id: u.id, ronda_alerta_id: a }, { topeDest: 3, ahora: '2026-11-03T00:05:00-03:00' })
  ok('Tope diario: al día siguiente (hora AR) vuelve a habilitar', r.ok === true)
  // Los envíos de otro nivel no cuentan para el tope de rondas.
  const e = await nuevaAlerta()
  const [u2] = await sql(`insert into usuarios(nombre) values ('EVT') returning id`)
  const [u3] = await sql(`insert into usuarios(nombre) values ('EVT2') returning id`)
  const e1 = await reclamar(clave(e, jl.id), { nivel: NIVEL, destinatario_id: jl.id, ronda_alerta_id: e }, { topeEvento: 2 })
  const e2 = await reclamar(clave(e, u2.id), { nivel: NIVEL, destinatario_id: u2.id, ronda_alerta_id: e }, { topeEvento: 2 })
  const e3 = await reclamar(clave(e, u3.id), { nivel: NIVEL, destinatario_id: u3.id, ronda_alerta_id: e }, { topeEvento: 2 })
  ok('Tope por evento: 2 destinatarios, el 3.º no', e1.ok && e2.ok && e3.motivo === 'tope_evento')
}

// ── 5. Supervisor que interviene: no recibe un aviso nuevo ──────────────────
{
  const a = await nuevaAlerta()
  // La corrida leyó la alerta pendiente; entre la lectura y el envío, el
  // supervisor intervino.
  await sql(`update ronda_alertas set accion = 'llamada_vigilador' where id = $1`, [a])
  const r = await reclamar(clave(a, jl.id), { nivel: NIVEL, destinatario_id: jl.id, ronda_alerta_id: a })
  ok('Intervenida (acción) entre lectura y envío → no se envía', r.ok === false && r.motivo === 'intervenida')
  const b = await nuevaAlerta({ resultado: 'seguimiento' })
  const r2 = await reclamar(clave(b, jl.id), { nivel: NIVEL, destinatario_id: jl.id, ronda_alerta_id: b })
  ok('Intervenida (resultado seguimiento) → no se envía', r2.ok === false && r2.motivo === 'intervenida')
  const c = await nuevaAlerta({ estado: 'resuelta' })
  const r3 = await reclamar(clave(c, jl.id), { nivel: NIVEL, destinatario_id: jl.id, ronda_alerta_id: c })
  ok('Alerta cerrada → no se envía', r3.ok === false && r3.motivo === 'cerrada')
}

// ── Permisos y rollback ──────────────────────────────────────────────────────
{
  const p = await sql(`select has_function_privilege('authenticated', 'public.reclamar_envio_whatsapp(text,jsonb,integer,integer,integer,integer,timestamptz)', 'execute') a,
    has_function_privilege('anon', 'public.completar_envio_whatsapp(uuid,boolean,text,text,boolean,timestamptz)', 'execute') b,
    has_function_privilege('service_role', 'public.reclamar_envio_whatsapp(text,jsonb,integer,integer,integer,integer,timestamptz)', 'execute') c`)
  ok('Permisos: authenticated/anon no ejecutan; service_role sí', !p[0].a && !p[0].b && p[0].c)
  const antes = (await sql(`select count(*)::int n from escalamiento_whatsapp_envios`))[0].n
  await db.exec(readFileSync(`${REPO}/supabase/rollback/20261121130000_whatsapp_envios_reclamo_reintentos_rollback.sql`, 'utf8'))
  const despues = (await sql(`select count(*)::int n from escalamiento_whatsapp_envios`))[0].n
  const f = (await sql(`select count(*)::int n from pg_proc where proname in ('reclamar_envio_whatsapp','completar_envio_whatsapp')`))[0].n
  ok('Rollback: quita funciones, conserva la auditoría', f === 0 && antes === despues, `${antes}/${despues}`)
}

for (const [e, n, x] of resultados) console.log(e, n, x)
const fallas = resultados.filter(r => r[0] !== 'OK ').length
console.log(`\n${resultados.length - fallas}/${resultados.length} controles OK`)
process.exit(fallas ? 1 : 0)
