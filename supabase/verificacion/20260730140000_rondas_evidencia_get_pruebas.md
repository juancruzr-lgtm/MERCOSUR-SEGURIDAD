# VERIFICACIÓN — Etapa 3.3 · B2: `GET /api/rondas/evidencia`

Acompaña a `app/api/rondas/evidencia/route.ts` (handler **GET** agregado; el POST de
subida del vigilador no se modificó).

El endpoint recibe **solo** `?evidencia_id=<uuid>` y devuelve una URL firmada de
**corta duración (60 s)** para visualizar la foto de un punto de ronda. Autoriza a
**admin** o **supervisor con alcance sobre el objetivo** de la ejecución, validando
la cadena `evidencia → punto de ejecución → ejecución → objetivo`. El `storage_path`
se lee de la base, nunca del cliente.

Respuestas (campo `contexto`): `ok` · `sin_usuario` · `parametro_invalido` ·
`evidencia_no_encontrada` · `sin_permiso` · `error_firma`.

No muestres tokens ni la URL firmada en registros compartidos.

---

## 0) Material de prueba (SQL, solo lectura)

```sql
-- Una evidencia de ronda real, su objetivo y un supervisor autorizado por zona.
select
  ev.id                              as evidencia_id,
  ev.tipo_evidencia,
  e.objetivo_id,
  o.nombre                           as objetivo,
  (select u.auth_user_id from public.supervisor_zonas sz
     join public.usuarios u on u.id = sz.supervisor_id
    where sz.zona_id = o.zona_id and u.rol = 'supervisor'
      and u.auth_user_id is not null and u.estado = 'activo'
    limit 1)                         as supervisor_autorizado_auth_id
from public.evidencias ev
join public.ronda_ejecucion_puntos ep on ep.id = ev.proceso_id
join public.ronda_ejecuciones      e  on e.id  = ep.ronda_ejecucion_id
join public.objetivos              o  on o.id  = e.objetivo_id
where ev.proceso_tipo = 'ronda'
  and ev.tipo_evidencia = 'punto_control'
  and ev.bucket = 'ronda-evidencias'
order by ev.created_at desc
limit 10;
```

Necesitás además un **access token** (JWT) de una sesión real:
- de un **supervisor autorizado** para ese objetivo;
- de un **supervisor de otra zona** (para el caso `sin_permiso`);
- opcional: de un **admin**.

Base URL: `http://localhost:3000` (dev) o el dominio de Vercel.

---

## 1) CASO OK — supervisor autorizado
```bash
curl -s -H "Authorization: Bearer <TOKEN_SUPERVISOR_AUTORIZADO>" \
  "$BASE/api/rondas/evidencia?evidencia_id=<EVIDENCIA_ID>"
```
Esperado: **200** · `{"contexto":"ok","url":"https://…","expira_en_s":60}`
Verificá que la `url` abre la imagen y **caduca** pasados ~60 s.

## 2) CASO SIN_USUARIO — sin token
```bash
curl -s "$BASE/api/rondas/evidencia?evidencia_id=<EVIDENCIA_ID>"
```
Esperado: **401** · `{"contexto":"sin_usuario"}`

## 3) CASO PARAMETRO_INVALIDO — sin id o id no-UUID
```bash
curl -s -H "Authorization: Bearer <TOKEN_SUPERVISOR_AUTORIZADO>" \
  "$BASE/api/rondas/evidencia?evidencia_id=no-es-uuid"
```
Esperado: **400** · `{"contexto":"parametro_invalido"}`

## 4) CASO EVIDENCIA_NO_ENCONTRADA — id inexistente
```bash
curl -s -H "Authorization: Bearer <TOKEN_SUPERVISOR_AUTORIZADO>" \
  "$BASE/api/rondas/evidencia?evidencia_id=00000000-0000-0000-0000-000000000000"
```
Esperado: **404** · `{"contexto":"evidencia_no_encontrada"}`
(Mismo resultado si el `evidencia_id` apunta a otro `proceso_tipo`/`tipo_evidencia`:
no se revela que existe para otro proceso.)

## 5) CASO SIN_PERMISO — supervisor de otra zona
```bash
curl -s -H "Authorization: Bearer <TOKEN_SUPERVISOR_OTRA_ZONA>" \
  "$BASE/api/rondas/evidencia?evidencia_id=<EVIDENCIA_ID>"
```
Esperado: **403** · `{"contexto":"sin_permiso"}`
(También un vigilador/guardia recibe `sin_permiso`: esta vía es solo admin/supervisor.)

## 6) CASO ADMIN — acceso total (opcional)
```bash
curl -s -H "Authorization: Bearer <TOKEN_ADMIN>" \
  "$BASE/api/rondas/evidencia?evidencia_id=<EVIDENCIA_ID>"
```
Esperado: **200** · `{"contexto":"ok",...}` para cualquier objetivo.

---

## Checklist de aceptación
- [ ] `ok` devuelve URL firmada que abre la imagen y caduca ~60 s.
- [ ] `evidencia_id` es la **única** entrada; no se acepta `storage_path` del cliente.
- [ ] Supervisor de otra zona → `sin_permiso` (no firma).
- [ ] Vigilador/guardia → `sin_permiso`.
- [ ] Sin token → `sin_usuario`.
- [ ] Id inválido → `parametro_invalido`; inexistente/otro proceso → `evidencia_no_encontrada`.
- [ ] El bucket `ronda-evidencias` sigue **privado** (sin URL firmada no hay acceso).
- [ ] No se tocaron políticas de Storage ni RLS.
```
