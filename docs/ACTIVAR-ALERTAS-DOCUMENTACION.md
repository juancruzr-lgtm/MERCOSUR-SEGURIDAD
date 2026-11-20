# Activar las alertas de vencimiento de la documentación del legajo

Guía para Gerencia. Hoy (04/11/2026) las alertas están **apagadas** y el
proceso diario **no está programado**. Nada de esto manda push, WhatsApp ni
mails: las alertas se **registran** y, si Gerencia lo elige, aparecen como un
cartel en la app de la persona.

## Qué se controla

| Qué | De dónde sale | Cuándo alerta |
|---|---|---|
| **Credencial de vigilador** | `habilitacion_credenciales`: la última credencial no anulada de cada persona activa (aunque sea "informada" sin foto) | vencida, o vence dentro de los días elegidos |
| **Antecedentes RNR** (vigencia 6 meses) y cualquier otro tipo con vencimiento | documento aprobado/aceptado con `vence_el` | vencido, o vence dentro de los días elegidos |
| Credencial con foto **sin** credencial registrada | el documento | igual que arriba |
| **Solicitados** | Administración marcó "solicitado" y la persona no lo subió | una vez por mes |
| **Faltantes obligatorios** (opcional) | sólo vigiladores; no cuenta lo marcado "no corresponde" ni tipos reservados a Gerencia | una vez por mes |

Hoy sólo tienen vencimiento la **credencial** (declarado) y los **antecedentes
RNR** (calculado: emisión + 6 meses). Los demás tipos no vencen.

No entran: personas inactivas o de prueba, documentos rechazados, anulados o
reemplazados.

**Cuándo una alerta deja de mostrarse:** cuando se sube y aprueba el documento
nuevo (el viejo pasa a "reemplazado"), cuando se registra una credencial más
nueva, cuando se carga lo solicitado o faltante, cuando se marca "no
corresponde", o cuando la persona toca **Entendido**. Las alertas no se borran
nunca (quedan como historia); un "por vencer" que ya venció se reemplaza por
el "vencido".

**Quién ve qué:**

- **Gerencia:** todo, y es la única que prende o apaga.
- **Administración:** el reporte de vencimientos y las alertas, salvo los
  tipos reservados a Gerencia.
- **El vigilador:** sólo sus propias alertas, y sólo si Gerencia prendió
  "Mostrar el aviso a la persona".
- **Supervisores:** nada.

La fecha de "hoy" es siempre la de **Argentina**.

### Qué va a pasar el primer día (foto del 04/11/2026)

Con 30 días de anticipación:

- **17 credenciales vencidas**: 11 de ellas son informadas, sin foto. Ninguna
  vence en los próximos 30 días; con 60 días aparece 1 más.
- **0 otros documentos.**
- **0 solicitados.**

Si además se prenden los **faltantes**, se suman **551 alertas para 58
vigiladores** (unas 9,5 por persona): CODEM, DNI, domicilio, alta ARCA,
estudios médicos, RNR, antecedentes provinciales, acta de credencial, CUIL y
30 de credencial. Por eso se recomienda dejar los faltantes apagados al
principio.

## Requisito previo

Tienen que estar aplicados en Supabase:

1. `supabase/migrations/20261009170000_documentacion_alertas.sql`. Ya está en
   producción.
2. `supabase/migrations/20261205140000_documentacion_alertas_listas.sql`, que
   corrige la hora de Argentina, la resolución de alertas, las credenciales y
   los permisos.
   - Después de aplicarla, correr
     `supabase/pruebas/documentacion-alertas/verificacion-20261205140000.sql`.
   - Todas las filas tienen que decir `ok = true`.

Y desplegada la versión de la app que incluye este PR. La ruta
`/api/cron/documentacion-alertas` ya está desplegada.

## Paso 1: prender el interruptor desde la app

1. Entrar con un usuario de **Gerencia** (puesto Gerencia o delegación).
2. Ir a **Legajo Digital → Documentación → Vencimientos**.
3. En la tarjeta **"Alertas automáticas (Gerencia)"**, tildar **Alertas
   prendidas**.

## Paso 2: elegir los días y los destinatarios

En la misma tarjeta:

- **Avisar con N días de anticipación**: de 1 a 180. El valor por defecto es
  30.
  - El tablero de habilitaciones usa 60 días para "por vencer".
  - Para la credencial conviene 60, porque el trámite de renovación lleva
    tiempo.
