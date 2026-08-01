# Etapas futuras — documentación de diseño

Estado: **no implementado**. Este documento define el alcance para etapas
posteriores. Nada de lo descrito acá existe todavía en el código.

Se documenta ahora para que las decisiones de diseño que se tomen en el
mientras tanto no cierren puertas que después haya que reabrir.

---

## 1. Comunicaciones al vigilador

### Qué resuelve

Hoy no hay forma de dejar constancia de que a un vigilador se le comunicó algo.
Las novedades van del vigilador hacia arriba; no existe el canal inverso con
registro de lectura. Sin eso, cualquier instrucción, advertencia o cambio de
consigna depende de WhatsApp y no queda en ningún legajo.

### Alcance

Una comunicación es un mensaje dirigido a un vigilador, con acuse de lectura.

**Emisión.** Debe poder crearse desde dos lugares, con el mismo modelo de datos:

- **Administración** — alcance total, cualquier vigilador.
- **Supervisor** — solo vigiladores con turno en objetivos de sus zonas. El
  mismo criterio de alcance que ya aplica `puede_administrar_rondas_objetivo`
  para rondas.

**Contenido mínimo por comunicación:**

| Campo | Notas |
|---|---|
| destinatario | un vigilador; los envíos masivos se modelan como N comunicaciones |
| emisor | usuario que la creó, con su rol al momento del envío |
| asunto | texto corto |
| cuerpo | texto largo |
| adjuntos | opcional, apuntando al mismo storage que ya usan las evidencias |
| prioridad | normal / importante — define si además dispara push |
| creada_at | |
| notificada_at | cuándo el vigilador confirmó lectura |

**Confirmación de lectura.** El vigilador ve la comunicación en su app y
dispone de un botón **Notificado**. Al presionarlo:

- se sella `notificada_at` con la hora del servidor, no del dispositivo;
- se registra el usuario que confirmó, para el caso de dispositivos compartidos;
- la acción es irreversible desde la app del vigilador.

Mientras `notificada_at` sea null, la comunicación figura como pendiente y
debe ser visible tanto para el emisor como para el supervisor de la zona.

**Historial.** Consultable por vigilador y por objetivo, sin recorte temporal.
Es la fuente que después alimenta el legajo digital (punto 2).

### Decisiones a tomar antes de implementar

- ¿Una comunicación no leída bloquea el inicio de turno? Recomendación: no
  bloquear, pero mostrarla de forma intrusiva al fichar.
- ¿Puede el emisor editar o borrar una comunicación ya enviada? Recomendación:
  no. Se anula con una comunicación nueva que la referencia.
- Retención: si las comunicaciones van al legajo, no pueden borrarse en cascada
  cuando se desactiva un vigilador.

---

## 2. Legajo digital

### Qué resuelve

Hoy el legajo del vigilador muestra turnos y asistencia. Falta todo lo
documental, que vive fuera del sistema.

### Alcance

Un contenedor único por vigilador que agrupe:

- **comunicaciones** — las del punto 1, con su estado de lectura;
- **recibos** — de sueldo, con acuse de recepción;
- **sanciones** — apercibimientos y suspensiones, con descargo del vigilador;
- **notificaciones** — formales, con constancia;
- **documentos** — DNI, certificados, habilitaciones, con vencimiento;
- **historial** — línea de tiempo unificada de todo lo anterior.

### Consideraciones de diseño

- **Un solo modelo, varios tipos.** Todos estos elementos comparten estructura:
  destinatario, emisor, fecha, adjunto, acuse. Conviene una tabla común con un
  campo `tipo` antes que seis tablas paralelas que después haya que unir para
  armar la línea de tiempo.
- **Vencimientos.** Los documentos son el único tipo con fecha de vencimiento.
  Eso habilita alertas de "habilitación por vencer", que operativamente es lo
  más valioso del módulo.
- **Acceso.** El vigilador ve solo lo suyo. El supervisor, lo de su zona. La
  administración, todo. Sanciones y recibos probablemente requieran un permiso
  más restrictivo que el resto: no todo supervisor debería ver un recibo.
- **Storage.** Los adjuntos son datos sensibles. Deben ir a un bucket privado
  con URLs firmadas efímeras, igual que las evidencias de rondas — nunca
  públicas ni persistidas.

---

## 3. Validación mensual de planilla

### Qué resuelve

Hoy la liquidación se arma sobre los datos de asistencia sin que nadie los haya
confirmado explícitamente. Los errores aparecen después de liquidar.

### Proceso

Cuatro pasos, en orden estricto:

1. **El vigilador revisa su planilla.** Ve sus turnos, horas reales y
   liquidables del mes cerrado.
2. **El vigilador confirma.** Queda sellado quién y cuándo. Si no está de
   acuerdo, deja una observación en vez de confirmar.
3. **El supervisor valida.** Revisa lo confirmado y las observaciones. Puede
   devolver la planilla al vigilador o validarla.
4. **Recién entonces queda disponible para liquidación.**

### Estados

```
borrador → confirmada_vigilador → validada_supervisor → disponible_liquidacion
                  ↑                        │
                  └──── devuelta ──────────┘
```

### Consideraciones de diseño

- **El paso 4 debe ser un bloqueo real, no un aviso.** Si la liquidación puede
  ejecutarse igual sobre una planilla sin validar, el proceso no sirve.
- **Qué pasa si el vigilador no confirma.** Necesita una salida: vencido un
  plazo, el supervisor debe poder validar dejando constancia de que se validó
  sin confirmación del vigilador.
- **Inmutabilidad.** Una vez validada, los registros de asistencia del período
  no deberían poder editarse sin invalidar la planilla y rehacer el circuito.
- **Relación con el cierre de mes existente.** Hay que revisar cómo convive
  esto con lo que hoy hace `lib/liquidacion.ts`, para no terminar con dos
  nociones distintas de "mes cerrado".
