# Pruebas — reclamo atómico de WhatsApp (20261121130000)

Corre la migración sobre PGlite con `escalamiento_whatsapp_envios` (columnas y
CHECK de nivel de producción, 02/11/2026) y una `ronda_alertas` mínima.

27 controles: migración idempotente; dos crons sobre la misma alerta (la
segunda corrida no reclama; el índice único rechaza el mismo (clave, intento));
duplicado después de enviado; otro supervisor de guardia con clave propia;
reintento con backoff exponencial y máximo de 3; fallo no reintentable;
corrida cortada a mitad (no se reintenta); sin destinatario; topes por
destinatario/día (con corte en hora argentina) y por evento; supervisor que
intervino entre la lectura y el envío; alerta cerrada; permisos (sólo
service_role); rollback que conserva la auditoría.

PGlite tiene una sola conexión: la concurrencia se prueba como carrera
intercalada (las dos corridas ya leyeron "no avisada" y llegan a reclamar). En
Postgres real, además, el advisory lock por destinatario y por clave serializa
las dos transacciones y el índice único es la última barrera.

```
npm i --no-save @electric-sql/pglite@0.2.17
node supabase/pruebas/whatsapp-envios/run.mjs
```