- **Mostrar el aviso a la persona en su app**:
  - Si está prendido, el vigilador ve un cartel en la pantalla principal.
    No le impide fichar.
  - Si está apagado, sólo Administración y Gerencia ven las alertas.
  - Recomendación: empezar **apagado** una semana, revisar lo que se registra
    y después prenderlo.
- **Incluir documentos obligatorios que faltan**: recomendado **apagado** al
  principio. Ver los números de arriba.

Tocar **Guardar**. Cada cambio queda en `documentacion_alertas_config_historial`.

## Paso 3: programar el proceso diario (cron)

Lo hace quien tenga acceso al editor SQL de Supabase. Copiar y correr
**completo** el archivo
`supabase/cron/20261009170000_documentacion_alertas_cron.sql`.

- Corre todos los días a las **11:00 UTC = 08:00 de Argentina**.
- Llama a `https://mercosur-seguridad.vercel.app/api/cron/documentacion-alertas`
  con la llave `push_cron_secret` del vault, la misma que el resto de los
  crons.
- La ruta acepta `push_cron_secret` o `CRON_SECRET`. Sin llave responde 401.
- Si el interruptor está apagado, la ruta no hace nada aunque el cron corra.

Para no esperar a las 08:00, se puede disparar una vez a mano en el editor:

```sql
select net.http_get(
  url := 'https://mercosur-seguridad.vercel.app/api/cron/documentacion-alertas',
  headers := jsonb_build_object('Authorization', 'Bearer ' ||
    (select decrypted_secret from vault.decrypted_secrets where name = 'push_cron_secret')),
  timeout_milliseconds := 25000);
```

Correr la generación dos veces no duplica: cada alerta tiene una clave única.

## Paso 4: comprobar (consultas de sólo lectura)

Todas las comprobaciones van en una sola sentencia, porque el editor muestra
sólo el último `select`:

```sql
select 'config' k, format('activo=%s dias=%s persona=%s faltantes=%s', activo, dias_aviso, avisar_persona, incluir_faltantes) v
  from public.documentacion_alertas_config where id = 1
union all
select 'cron', coalesce((select schedule || ' activo=' || active from cron.job where jobname = 'documentacion-alertas'), 'NO programado')
union all
select 'ultimas corridas', coalesce((select string_agg(status || ' ' || to_char(start_time at time zone 'America/Argentina/Buenos_Aires', 'DD/MM HH24:MI'), ', ')
  from (select d.status, d.start_time from cron.job_run_details d join cron.job j on j.jobid = d.jobid
        where j.jobname = 'documentacion-alertas' order by d.start_time desc limit 5) x), 'sin corridas')
union all
select 'respuesta http', coalesce((select status_code || ' ' || left(content, 200) from net._http_response
  where content like '%"activo"%' order by created desc limit 1), 'sin respuesta')
union all
select 'alertas por motivo', coalesce((select string_agg(motivo || '=' || n, ', ') from
  (select motivo, count(*) n from public.documentacion_alertas group by motivo) x), 'ninguna')
union all
select 'alertas de hoy (AR)', (select count(*)::text from public.documentacion_alertas
  where (creada_at at time zone 'America/Argentina/Buenos_Aires')::date = (now() at time zone 'America/Argentina/Buenos_Aires')::date)
union all
select 'claves repetidas (debe ser 0)', (select count(*)::text from
  (select clave from public.documentacion_alertas group by clave having count(*) > 1) x);
```

La respuesta HTTP esperada con el interruptor prendido tiene este formato:

```
{"activo":true,"hoy":"…","nuevas":N,"vencimientos":…,"credenciales":…,"solicitados":…,"faltantes":…}
```

Con el interruptor apagado, la respuesta es `{"activo":false,"nuevas":0}`.

En la app, en **Documentación → Vencimientos**, aparece la línea
**"Alertas vigentes: N (…)"**. Las credenciales informadas se marcan
**"informada, sin verificar"**.

## Paso 5: apagar

- **Apagado normal, desde la app:** Gerencia destilda **Alertas prendidas** y
  toca **Guardar**.
  - El proceso diario sigue corriendo pero no registra nada.
  - Las personas dejan de ver el cartel en el momento.
- **Quitar también el cron**, en el editor:

  ```sql
  select cron.unschedule('documentacion-alertas');
  ```

- **Volver atrás la migración 20261205140000:** usar
  `supabase/rollback/20261205140000_documentacion_alertas_listas_rollback.sql`.
  - Conviene apagar el interruptor antes.
  - Las alertas registradas no se borran.
