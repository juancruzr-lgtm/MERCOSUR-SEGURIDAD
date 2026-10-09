# Lector a pedido del archivo histórico (visor)

Permite que Administración y Gerencia **vean** un archivo de MEGA desde el
Legajo Digital, sin sincronizar MEGA con Supabase y sin tocar el original.

No es el agente de indexación: **no escanea, no observa carpetas y no escribe en
`repositorio_documental`**. Sólo atiende pedidos individuales hechos desde la app.

## Cómo funciona

1. En la bandeja del archivo histórico, alguien de Administración o Gerencia
   toca «Ver documento». La base controla el permiso, el tipo de archivo (PDF o
   imagen), el tamaño (hasta 25 MB) y un tope de 30 pedidos por hora.
2. Este lector toma el pedido y lee **ese** archivo de la copia local de MEGA,
   en modo lectura. Comprueba:
   - que el SHA-256 sea el del índice;
   - que el contenido sea realmente un PDF o una imagen.

   Si algo no coincide, no sube nada.
3. Sube una copia al bucket privado `legajo-historico-temporal`. El bucket no
   tiene políticas de acceso: sólo el servidor puede leerlo y firmarlo.
4. La app firma un enlace de **60 s** sólo para quien hizo el pedido y registra
   cada apertura (quién, cuándo, IP y navegador).
5. La copia **vence a los 10 minutos** y se borra. El vencimiento del enlace y
   el de la copia son controles separados. Las borran este lector (cada minuto)
   y la app (en cada apertura).

> **Para activarlo en SRV02, seguir [ACTIVACION-SRV02.md](ACTIVACION-SRV02.md)**
> (paso a paso: verificar con `npm run visor:verificar`, piloto, auditoría y cómo detenerlo).

## Instalación en SRV02

En la carpeta del agente, donde ya está su `.env`, agregar:

```
VISOR_AGENTE_ID=srv02-visor
VISOR_RAICES=EMPLEADOS/=D:\ruta\de\MEGA\EMPLEADOS;ADMINISTRACION/=D:\ruta\de\MEGA\ADMINISTRACION
```

- El prefijo es el que figura en el índice (`ruta_relativa`). La ruta es la
  carpeta local de MEGA que le corresponde.
- Se puede configurar sólo una parte de MEGA.
- Un archivo fuera de las carpetas configuradas no se lee.

## Piloto (antes de dejarlo andando)

```
npm run visor:piloto -- 7cc0f6e4-8e0a-40d3-9346-87f95df16506 ec57ca0e-aad6-48f2-88d2-13a73f7847ec
```

Son el anexo del CCT 507 y el formulario de inducción en blanco: sin datos
personales. El piloto comprueba de punta a punta:
- lectura y hash;
- que el bucket sea privado;
- el enlace de 60 s y su vencimiento;
- la retención y el borrado;
- que el original quede intacto.

Si se agrega `SUPABASE_ANON_KEY`, también prueba que la clave pública no
descargue.

## Dejarlo andando

```
npm run visor
```

Si el lector no está andando, el pedido vence a los 5 minutos y la app lo
informa. No hay datos personales en los logs: sólo el id del pedido.
