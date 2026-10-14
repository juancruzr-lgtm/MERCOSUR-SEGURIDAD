-- Protocolos — carga inicial: 22 textos de Aldo Monzón (oct-2026) como BORRADOR.
--
-- GENERADO por docs/protocolos/aldo-monzon-2026-10/generar-carga-inicial.mjs.
-- No editar a mano: regenerar. tests/protocolos-carga-inicial.test.ts verifica
-- que cada texto sea un substring EXACTO de chat-original.txt.
--
-- Fuente: docs/protocolos/aldo-monzon-2026-10/chat-original.txt (chat.txt de «Aldo Monzón.zip»)
--         sha256 334bd80983d1945ba11b6d38f4dd24c6f3eada52d075e0e2e0f6284105bc6687
--
-- Qué hace:
--   · 22 versiones en estado 'borrador' para 21 objetivos (Rapsodia tiene dos:
--     ninguna se elige acá). Nada queda vigente: publicar es de Gerencia.
--   · Coincidencias probables con asociacion = 'pendiente_validacion': no se
--     pueden publicar hasta que Gerencia confirme el objetivo.
--   · 38 diferencias de la auditoría del 14/10/2026, todas 'pendiente'.
-- Idempotente y a prueba de base distinta: si un objetivo no existe, su fila
-- se saltea; si ya está cargada, no se duplica.
-- Requiere 20261022120000_protocolos_objetivo.sql.

begin;

-- RANDSTAD · v1 · confirmada · sha256 19a47d236be5d75376f8ff8943f057e80c2d910e47259d10cb6b7e9e8b26e3fe
insert into public.protocolo_versiones (
  objetivo_id, puesto_id, numero, titulo, texto, texto_sha256,
  fuente_tipo, fuente_descripcion, fuente_fecha, fuente_archivo, fuente_archivo_sha256,
  asociacion, asociacion_nota, notas
)
select 'ac273ff2-71f6-4de2-ae4e-c0d518795dad'::uuid, null, 1, 'FUNCIONES Y PROCEDIMIENTOS DE ACTUACIÓN EN RANDSTAD',
$txt$FUNCIONES Y PROCEDIMIENTOS DE ACTUACIÓN EN RANDSTAD
El vigilador ingresa a la guardia 7:30 hs y recorre los pisos desde el 7mo hasta el 1ro verificando que todo esté en orden. Se destaca que en el Piso 4, aparte de dos oficinas de Randstad,  hay otra donde funcionan una inmobiliaria y un consultorio médico que no tienen relación alguna con la Empresa, por lo que no se verifica nada de las mismas.

Al hacerse presente personal externo y de proveedores de servicio, el vigilador registrará los datos de identidad en el libro de novedades. Inmediatamente llamará al sector y oficina donde dice que debe dirigirse para anunciarlo y si le dan la autorización se le permitirá el acceso.

En el transcurso del día se recibe y se entregan encomiendas  a distintos correos (Correo Argentino, Oca, Ocasa, Andreani, etc.) debiéndose llevar un control de lo que se envía y se recibe, por lo que asentará ese movimiento en el libro de novedades.

Si el guardia tiene que ir al baño, pedirá reemplazo primero al sector de Archivo, a Mantenimiento o a Compras (en ese orden) ya que no puede dejar a cualquiera en la guardia.

Al retirarse los empleados de Randstad se procede a cerrar las puertas, se verifica ahora desde el piso 8vo al primero que las  ventanas estén cerradas, luces y artefactos apagados y toda otra circunstancia que corresponda. Constatada la normalidad en las oficinas se procede a activar la alarma cerrando cada piso. Si a las 19,30 hs todo el personal de Randstad se ha retirado, por más que permanezcan personas en las oficinas de la inmobiliaria y consultorio médico del Piso 4, el vigilador está autorizado a retirarse.$txt$,
  repeat('0', 64),
  'whatsapp', 'WhatsApp de Aldo Monzón, mensaje del 30/09/2026 14:15:43; línea 4 del archivo', '2026-09-30 14:15:43-03'::timestamptz,
  'docs/protocolos/aldo-monzon-2026-10/chat-original.txt (chat.txt de «Aldo Monzón.zip»)', '334bd80983d1945ba11b6d38f4dd24c6f3eada52d075e0e2e0f6284105bc6687',
  'confirmada', null, null
where exists (select 1 from public.objetivos o where o.id = 'ac273ff2-71f6-4de2-ae4e-c0d518795dad'::uuid)
on conflict do nothing;

-- LA CASONA · v1 · confirmada · sha256 d0a64953fef52eb83bc3fb04d883b7fe592c7fbd5d748e716e88c180e1ecfd96
insert into public.protocolo_versiones (
  objetivo_id, puesto_id, numero, titulo, texto, texto_sha256,
  fuente_tipo, fuente_descripcion, fuente_fecha, fuente_archivo, fuente_archivo_sha256,
  asociacion, asociacion_nota, notas
)
select '335179ef-af0e-41e7-9a38-66a2da661f48'::uuid, null, 1, 'LA CASONA ALBERGUE MUNICIPAL',
$txt$LA CASONA ALBERGUE MUNICIPAL
FUNCIONES Y PROCEDIMIENTOS 
	
El servicio se cubre con un vigilador de lunes a viernes de 07,00 hs a 19,00 hs, siendo relevado y relevando a personal policial. En tanto que sábados, domingos y feriados se cubrirá las 24 horas. 

El vigilador tendrá a su cargo la recepción de las personas autorizadas para permanecer en el lugar, guiándose por las planillas que le entreguen los responsables del edificio. A su vez realizará recorridas por el predio en distintos horarios marcando presencia para evitar los ingresos de personas ajenas al lugar.

El guardia de seguridad utiliza las instalaciones y servicios a los que tienen acceso las demás personas y empleados, no existiendo un espacio físico exclusivo para su permanencia. 

Fuera del edificio, siempre dentro del predio, existen cámaras de seguridad a las cuales personal de Mercosur no tiene acceso. Hay disponibilidad de internet, no obstante la clave de WiFi debe ser solicitada a los responsables del lugar. Asimismo existe una cámara de vigilancia que pertenece a Mercosur y que toma imágenes de la sala principal donde tiene el escritorio la vigilancia, que si se encuentra desconectada al tomar servicio ae procederá a su conexión.

Realizará recorridas con marcación de puntos por el predio cada 2 horas como tiempo máximo entre rondas.$txt$,
  repeat('0', 64),
  'whatsapp', 'WhatsApp de Aldo Monzón, mensaje del 30/09/2026 14:16:16; línea 14 del archivo', '2026-09-30 14:16:16-03'::timestamptz,
  'docs/protocolos/aldo-monzon-2026-10/chat-original.txt (chat.txt de «Aldo Monzón.zip»)', '334bd80983d1945ba11b6d38f4dd24c6f3eada52d075e0e2e0f6284105bc6687',
  'confirmada', null, null
where exists (select 1 from public.objetivos o where o.id = '335179ef-af0e-41e7-9a38-66a2da661f48'::uuid)
on conflict do nothing;

-- SKATEPARK · v1 · confirmada · sha256 994675cb3190139410a0136587e7ec66921e5dfbc7d9f47b3dded2c1523c5799
insert into public.protocolo_versiones (
  objetivo_id, puesto_id, numero, titulo, texto, texto_sha256,
  fuente_tipo, fuente_descripcion, fuente_fecha, fuente_archivo, fuente_archivo_sha256,
  asociacion, asociacion_nota, notas
)
select '874fcb68-07ff-4de8-a48c-3405c932a20b'::uuid, null, 1, 'SKATEPARK ROSARIO NORTE',
$txt$SKATEPARK ROSARIO NORTE
FUNCIONES Y PROCEDIMIENTOS 
	
El servicio se cubre con un vigilador de lunes a domingo de 15,00 hs a 23,00 hs. 

El vigilador deberá mostrarse permanentemente con el fin de evitar desordenes, daños en las instalaciones y el ingreso de personas con cualquier tipo de vehículos, realizando rondas de marcación por el predio por espacio no superiores a los 30 minutos.

El guardia de seguridad carece de refugios para permanecer, como también de baños. En momentos de lluvia o condiciones climáticas adversas permanecerá en el edificio de “La Casona”, ubicado a menos de 100 metros del lugar. También cuando necesite el uso de los sanitarios para sus necesidades, utilizará  los de La Casona y volverá al servicio asignado de inmediato. 

Ante la eventual posibilidad que el efectivo policial que debe relevar al vigilador de Mercosur que cubre “La Casona” a las 19,00 hs, no se haga presente, se trasladará hasta el lugar para continuar con dicho servicio hasta que llegue el funcionario policial.$txt$,
  repeat('0', 64),
  'whatsapp', 'WhatsApp de Aldo Monzón, mensaje del 30/09/2026 14:16:50; línea 26 del archivo', '2026-09-30 14:16:50-03'::timestamptz,
  'docs/protocolos/aldo-monzon-2026-10/chat-original.txt (chat.txt de «Aldo Monzón.zip»)', '334bd80983d1945ba11b6d38f4dd24c6f3eada52d075e0e2e0f6284105bc6687',
  'confirmada', null, null
where exists (select 1 from public.objetivos o where o.id = '874fcb68-07ff-4de8-a48c-3405c932a20b'::uuid)
on conflict do nothing;

-- NACION SERVICIOS ENTRE RIOS · v1 · confirmada · sha256 4f5cf8eaa7ae94cb6465c123719a0abe27e5a3a1a66d8eb1db914ddf08235622
insert into public.protocolo_versiones (
  objetivo_id, puesto_id, numero, titulo, texto, texto_sha256,
  fuente_tipo, fuente_descripcion, fuente_fecha, fuente_archivo, fuente_archivo_sha256,
  asociacion, asociacion_nota, notas
)
select '790807dd-8283-4e6e-90bc-832226d016df'::uuid, null, 1, 'NACION SERVICIOS — UBICACIÓN ENTRE RIOS 864 ROSARIO',
$txt$NACION SERVICIOS
UBICACIÓN ENTRE RIOS 864 ROSARIO
FUNCIONES Y PROCEDIMIENTOS 
	
El servicio se cubre con UN (01) vigilador de lunes a domingo 07.00 hs a 19,00 hs. y un (01) vigilador de 19,00 hs a 07,00 hs. 

Las tareas de los Guardias de Seguridad se reparten en dos, las principales son: 1) Control de libros de visita, llaves, actas y alarma. 2) Control persianas 3) Entrega de tarjetas 4) Control cámaras, alarmas y email (activar/desactivar) 5) Control de ingreso y egreso del personal, técnicos, limpieza y visitas 6) Guardia pasiva (se activa cuando hay corte de luz o alguna falla en el establecimiento) 7) Completar planillas de guardia y limpieza 8) Control de cochera autorización y control de datos del personal.
Y las tareas de refuerzo a saber: 1) Control libro visita y llaves 2) Control de salida personal de limpieza y técnicos (control de bolsos y caja herramientas) 3) Apertura/cierre persiana 4) Completar planillas 5) Control cámaras 6) Control cochera ingreso/egreso.

El edificio posee cámaras de vigilancias a cuyos registros no tiene acceso el personal de Mercosur. Existe disponibilidad de conexión a internet pero la clave de Wi Fi debe ser autorizada para su uso por los responsables del lugar.$txt$,
  repeat('0', 64),
  'whatsapp', 'WhatsApp de Aldo Monzón, mensaje del 01/10/2026 15:29:50; línea 37 del archivo', '2026-10-01 15:29:50-03'::timestamptz,
  'docs/protocolos/aldo-monzon-2026-10/chat-original.txt (chat.txt de «Aldo Monzón.zip»)', '334bd80983d1945ba11b6d38f4dd24c6f3eada52d075e0e2e0f6284105bc6687',
  'confirmada', null, null
where exists (select 1 from public.objetivos o where o.id = '790807dd-8283-4e6e-90bc-832226d016df'::uuid)
on conflict do nothing;

-- NACION SANTA FE · v1 · pendiente_validacion · sha256 dcaa21acd8464b4e6a1b66e2c2707d04fc28cd1f25806627ba3be980be4a5685
insert into public.protocolo_versiones (
  objetivo_id, puesto_id, numero, titulo, texto, texto_sha256,
  fuente_tipo, fuente_descripcion, fuente_fecha, fuente_archivo, fuente_archivo_sha256,
  asociacion, asociacion_nota, notas
)
select '946a50ec-e6cf-4995-80dc-6586178f9e3a'::uuid, null, 1, 'NACION SERVICIOS — UBICACIÓN SANTA FE 1345 ROSARIO',
$txt$NACION SERVICIOS
UBICACIÓN SANTA FE 1345 ROSARIO
FUNCIONES Y PROCEDIMIENTOS 
	
El servicio se cubre con un (01) vigilador de lunes a domingo las 24 horas. 

Las tareas del Guardia de Seguridad son las siguientes: Generar tarjetas de visitas y tarjetas back up. Recibir personal de limpieza y mantenimientos haciéndoles tarjetas y completar las planilla con sus datos. Completan bitácoras con los ingresos y egresos y asientan las novedades del día. A pedido de administración hacen control de las planillas de limpieza y mantenimiento. En el turno noche se envían reportes y se realizan rondines cada dos horas. A las 00:00 se comunican con Bs As y se hacen confiscación de tarjetas. Deben llevar control de llaves de las oficinas, realizar monitoreo general y control de registros de alarmas. 

El edificio posee cámaras de vigilancias a cuyos registros no tiene acceso el personal de Mercosur. Existe disponibilidad de conexión a internet pero la clave de Wi Fi debe ser autorizada para su uso por los responsables del lugar.$txt$,
  repeat('0', 64),
  'whatsapp', 'WhatsApp de Aldo Monzón, mensaje del 01/10/2026 15:30:37; línea 47 del archivo', '2026-10-01 15:30:37-03'::timestamptz,
  'docs/protocolos/aldo-monzon-2026-10/chat-original.txt (chat.txt de «Aldo Monzón.zip»)', '334bd80983d1945ba11b6d38f4dd24c6f3eada52d075e0e2e0f6284105bc6687',
  'pendiente_validacion', 'Aldo: «NACION SERVICIOS / UBICACIÓN SANTA FE 1345 ROSARIO». El objetivo no tiene calle cargada.', null
where exists (select 1 from public.objetivos o where o.id = '946a50ec-e6cf-4995-80dc-6586178f9e3a'::uuid)
on conflict do nothing;

-- RAPSODIA · v1 · confirmada · sha256 62fd8ebcde0ed3339ea5e55851a5b96286290fff696e0dbbca327c49d983f736
insert into public.protocolo_versiones (
  objetivo_id, puesto_id, numero, titulo, texto, texto_sha256,
  fuente_tipo, fuente_descripcion, fuente_fecha, fuente_archivo, fuente_archivo_sha256,
  asociacion, asociacion_nota, notas
)
select '7109a4cf-0f39-4f1f-8c23-6976bb98838c'::uuid, null, 1, 'RAPSODIA',
$txt$RAPSODIA
FUNCIONES Y PROCEDIMIENTOS 
	
El servicio se cubre con un vigilador de lunes a viernes de 08,30 hs a 20,30 hs. y sábados de 08,30 hs a 15,30 hs. 

El vigilador tiene que estar presente en la apertura del local. No tiene un espacio físico especial sino que se ubica en una banqueta en el ingreso. La función principal es observar la gente que ingresa, caminar entre los clientes y controlar que las prendas que se encuentran en exhibición tengan colocadas el troquel de alarma. 

El guardia de seguridad utiliza las instalaciones y servicios a los que tienen acceso los demás empleados.

Hay disponibilidad de internet, no obstante la clave de WiFi debe ser solicitada a los responsables del lugar.$txt$,
  repeat('0', 64),
  'whatsapp', 'WhatsApp de Aldo Monzón, mensaje del 02/10/2026 14:05:43; línea 56 del archivo', '2026-10-02 14:05:43-03'::timestamptz,
  'docs/protocolos/aldo-monzon-2026-10/chat-original.txt (chat.txt de «Aldo Monzón.zip»)', '334bd80983d1945ba11b6d38f4dd24c6f3eada52d075e0e2e0f6284105bc6687',
  'confirmada', null, 'Rapsodia tiene DOS versiones. Ésta es la que Aldo envió suelta el 02/10/2026 14:05. No se eligió ninguna: decide Gerencia.'
where exists (select 1 from public.objetivos o where o.id = '7109a4cf-0f39-4f1f-8c23-6976bb98838c'::uuid)
on conflict do nothing;

-- RAPSODIA · v2 · confirmada · sha256 cd73c7c4676b147d87f632fc662d131a11f91b66ce687549d8857f00ae3d2fdf
insert into public.protocolo_versiones (
  objetivo_id, puesto_id, numero, titulo, texto, texto_sha256,
  fuente_tipo, fuente_descripcion, fuente_fecha, fuente_archivo, fuente_archivo_sha256,
  asociacion, asociacion_nota, notas
)
select '7109a4cf-0f39-4f1f-8c23-6976bb98838c'::uuid, null, 2, 'RAPSODIA',
$txt$RAPSODIA
FUNCIONES Y PROCEDIMIENTOS 
	
El servicio se cubre con un vigilador de lunes a viernes de 08,30 hs a 20,30 hs. y sábados de 08,30 hs a 15,30 hs. 

El vigilador tendrá a su cargo la apertura del local y la desconexión del sistema de alarma. No tiene un espacio físico especial sino que se ubica en una banqueta en el ingreso. La función principal es observar la gente que ingresa, caminar entre los clientes y controlar que las prendas que se encuentran en exhibición tengan colocadas el troquel de alarma. A la hora del cierre es el encargado de activar las alarmas.

El guardia de seguridad utiliza las instalaciones y servicios a los que tienen acceso los demás empleados.

Hay disponibilidad de internet, no obstante la clave de WiFi debe ser solicitada a los responsables del lugar.$txt$,
  repeat('0', 64),
  'whatsapp', 'WhatsApp de Aldo Monzón, mensaje del 02/10/2026 15:42:45; bloque reenviado dentro del mensaje, firmado «Mio Mercosur», fecha interna 1/10 18:19; línea 74 del archivo', '2026-10-02 15:42:45-03'::timestamptz,
  'docs/protocolos/aldo-monzon-2026-10/chat-original.txt (chat.txt de «Aldo Monzón.zip»)', '334bd80983d1945ba11b6d38f4dd24c6f3eada52d075e0e2e0f6284105bc6687',
  'confirmada', null, 'Rapsodia tiene DOS versiones. Ésta llegó dentro de un reenvío del 02/10/2026 15:42 (bloque «Mio Mercosur», fecha interna 1/10 18:19): agrega desconexión y activación de alarma. Su fecha interna es ANTERIOR a la otra. No se eligió ninguna: decide Gerencia.'
where exists (select 1 from public.objetivos o where o.id = '7109a4cf-0f39-4f1f-8c23-6976bb98838c'::uuid)
on conflict do nothing;

-- TEATRO LA COMEDIA · v1 · confirmada · sha256 831a605ac729ba65959a833fcb561943a6cdd89974aa777ad855a256f5bb51d5
insert into public.protocolo_versiones (
  objetivo_id, puesto_id, numero, titulo, texto, texto_sha256,
  fuente_tipo, fuente_descripcion, fuente_fecha, fuente_archivo, fuente_archivo_sha256,
  asociacion, asociacion_nota, notas
)
select '2ff263d8-a74e-4e36-914f-215b54510a4b'::uuid, null, 1, 'TEATRO LA COMEDIA',
$txt$TEATRO LA COMEDIA
FUNCIONES Y PROCEDIMIENTOS 
	
El servicio se cubre con un vigilador de martes a viernes de 09,00 hs a 16,00 hs y los sábados de 10,00 hs a 13,00 hs.

El Guardia de Seguridad no tiene espacio propio y debe permanecer en inmediaciones de la boletería, cuando hay funciones se ubicará en uno de los ingresos siempre a la vista del público.

Existe disponibilidad de conexión a Wi Fi y el vigilador tiene la clave. Asimismo están instaladas cámaras de vigilancia en área de boletería y en la sala, a las que el vigilador no tiene acceso.$txt$,
  repeat('0', 64),
  'whatsapp', 'WhatsApp de Aldo Monzón, mensaje del 02/10/2026 15:42:45; bloque reenviado dentro del mensaje, firmado «Aldo», fecha interna 1/10 14:40; línea 66 del archivo', '2026-10-02 15:42:45-03'::timestamptz,
  'docs/protocolos/aldo-monzon-2026-10/chat-original.txt (chat.txt de «Aldo Monzón.zip»)', '334bd80983d1945ba11b6d38f4dd24c6f3eada52d075e0e2e0f6284105bc6687',
  'confirmada', null, null
where exists (select 1 from public.objetivos o where o.id = '2ff263d8-a74e-4e36-914f-215b54510a4b'::uuid)
on conflict do nothing;

-- LA CAJA · v1 · confirmada · sha256 3f42918640d106e294495e8742515ffaea91cf48cdc304b8db2d8745519a35fe
insert into public.protocolo_versiones (
  objetivo_id, puesto_id, numero, titulo, texto, texto_sha256,
  fuente_tipo, fuente_descripcion, fuente_fecha, fuente_archivo, fuente_archivo_sha256,
  asociacion, asociacion_nota, notas
)
select '66b1b991-8045-4883-86b9-3d2be32914a5'::uuid, null, 1, 'LA CAJA COMPAÑÍA DE SEGUROS',
$txt$LA CAJA COMPAÑÍA DE SEGUROS
FUNCIONES Y PROCEDIMIENTOS 
	
El servicio se cubre con un único vigilador que ingresa a las 08,45 hs y se retira a las 16,45 hs de lunes a viernes. Siendo el encargado de abrir y cerrar el edificio, con la desactivación y activación de alarma.

Debe permanecer en el lugar sin contar con espacio físico especial, no obstante utiliza el baño y comodidades como el resto del personal. 

Existe disponibilidad de conexión a internet y la clave de WiFi está disponible para el Guardia de Seguridad.$txt$,
  repeat('0', 64),
  'whatsapp', 'WhatsApp de Aldo Monzón, mensaje del 02/10/2026 15:43:31; línea 84 del archivo', '2026-10-02 15:43:31-03'::timestamptz,
  'docs/protocolos/aldo-monzon-2026-10/chat-original.txt (chat.txt de «Aldo Monzón.zip»)', '334bd80983d1945ba11b6d38f4dd24c6f3eada52d075e0e2e0f6284105bc6687',
  'confirmada', null, null
where exists (select 1 from public.objetivos o where o.id = '66b1b991-8045-4883-86b9-3d2be32914a5'::uuid)
on conflict do nothing;

-- PSA · v1 · confirmada · sha256 d13d5ba5c422e1881bcb15ace4933fc727d6353194f28d5cd430a87ea4553e27
insert into public.protocolo_versiones (
  objetivo_id, puesto_id, numero, titulo, texto, texto_sha256,
  fuente_tipo, fuente_descripcion, fuente_fecha, fuente_archivo, fuente_archivo_sha256,
  asociacion, asociacion_nota, notas
)
select '29fee8f6-493b-4e68-a09d-44808728a319'::uuid, null, 1, 'PSA PURIFICADORES DE AGUA',
$txt$PSA   PURIFICADORES DE AGUA
FUNCIONES Y PROCEDIMIENTOS 
	
El servicio se cubre con un único vigilador que ingresa a las 09,30 hs y se retira a las 18,00 hs de lunes a viernes. Siendo el encargado hacer la apertura y cierre del local, sin tener la responsabilidad de conectar y desactivar alarma.

Tiene espacio propio para permanecer que se ubica en el ingreso con un escritorio, donde recibe a quienes se presentan y los deriva al sector que corresponda. Su función principal es la detallada, atender a distribuidores, comisionistas y público en general. También recibe pedidos y los deriva para su revisión a control de stock. 

Existe disponibilidad de conexión a internet pero la clave de WiFi no está disponible para el Guardia de Seguridad.$txt$,
  repeat('0', 64),
  'whatsapp', 'WhatsApp de Aldo Monzón, mensaje del 02/10/2026 15:44:39; línea 92 del archivo', '2026-10-02 15:44:39-03'::timestamptz,
  'docs/protocolos/aldo-monzon-2026-10/chat-original.txt (chat.txt de «Aldo Monzón.zip»)', '334bd80983d1945ba11b6d38f4dd24c6f3eada52d075e0e2e0f6284105bc6687',
  'confirmada', null, null
where exists (select 1 from public.objetivos o where o.id = '29fee8f6-493b-4e68-a09d-44808728a319'::uuid)
on conflict do nothing;

-- CIRSE · v1 · confirmada · sha256 02e8011c11224b2bc610a33564e7f6d19a390f14e194561835dd16a9569c5d89
insert into public.protocolo_versiones (
  objetivo_id, puesto_id, numero, titulo, texto, texto_sha256,
  fuente_tipo, fuente_descripcion, fuente_fecha, fuente_archivo, fuente_archivo_sha256,
  asociacion, asociacion_nota, notas
)
select '722723eb-543a-4a46-b1c3-b87f00c794ca'::uuid, null, 1, 'CIRSE CLUB DE NAVEGACION',
$txt$CIRSE CLUB DE NAVEGACION
FUNCIONES Y PROCEDIMIENTOS ACTUALIZADAS 
	
El vigilador ingresa al servicio a las 22,00 horas relevando a un empleado del lugar y es relevado por otro empleado del Club a las 06,00 hs., ubicándose en una garita en el ingreso.

El guardia de seguridad debe recorrer el predio, con marcación y cuando hay eventos controlar el ingreso de personas, sin realizar registros en planilla.

El lugar no tiene conexión a WiFi ni cámaras de seguridad, solo con un contenedor oficina a la que un cable le provee iluminación.$txt$,
  repeat('0', 64),
  'whatsapp', 'WhatsApp de Aldo Monzón, mensaje del 03/10/2026 09:40:20; línea 100 del archivo', '2026-10-03 09:40:20-03'::timestamptz,
  'docs/protocolos/aldo-monzon-2026-10/chat-original.txt (chat.txt de «Aldo Monzón.zip»)', '334bd80983d1945ba11b6d38f4dd24c6f3eada52d075e0e2e0f6284105bc6687',
  'confirmada', null, null
where exists (select 1 from public.objetivos o where o.id = '722723eb-543a-4a46-b1c3-b87f00c794ca'::uuid)
on conflict do nothing;

-- PNC · v1 · confirmada · sha256 4894fa4a85919ce1fe6a6feec040a5ac196013138a8484f0ae28963ee6307bf4
insert into public.protocolo_versiones (
  objetivo_id, puesto_id, numero, titulo, texto, texto_sha256,
  fuente_tipo, fuente_descripcion, fuente_fecha, fuente_archivo, fuente_archivo_sha256,
  asociacion, asociacion_nota, notas
)
select 'a006b949-4b99-41a6-951c-22a6be1f7d92'::uuid, null, 1, 'PNC REMOLQUES',
$txt$PNC REMOLQUES
FUNCIONES Y PROCEDIMIENTOS 
	
El servicio es cubierto por un vigilador de 20,00 hs a 08,00 hs de lunes a sábados, en tanto que el domingo es cubierto las 24 hs también por un único Guardia de Seguridad..

Realizará recorridas por el predio con marcaciones. A su vez lleva a cabo controles de los camiones que puedan ingresar en cualquier horario. 

El vigilador tiene espacio disponible en un contenedor/garita en el ingreso al predio, lugar donde no tiene señal de WiFi que sí se conecta en la zona de oficinas ubicada a unos 200 metros de su posición.$txt$,
  repeat('0', 64),
  'whatsapp', 'WhatsApp de Aldo Monzón, mensaje del 03/10/2026 09:40:40; línea 108 del archivo', '2026-10-03 09:40:40-03'::timestamptz,
  'docs/protocolos/aldo-monzon-2026-10/chat-original.txt (chat.txt de «Aldo Monzón.zip»)', '334bd80983d1945ba11b6d38f4dd24c6f3eada52d075e0e2e0f6284105bc6687',
  'confirmada', null, null
where exists (select 1 from public.objetivos o where o.id = 'a006b949-4b99-41a6-951c-22a6be1f7d92'::uuid)
on conflict do nothing;

-- ACA · v1 · pendiente_validacion · sha256 fb1ae4c54b0ee8cbd3b6185c771347cd8abd825a7360ed698360d9b68348a469
insert into public.protocolo_versiones (
  objetivo_id, puesto_id, numero, titulo, texto, texto_sha256,
  fuente_tipo, fuente_descripcion, fuente_fecha, fuente_archivo, fuente_archivo_sha256,
  asociacion, asociacion_nota, notas
)
select '8f1e4b3c-23bc-464a-a2d3-66de8eb8d545'::uuid, null, 1, 'AUTOMOVIL CLUB ARGENTINO (ACA)',
$txt$AUTOMOVIL CLUB ARGENTINO (ACA)
FUNCIONES Y PROCEDIMIENTOS ACTUALIZADAS 
	
El servicio se cubre con un vigilador de lunes a domingo las 24 hs.

El vigilador debe retirar las llaves del lugar en la oficina del encargado, donde también las deberá dejar a la finalización del servicio. 

Realizará recorridas con marcación de puntos sin horarios ni tiempos determinados, con mayor asiduidad en los horarios de menor movimiento de personas. Permanecerá en el ingreso atendiendo los automovilistas que se acerquen pudiéndolos ayudar para pagar el servicio de estacionamiento con la aplicación, sobre lo que son instruidos por el encargado. .

Existe disponibilidad conexión a internet pero la señal es muy inestable. El vigilador permanece en el espacio destinado a boletería desde donde pueden monitorear las cámaras de video vigilancia instaladas en el área de estacionamiento, no así las imágenes de la cámara que está en boletería a las que solo tiene acceso el encargado.$txt$,
  repeat('0', 64),
  'whatsapp', 'WhatsApp de Aldo Monzón, mensaje del 03/10/2026 09:41:06; línea 116 del archivo', '2026-10-03 09:41:06-03'::timestamptz,
  'docs/protocolos/aldo-monzon-2026-10/chat-original.txt (chat.txt de «Aldo Monzón.zip»)', '334bd80983d1945ba11b6d38f4dd24c6f3eada52d075e0e2e0f6284105bc6687',
  'pendiente_validacion', 'Aldo: «AUTOMOVIL CLUB ARGENTINO (ACA)», sin ciudad. Existe también «ACA SANTA FE» (inactivo).', null
where exists (select 1 from public.objetivos o where o.id = '8f1e4b3c-23bc-464a-a2d3-66de8eb8d545'::uuid)
on conflict do nothing;

-- ANTENA · v1 · pendiente_validacion · sha256 18d99b04522e5682f504c8385043800a85f00e03a0f75a96347d65bb547d2dd9
insert into public.protocolo_versiones (
  objetivo_id, puesto_id, numero, titulo, texto, texto_sha256,
  fuente_tipo, fuente_descripcion, fuente_fecha, fuente_archivo, fuente_archivo_sha256,
  asociacion, asociacion_nota, notas
)
select 'cb86521d-2ca2-4095-9110-394b3077d271'::uuid, null, 1, 'ANTENA RADIO NACIONAL',
$txt$ANTENA RADIO NACIONAL
FUNCIONES Y PROCEDIMIENTOS 	
El servicio será cubierto por un vigilador en el horario de 12,00 hs a 07,00 hs., en tanto que sábados y domingos el servicio será de un Guardia de Seguridad las 24 horas.
El vigilador cuenta con espacio para resguardarse y debe realizar recorridas por el predio. A su vez existe conexión a WiFi cuya clave está en conocimiento del mismo.$txt$,
  repeat('0', 64),
  'whatsapp', 'WhatsApp de Aldo Monzón, mensaje del 03/10/2026 09:41:29; línea 126 del archivo', '2026-10-03 09:41:29-03'::timestamptz,
  'docs/protocolos/aldo-monzon-2026-10/chat-original.txt (chat.txt de «Aldo Monzón.zip»)', '334bd80983d1945ba11b6d38f4dd24c6f3eada52d075e0e2e0f6284105bc6687',
  'pendiente_validacion', 'Aldo: «ANTENA RADIO NACIONAL». En la base: «ANTENA», cliente «Antena».', null
where exists (select 1 from public.objetivos o where o.id = 'cb86521d-2ca2-4095-9110-394b3077d271'::uuid)
on conflict do nothing;

-- CLUB · v1 · pendiente_validacion · sha256 bf106fcd0addd0411c0f6b675d4279dbc3b28056eb00adbb5115ccf5b77358da
insert into public.protocolo_versiones (
  objetivo_id, puesto_id, numero, titulo, texto, texto_sha256,
  fuente_tipo, fuente_descripcion, fuente_fecha, fuente_archivo, fuente_archivo_sha256,
  asociacion, asociacion_nota, notas
)
select '76ef2bd4-38aa-45c2-b103-41997e7f77ad'::uuid, null, 1, 'CLUB UNIVERSITARIO (UNINORTE)',
$txt$CLUB UNIVERSITARIO (UNINORTE)
FUNCIONES Y PROCEDIMIENTOS 	
El servicio se realiza con un (01) vigilador de lunes a viernes de 15,00 hs a 07,00 hs, en tanto que sábados y domingos se cubrirá con un vigilador las 24 horas.
En el turno diurno el vigilador se ubicará en la garita del frente del predio debiendo controlar el ingreso de proveedores, invitados y socios, a estos últimos se controla que registren su situación en orden a través de una aplicación instalada en un celular provisto por el propio Club. Cuando no hay actividad se efectuaran recorridas con marcación cada una hora. Por la noche el Guardia de Seguridad es el encargado de encender las luces.  
No hay cámaras de seguridad en todo el predio. Mercosur ha instalado una cámara de vigilancia en la garita pero suele no tener señal para su uso pese a que existe disponibilidad de WIFI contando los vigiladores con la clave para acceso al mismo.$txt$,
  repeat('0', 64),
  'whatsapp', 'WhatsApp de Aldo Monzón, mensaje del 03/10/2026 09:41:49; línea 130 del archivo', '2026-10-03 09:41:49-03'::timestamptz,
  'docs/protocolos/aldo-monzon-2026-10/chat-original.txt (chat.txt de «Aldo Monzón.zip»)', '334bd80983d1945ba11b6d38f4dd24c6f3eada52d075e0e2e0f6284105bc6687',
  'pendiente_validacion', 'Aldo: «CLUB UNIVERSITARIO (UNINORTE)». En la base: «CLUB», cliente «Club». La carpeta MEGA «CLIENTES/CLUB UNIVERSITARIO» lo respalda.', null
where exists (select 1 from public.objetivos o where o.id = '76ef2bd4-38aa-45c2-b103-41997e7f77ad'::uuid)
on conflict do nothing;

-- jardin de los niños · v1 · confirmada · sha256 c2f093a4a24cfc42c886a2fdfa303703f1e231d8b083662dcee19911574e847a
insert into public.protocolo_versiones (
  objetivo_id, puesto_id, numero, titulo, texto, texto_sha256,
  fuente_tipo, fuente_descripcion, fuente_fecha, fuente_archivo, fuente_archivo_sha256,
  asociacion, asociacion_nota, notas
)
select '8a6b4a85-5276-4c77-921f-b30c64166ad6'::uuid, null, 1, 'JARDIN DE LOS NIÑOS (PARQUE INDEPENDENCIA)',
$txt$JARDIN DE LOS NIÑOS (PARQUE INDEPENDENCIA)
FUNCIONES Y PROCEDIMIENTOS  
El puesto es cubierto por un (01) Guardia de Seguridad de lunes a domingos en el horario de 06,45 a 19,15 de lunes a domingos, siendo relevados y relevando a efectivos policiales.
La función del guardia es permanecer en la portería hasta el ingreso del personal administrativo a quienes entregara distintas llaves que están en resguardadas en el lugar. Inmediatamente comenzará a realizar recorridas por el predio con marcación de rondas. Asimismo estará atento a los distintos requerimientos que se le solicite, como por ejemplo la apertura de portones para el ingreso de personas o vehículos autorizados.$txt$,
  repeat('0', 64),
  'whatsapp', 'WhatsApp de Aldo Monzón, mensaje del 03/10/2026 11:14:31; línea 135 del archivo', '2026-10-03 11:14:31-03'::timestamptz,
  'docs/protocolos/aldo-monzon-2026-10/chat-original.txt (chat.txt de «Aldo Monzón.zip»)', '334bd80983d1945ba11b6d38f4dd24c6f3eada52d075e0e2e0f6284105bc6687',
  'confirmada', null, null
where exists (select 1 from public.objetivos o where o.id = '8a6b4a85-5276-4c77-921f-b30c64166ad6'::uuid)
on conflict do nothing;

-- MUSEO MACRO · v1 · confirmada · sha256 04178c361070d5d3c69f2316739fae5d117d5196fa845699170942fd4e662457
insert into public.protocolo_versiones (
  objetivo_id, puesto_id, numero, titulo, texto, texto_sha256,
  fuente_tipo, fuente_descripcion, fuente_fecha, fuente_archivo, fuente_archivo_sha256,
  asociacion, asociacion_nota, notas
)
select '59b65c62-9a57-4119-84ed-bc4cedf915d2'::uuid, null, 1, 'MUSEO MACRO FUNCIONES Y PROCEDIMIENTOS',
$txt$MUSEO MACRO                                                  FUNCIONES Y PROCEDIMIENTOS
El servicio se cubrirá con un (01) vigilador en el horario de 13,00 a 19,00 hs.de miércoles a viernes, en tanto que los sábados se cubrirá con dos (02) en el horario de 13,00 a 19,00 y los domingos también con dos (02) guardias pero de 10,00 a 19,00 horas.
La función que cumplirán los vigiladores será la de recorrer los distintos pisos con la finalidad que los concurrentes no toquen las muestras que están exhibidas, prestando mayor atención a las existentes en el piso 4to. y 7mo.$txt$,
  repeat('0', 64),
  'whatsapp', 'WhatsApp de Aldo Monzón, mensaje del 03/10/2026 15:35:53; línea 139 del archivo', '2026-10-03 15:35:53-03'::timestamptz,
  'docs/protocolos/aldo-monzon-2026-10/chat-original.txt (chat.txt de «Aldo Monzón.zip»)', '334bd80983d1945ba11b6d38f4dd24c6f3eada52d075e0e2e0f6284105bc6687',
  'confirmada', null, null
where exists (select 1 from public.objetivos o where o.id = '59b65c62-9a57-4119-84ed-bc4cedf915d2'::uuid)
on conflict do nothing;

-- MUSEO CASTAGNINO · v1 · confirmada · sha256 da16c9083ce27807511776cd9ef3c62596c29f1a51e2c36e590832139a26154c
insert into public.protocolo_versiones (
  objetivo_id, puesto_id, numero, titulo, texto, texto_sha256,
  fuente_tipo, fuente_descripcion, fuente_fecha, fuente_archivo, fuente_archivo_sha256,
  asociacion, asociacion_nota, notas
)
select '78350006-6fcf-43dc-9457-447aa9fba71e'::uuid, null, 1, 'MUSEO CASTAGNINO FUNCIONES Y PROCEDIMIENTOS',
$txt$MUSEO CASTAGNINO                                      FUNCIONES Y PROCEDIMIENTOS
El servicio se cubrirá con un (01) Guardia de Seguridad en el horario de 09,00 a 19,00 y dos (02) efectivos de 13,00 hs a 19,00 hs. Por su parte sábados y domingo será cubierto por tres (03) vigiladores de 10,00 hs a 19,00 hs.
Uno de los vigiladores deberá permanecer en hall de ingreso principal y los dos restantes recorriendo distintos sectores del edificio, con la función principal de no permitir que los visitantes toquen las esculturas exhibidas, con la obligación de acompañar a las excursiones de los contingentes que pudieran hacerse presentes.$txt$,
  repeat('0', 64),
  'whatsapp', 'WhatsApp de Aldo Monzón, mensaje del 03/10/2026 15:36:14; línea 142 del archivo', '2026-10-03 15:36:14-03'::timestamptz,
  'docs/protocolos/aldo-monzon-2026-10/chat-original.txt (chat.txt de «Aldo Monzón.zip»)', '334bd80983d1945ba11b6d38f4dd24c6f3eada52d075e0e2e0f6284105bc6687',
  'confirmada', null, null
where exists (select 1 from public.objetivos o where o.id = '78350006-6fcf-43dc-9457-447aa9fba71e'::uuid)
on conflict do nothing;

-- Polideportivo Lotuf · v1 · confirmada · sha256 d133121526abf287337610cffe9323fcef1442fcef0f6e513ea96c3384ca3db9
insert into public.protocolo_versiones (
  objetivo_id, puesto_id, numero, titulo, texto, texto_sha256,
  fuente_tipo, fuente_descripcion, fuente_fecha, fuente_archivo, fuente_archivo_sha256,
  asociacion, asociacion_nota, notas
)
select '0f0f4940-dcfa-4fd4-9d48-071429fa0da1'::uuid, null, 1, 'POLIDEPORTIVO LOTUF',
$txt$POLIDEPORTIVO LOTUF
FUNCIONES Y PROCEDIMIENTOS 

El servicio se cubre con un vigilador en el horario de 07,00 a 23.00 hs. siendo relevado y relevado por personal policial.
El Guardia debe permanecer en el ingreso al edificio inmediatamente después de la oficina de administración, controlando el ingreso a la pileta y derivando a los distintos sectores del establecimiento a quienes concurren por cualquier otra circunstancia. 
Asimismo realizará, cuando la actividad del lugar se lo permita,  controles sin marcación por todo el edificio. 
Cuando se realicen eventos deberá permanecer en las inmediaciones del sitio donde se llevan a cabo marcando presencia y asistenendo a quienes puedan necesitar indicaciones.$txt$,
  repeat('0', 64),
  'whatsapp', 'WhatsApp de Aldo Monzón, mensaje del 10/10/2026 10:13:07; mensaje marcado «[Reenviado]»; línea 145 del archivo', '2026-10-10 10:13:07-03'::timestamptz,
  'docs/protocolos/aldo-monzon-2026-10/chat-original.txt (chat.txt de «Aldo Monzón.zip»)', '334bd80983d1945ba11b6d38f4dd24c6f3eada52d075e0e2e0f6284105bc6687',
  'confirmada', null, null
where exists (select 1 from public.objetivos o where o.id = '0f0f4940-dcfa-4fd4-9d48-071429fa0da1'::uuid)
on conflict do nothing;

-- PLAZA DE LA COOPERACIÓN · v1 · pendiente_validacion · sha256 b1fef3a8a2ebb50373ba8f241bd46bafdd8adc4869b6dbb28886b346940b082c
insert into public.protocolo_versiones (
  objetivo_id, puesto_id, numero, titulo, texto, texto_sha256,
  fuente_tipo, fuente_descripcion, fuente_fecha, fuente_archivo, fuente_archivo_sha256,
  asociacion, asociacion_nota, notas
)
select '6fa49177-49ac-464e-99f5-333fdfd05d00'::uuid, null, 1, 'PAZA DE LA COOPERACION',
$txt$PAZA DE LA COOPERACION
FUNCIONES Y PROCEDIMIENTOS

El servicio se cubre con un (01) Guardia de Seguridad de 08,00 a 14,00 hs. de lunes a domingo, relevando y siendo relevado por personal policial. 
El guardia debe permanecer en el sector de depósito y debiendo abrir y mantener la puerta principal cerrada.$txt$,
  repeat('0', 64),
  'whatsapp', 'WhatsApp de Aldo Monzón, mensaje del 10/10/2026 10:13:29; mensaje marcado «[Reenviado]»; línea 152 del archivo', '2026-10-10 10:13:29-03'::timestamptz,
  'docs/protocolos/aldo-monzon-2026-10/chat-original.txt (chat.txt de «Aldo Monzón.zip»)', '334bd80983d1945ba11b6d38f4dd24c6f3eada52d075e0e2e0f6284105bc6687',
  'pendiente_validacion', 'Aldo: «PAZA DE LA COOPERACION» (sic).', null
where exists (select 1 from public.objetivos o where o.id = '6fa49177-49ac-464e-99f5-333fdfd05d00'::uuid)
on conflict do nothing;

-- PLAZA DE LAS CIENCIAS · v1 · pendiente_validacion · sha256 819bab4f98318d53b55f1da2feb375afe29b8a0738f5fd4636a4e5fd57fe9a6a
insert into public.protocolo_versiones (
  objetivo_id, puesto_id, numero, titulo, texto, texto_sha256,
  fuente_tipo, fuente_descripcion, fuente_fecha, fuente_archivo, fuente_archivo_sha256,
  asociacion, asociacion_nota, notas
)
select 'af0341a8-3c4e-4542-88eb-103e71aef693'::uuid, null, 1, 'PLAZA DE LA CIENCIA',
$txt$PLAZA DE LA CIENCIA
FUNCIONES Y PROCEDIMIENTOS

El servicio se cubre con un Guardia de Seguridad en el horario de 08,00 a 20,00 de lunes a domingo.
El guardia estará atento a los ingresos de escuelas y asistirá a los profesores que lo requieran en el desarrollo de las actividades.$txt$,
  repeat('0', 64),
  'whatsapp', 'WhatsApp de Aldo Monzón, mensaje del 10/10/2026 10:13:42; mensaje marcado «[Reenviado]»; línea 157 del archivo', '2026-10-10 10:13:42-03'::timestamptz,
  'docs/protocolos/aldo-monzon-2026-10/chat-original.txt (chat.txt de «Aldo Monzón.zip»)', '334bd80983d1945ba11b6d38f4dd24c6f3eada52d075e0e2e0f6284105bc6687',
  'pendiente_validacion', 'Aldo: «PLAZA DE LA CIENCIA». En la base: «PLAZA DE LAS CIENCIAS».', null
where exists (select 1 from public.objetivos o where o.id = 'af0341a8-3c4e-4542-88eb-103e71aef693'::uuid)
on conflict do nothing;

-- Obrador Baigorria · v1 · pendiente_validacion · sha256 d69fea0013cff675edfd32ad33900828084fae18cf4e59ed8e912e032640407c
insert into public.protocolo_versiones (
  objetivo_id, puesto_id, numero, titulo, texto, texto_sha256,
  fuente_tipo, fuente_descripcion, fuente_fecha, fuente_archivo, fuente_archivo_sha256,
  asociacion, asociacion_nota, notas
)
select '900056c3-1e35-4b72-8683-498c9c60fa14'::uuid, null, 1, 'LAROMET BAIGORRIA',
$txt$LAROMET BAIGORRIA
FUNCIONES Y PROCEDIMIENTOS

El servicio se cubre con un hombre los días viernes de 22,00 a 06,00 hs, en tanto que  los sábados lo hace un hombre de 22,00 hs hasta las 22 del domingo.
Durante las noches de viernes y sábado el guardia tomar servicio en la garita del fondo del predio y desde ahí realiza recorridos con marcación de puntos.
Los domingos de 06 a 22 permanece en la portería de ingreso controlando ingresos y egresos del personal que vaya a trabajar como así también los que viven en la casa dentro del predio. En la portería donde deben permanecer cuentan con cámaras que ve el guardia. El predio tiene wifi pero la señal no llega a la garita del fondo.$txt$,
  repeat('0', 64),
  'whatsapp', 'WhatsApp de Aldo Monzón, mensaje del 13/10/2026 11:50:56; línea 162 del archivo', '2026-10-13 11:50:56-03'::timestamptz,
  'docs/protocolos/aldo-monzon-2026-10/chat-original.txt (chat.txt de «Aldo Monzón.zip»)', '334bd80983d1945ba11b6d38f4dd24c6f3eada52d075e0e2e0f6284105bc6687',
  'pendiente_validacion', 'Aldo: «LAROMET BAIGORRIA». En la base: «Obrador Baigorria», cliente Laromet, Silvestre Begnis 1102.', null
where exists (select 1 from public.objetivos o where o.id = '900056c3-1e35-4b72-8683-498c9c60fa14'::uuid)
on conflict do nothing;

-- ── Diferencias pendientes (auditoría 14/10/2026) ──────────────────────────

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '7109a4cf-0f39-4f1f-8c23-6976bb98838c'::uuid, (select v.id from public.protocolo_versiones v where v.objetivo_id = '7109a4cf-0f39-4f1f-8c23-6976bb98838c'::uuid and v.puesto_id is null and v.numero = 2), 'version_documental', 'WhatsApp Aldo Monzón: mensaje 02/10/2026 14:05 y bloque «Mio Mercosur» (1/10 18:19) del mensaje 02/10/2026 15:42', 'El vigilador tendrá a su cargo la apertura del local y la desconexión del sistema de alarma.', 'Hay dos versiones del protocolo. Difieren en la alarma: la del bloque «Mio Mercosur» asigna desconexión al abrir y activación al cerrar; la de Aldo sólo dice «tiene que estar presente en la apertura del local». La más completa tiene fecha interna anterior. Elegir cuál se publica.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '7109a4cf-0f39-4f1f-8c23-6976bb98838c'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '7109a4cf-0f39-4f1f-8c23-6976bb98838c'::uuid
      and d.tipo = 'version_documental' and d.origen = 'WhatsApp Aldo Monzón: mensaje 02/10/2026 14:05 y bloque «Mio Mercosur» (1/10 18:19) del mensaje 02/10/2026 15:42');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select 'ac273ff2-71f6-4de2-ae4e-c0d518795dad'::uuid, null, 'version_documental', 'MEGA: CLIENTES/protocolos 2026/01 INSTRUCTIVO RANSTAD.docx (modificado 19/02/2026; contenido no cotejado)', null, 'Existe un instructivo anterior. Definir cuál rige.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = 'ac273ff2-71f6-4de2-ae4e-c0d518795dad'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = 'ac273ff2-71f6-4de2-ae4e-c0d518795dad'::uuid
      and d.tipo = 'version_documental' and d.origen = 'MEGA: CLIENTES/protocolos 2026/01 INSTRUCTIVO RANSTAD.docx (modificado 19/02/2026; contenido no cotejado)');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '335179ef-af0e-41e7-9a38-66a2da661f48'::uuid, null, 'version_documental', 'MEGA: CLIENTES/protocolos 2026/05 La Casona.docx (modificado 19/02/2026; contenido no cotejado)', null, 'Existe un instructivo anterior. Definir cuál rige.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '335179ef-af0e-41e7-9a38-66a2da661f48'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '335179ef-af0e-41e7-9a38-66a2da661f48'::uuid
      and d.tipo = 'version_documental' and d.origen = 'MEGA: CLIENTES/protocolos 2026/05 La Casona.docx (modificado 19/02/2026; contenido no cotejado)');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '874fcb68-07ff-4de8-a48c-3405c932a20b'::uuid, null, 'version_documental', 'MEGA: CLIENTES/protocolos 2026/06 skatepark norte.docx (modificado 19/02/2026; contenido no cotejado)', null, 'Existe un instructivo anterior. Definir cuál rige.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '874fcb68-07ff-4de8-a48c-3405c932a20b'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '874fcb68-07ff-4de8-a48c-3405c932a20b'::uuid
      and d.tipo = 'version_documental' and d.origen = 'MEGA: CLIENTES/protocolos 2026/06 skatepark norte.docx (modificado 19/02/2026; contenido no cotejado)');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '2ff263d8-a74e-4e36-914f-215b54510a4b'::uuid, null, 'version_documental', 'MEGA: CLIENTES/protocolos 2026/08 TEATRO LA COMEDIA.docx (modificado 19/02/2026; contenido no cotejado)', null, 'Existe un instructivo anterior. Definir cuál rige.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '2ff263d8-a74e-4e36-914f-215b54510a4b'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '2ff263d8-a74e-4e36-914f-215b54510a4b'::uuid
      and d.tipo = 'version_documental' and d.origen = 'MEGA: CLIENTES/protocolos 2026/08 TEATRO LA COMEDIA.docx (modificado 19/02/2026; contenido no cotejado)');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '66b1b991-8045-4883-86b9-3d2be32914a5'::uuid, null, 'version_documental', 'MEGA: CLIENTES/protocolos 2026/09 La Caja Compañia de Seguros.docx (modificado 19/02/2026; contenido no cotejado)', null, 'Existe un instructivo anterior. Definir cuál rige.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '66b1b991-8045-4883-86b9-3d2be32914a5'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '66b1b991-8045-4883-86b9-3d2be32914a5'::uuid
      and d.tipo = 'version_documental' and d.origen = 'MEGA: CLIENTES/protocolos 2026/09 La Caja Compañia de Seguros.docx (modificado 19/02/2026; contenido no cotejado)');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '790807dd-8283-4e6e-90bc-832226d016df'::uuid, null, 'version_documental', 'MEGA: CLIENTES/protocolos 2026/10 NACION SERVICIOS ENTRE RIOS 864.docx (modificado 19/02/2026; contenido no cotejado)', null, 'Existe un instructivo anterior. Definir cuál rige.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '790807dd-8283-4e6e-90bc-832226d016df'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '790807dd-8283-4e6e-90bc-832226d016df'::uuid
      and d.tipo = 'version_documental' and d.origen = 'MEGA: CLIENTES/protocolos 2026/10 NACION SERVICIOS ENTRE RIOS 864.docx (modificado 19/02/2026; contenido no cotejado)');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '946a50ec-e6cf-4995-80dc-6586178f9e3a'::uuid, null, 'version_documental', 'MEGA: CLIENTES/protocolos 2026/11 NACION SERVICIOS Santa Fe 1345.docx (modificado 19/02/2026; contenido no cotejado)', null, 'Existe un instructivo anterior. Definir cuál rige.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '946a50ec-e6cf-4995-80dc-6586178f9e3a'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '946a50ec-e6cf-4995-80dc-6586178f9e3a'::uuid
      and d.tipo = 'version_documental' and d.origen = 'MEGA: CLIENTES/protocolos 2026/11 NACION SERVICIOS Santa Fe 1345.docx (modificado 19/02/2026; contenido no cotejado)');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '7109a4cf-0f39-4f1f-8c23-6976bb98838c'::uuid, null, 'version_documental', 'MEGA: CLIENTES/protocolos 2026/12 Rapsodia.docx (modificado 19/02/2026; contenido no cotejado)', null, 'Existe un instructivo anterior. Definir cuál rige.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '7109a4cf-0f39-4f1f-8c23-6976bb98838c'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '7109a4cf-0f39-4f1f-8c23-6976bb98838c'::uuid
      and d.tipo = 'version_documental' and d.origen = 'MEGA: CLIENTES/protocolos 2026/12 Rapsodia.docx (modificado 19/02/2026; contenido no cotejado)');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '29fee8f6-493b-4e68-a09d-44808728a319'::uuid, null, 'version_documental', 'MEGA: CLIENTES/protocolos 2026/13 PSA.docx (modificado 19/02/2026; contenido no cotejado)', null, 'Existe un instructivo anterior. Definir cuál rige.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '29fee8f6-493b-4e68-a09d-44808728a319'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '29fee8f6-493b-4e68-a09d-44808728a319'::uuid
      and d.tipo = 'version_documental' and d.origen = 'MEGA: CLIENTES/protocolos 2026/13 PSA.docx (modificado 19/02/2026; contenido no cotejado)');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select 'a006b949-4b99-41a6-951c-22a6be1f7d92'::uuid, null, 'version_documental', 'MEGA: CLIENTES/protocolos 2026/16 PNC REMOLQUES.docx (modificado 19/02/2026; contenido no cotejado)', null, 'Existe un instructivo anterior. Definir cuál rige.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = 'a006b949-4b99-41a6-951c-22a6be1f7d92'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = 'a006b949-4b99-41a6-951c-22a6be1f7d92'::uuid
      and d.tipo = 'version_documental' and d.origen = 'MEGA: CLIENTES/protocolos 2026/16 PNC REMOLQUES.docx (modificado 19/02/2026; contenido no cotejado)');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '8f1e4b3c-23bc-464a-a2d3-66de8eb8d545'::uuid, null, 'version_documental', 'MEGA: CLIENTES/protocolos 2026/17 ACA.docx (modificado 19/02/2026; contenido no cotejado)', 'FUNCIONES Y PROCEDIMIENTOS ACTUALIZADAS', 'El texto de Aldo se titula «ACTUALIZADAS» y existe un instructivo anterior. Definir cuál rige.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '8f1e4b3c-23bc-464a-a2d3-66de8eb8d545'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '8f1e4b3c-23bc-464a-a2d3-66de8eb8d545'::uuid
      and d.tipo = 'version_documental' and d.origen = 'MEGA: CLIENTES/protocolos 2026/17 ACA.docx (modificado 19/02/2026; contenido no cotejado)');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select 'cb86521d-2ca2-4095-9110-394b3077d271'::uuid, null, 'version_documental', 'MEGA: CLIENTES/protocolos 2026/18 ANTENA RN.docx (modificado 19/02/2026; contenido no cotejado)', null, 'Existe un instructivo anterior. Definir cuál rige.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = 'cb86521d-2ca2-4095-9110-394b3077d271'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = 'cb86521d-2ca2-4095-9110-394b3077d271'::uuid
      and d.tipo = 'version_documental' and d.origen = 'MEGA: CLIENTES/protocolos 2026/18 ANTENA RN.docx (modificado 19/02/2026; contenido no cotejado)');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '76ef2bd4-38aa-45c2-b103-41997e7f77ad'::uuid, null, 'version_documental', 'MEGA: CLIENTES/protocolos 2026/22 UNINORTE.docx (modificado 19/02/2026; contenido no cotejado)', null, 'Existe un instructivo anterior. Definir cuál rige.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '76ef2bd4-38aa-45c2-b103-41997e7f77ad'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '76ef2bd4-38aa-45c2-b103-41997e7f77ad'::uuid
      and d.tipo = 'version_documental' and d.origen = 'MEGA: CLIENTES/protocolos 2026/22 UNINORTE.docx (modificado 19/02/2026; contenido no cotejado)');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '722723eb-543a-4a46-b1c3-b87f00c794ca'::uuid, null, 'version_documental', 'WhatsApp Aldo Monzón 03/10/2026 09:40', 'FUNCIONES Y PROCEDIMIENTOS ACTUALIZADAS', 'El título dice «ACTUALIZADAS»: puede haber una versión previa fuera del chat.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '722723eb-543a-4a46-b1c3-b87f00c794ca'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '722723eb-543a-4a46-b1c3-b87f00c794ca'::uuid
      and d.tipo = 'version_documental' and d.origen = 'WhatsApp Aldo Monzón 03/10/2026 09:40');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '946a50ec-e6cf-4995-80dc-6586178f9e3a'::uuid, null, 'asociacion_objetivo', 'WhatsApp Aldo Monzón 01/10/2026 15:30', 'NACION SERVICIOS
UBICACIÓN SANTA FE 1345 ROSARIO', 'Coincidencia probable con «NACION SANTA FE»: confirmar.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '946a50ec-e6cf-4995-80dc-6586178f9e3a'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '946a50ec-e6cf-4995-80dc-6586178f9e3a'::uuid
      and d.tipo = 'asociacion_objetivo' and d.origen = 'WhatsApp Aldo Monzón 01/10/2026 15:30');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '8f1e4b3c-23bc-464a-a2d3-66de8eb8d545'::uuid, null, 'asociacion_objetivo', 'WhatsApp Aldo Monzón 03/10/2026 09:41', 'AUTOMOVIL CLUB ARGENTINO (ACA)', 'Coincidencia probable con «ACA» (Rosario, activo). Existe «ACA SANTA FE» inactivo: confirmar.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '8f1e4b3c-23bc-464a-a2d3-66de8eb8d545'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '8f1e4b3c-23bc-464a-a2d3-66de8eb8d545'::uuid
      and d.tipo = 'asociacion_objetivo' and d.origen = 'WhatsApp Aldo Monzón 03/10/2026 09:41');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select 'cb86521d-2ca2-4095-9110-394b3077d271'::uuid, null, 'asociacion_objetivo', 'WhatsApp Aldo Monzón 03/10/2026 09:41', 'ANTENA RADIO NACIONAL', 'Coincidencia probable con «ANTENA»: confirmar.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = 'cb86521d-2ca2-4095-9110-394b3077d271'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = 'cb86521d-2ca2-4095-9110-394b3077d271'::uuid
      and d.tipo = 'asociacion_objetivo' and d.origen = 'WhatsApp Aldo Monzón 03/10/2026 09:41');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '76ef2bd4-38aa-45c2-b103-41997e7f77ad'::uuid, null, 'asociacion_objetivo', 'WhatsApp Aldo Monzón 03/10/2026 09:41', 'CLUB UNIVERSITARIO (UNINORTE)', 'Coincidencia probable con «CLUB» (cliente «Club»): confirmar.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '76ef2bd4-38aa-45c2-b103-41997e7f77ad'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '76ef2bd4-38aa-45c2-b103-41997e7f77ad'::uuid
      and d.tipo = 'asociacion_objetivo' and d.origen = 'WhatsApp Aldo Monzón 03/10/2026 09:41');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '6fa49177-49ac-464e-99f5-333fdfd05d00'::uuid, null, 'asociacion_objetivo', 'WhatsApp Aldo Monzón 10/10/2026 10:13', 'PAZA DE LA COOPERACION', 'Coincidencia probable (error de tipeo en el original): confirmar.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '6fa49177-49ac-464e-99f5-333fdfd05d00'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '6fa49177-49ac-464e-99f5-333fdfd05d00'::uuid
      and d.tipo = 'asociacion_objetivo' and d.origen = 'WhatsApp Aldo Monzón 10/10/2026 10:13');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select 'af0341a8-3c4e-4542-88eb-103e71aef693'::uuid, null, 'asociacion_objetivo', 'WhatsApp Aldo Monzón 10/10/2026 10:13', 'PLAZA DE LA CIENCIA', 'Coincidencia probable (singular/plural): confirmar.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = 'af0341a8-3c4e-4542-88eb-103e71aef693'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = 'af0341a8-3c4e-4542-88eb-103e71aef693'::uuid
      and d.tipo = 'asociacion_objetivo' and d.origen = 'WhatsApp Aldo Monzón 10/10/2026 10:13');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '900056c3-1e35-4b72-8683-498c9c60fa14'::uuid, null, 'asociacion_objetivo', 'WhatsApp Aldo Monzón 13/10/2026 11:50', 'LAROMET BAIGORRIA', 'Coincidencia probable con «Obrador Baigorria» (cliente Laromet): confirmar.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '900056c3-1e35-4b72-8683-498c9c60fa14'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '900056c3-1e35-4b72-8683-498c9c60fa14'::uuid
      and d.tipo = 'asociacion_objetivo' and d.origen = 'WhatsApp Aldo Monzón 13/10/2026 11:50');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '8f1e4b3c-23bc-464a-a2d3-66de8eb8d545'::uuid, null, 'frecuencia_ronda', 'rondas_base «Gaurdia» (intervalo 120 min)', 'Realizará recorridas con marcación de puntos sin horarios ni tiempos determinados, con mayor asiduidad en los horarios de menor movimiento de personas.', 'La app exige una ronda cada 120 min (genera alertas y alimenta la nota); el protocolo dice expresamente que no hay horarios ni tiempos determinados.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '8f1e4b3c-23bc-464a-a2d3-66de8eb8d545'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '8f1e4b3c-23bc-464a-a2d3-66de8eb8d545'::uuid
      and d.tipo = 'frecuencia_ronda' and d.origen = 'rondas_base «Gaurdia» (intervalo 120 min)');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select 'cb86521d-2ca2-4095-9110-394b3077d271'::uuid, null, 'frecuencia_ronda', 'rondas_base «Antena» (intervalo 90 min, desde 22:00)', 'El vigilador cuenta con espacio para resguardarse y debe realizar recorridas por el predio.', 'La app exige una ronda cada 90 min; el protocolo no fija frecuencia.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = 'cb86521d-2ca2-4095-9110-394b3077d271'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = 'cb86521d-2ca2-4095-9110-394b3077d271'::uuid
      and d.tipo = 'frecuencia_ronda' and d.origen = 'rondas_base «Antena» (intervalo 90 min, desde 22:00)');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '722723eb-543a-4a46-b1c3-b87f00c794ca'::uuid, null, 'frecuencia_ronda', 'rondas_base «Cirse» (intervalo 120 min, desde 22:00)', 'El guardia de seguridad debe recorrer el predio, con marcación y cuando hay eventos controlar el ingreso de personas, sin realizar registros en planilla.', 'La app exige una ronda cada 120 min; el protocolo no fija frecuencia.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '722723eb-543a-4a46-b1c3-b87f00c794ca'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '722723eb-543a-4a46-b1c3-b87f00c794ca'::uuid
      and d.tipo = 'frecuencia_ronda' and d.origen = 'rondas_base «Cirse» (intervalo 120 min, desde 22:00)');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '900056c3-1e35-4b72-8683-498c9c60fa14'::uuid, null, 'frecuencia_ronda', 'rondas_base «Laromet baigorria» (intervalo 120 min)', 'Durante las noches de viernes y sábado el guardia tomar servicio en la garita del fondo del predio y desde ahí realiza recorridos con marcación de puntos.', 'La app exige una ronda cada 120 min; el protocolo no fija frecuencia.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '900056c3-1e35-4b72-8683-498c9c60fa14'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '900056c3-1e35-4b72-8683-498c9c60fa14'::uuid
      and d.tipo = 'frecuencia_ronda' and d.origen = 'rondas_base «Laromet baigorria» (intervalo 120 min)');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '335179ef-af0e-41e7-9a38-66a2da661f48'::uuid, null, 'frecuencia_ronda', 'rondas_base «Guardia» (intervalo 120 min, ventanas fijas)', 'Realizará recorridas con marcación de puntos por el predio cada 2 horas como tiempo máximo entre rondas.', 'Coincide el intervalo, pero la app mide ventanas fijas: dos rondas «cumplidas» pueden quedar hasta ~4 h separadas. El protocolo fija un máximo entre rondas.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '335179ef-af0e-41e7-9a38-66a2da661f48'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '335179ef-af0e-41e7-9a38-66a2da661f48'::uuid
      and d.tipo = 'frecuencia_ronda' and d.origen = 'rondas_base «Guardia» (intervalo 120 min, ventanas fijas)');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '76ef2bd4-38aa-45c2-b103-41997e7f77ad'::uuid, null, 'ronda_faltante', 'rondas_base: sin ronda configurada', 'Cuando no hay actividad se efectuaran recorridas con marcación cada una hora.', 'El protocolo pide recorridas con marcación cada una hora (condicional a la actividad) y no hay ronda configurada.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '76ef2bd4-38aa-45c2-b103-41997e7f77ad'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '76ef2bd4-38aa-45c2-b103-41997e7f77ad'::uuid
      and d.tipo = 'ronda_faltante' and d.origen = 'rondas_base: sin ronda configurada');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '8a6b4a85-5276-4c77-921f-b30c64166ad6'::uuid, null, 'ronda_faltante', 'rondas_base: sin ronda configurada', 'Inmediatamente comenzará a realizar recorridas por el predio con marcación de rondas.', 'El protocolo pide recorridas con marcación y no hay ronda configurada.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '8a6b4a85-5276-4c77-921f-b30c64166ad6'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '8a6b4a85-5276-4c77-921f-b30c64166ad6'::uuid
      and d.tipo = 'ronda_faltante' and d.origen = 'rondas_base: sin ronda configurada');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select 'a006b949-4b99-41a6-951c-22a6be1f7d92'::uuid, null, 'ronda_faltante', 'rondas_base: sin ronda configurada', 'Realizará recorridas por el predio con marcaciones.', 'El protocolo pide recorridas con marcación y no hay ronda configurada.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = 'a006b949-4b99-41a6-951c-22a6be1f7d92'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = 'a006b949-4b99-41a6-951c-22a6be1f7d92'::uuid
      and d.tipo = 'ronda_faltante' and d.origen = 'rondas_base: sin ronda configurada');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '946a50ec-e6cf-4995-80dc-6586178f9e3a'::uuid, null, 'ronda_faltante', 'rondas_base «Nación Santa fe» (60 min, INACTIVA, sin puntos)', 'En el turno noche se envían reportes y se realizan rondines cada dos horas.', 'El protocolo pide rondines cada dos horas en el turno noche; la única ronda está inactiva y sin puntos.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '946a50ec-e6cf-4995-80dc-6586178f9e3a'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '946a50ec-e6cf-4995-80dc-6586178f9e3a'::uuid
      and d.tipo = 'ronda_faltante' and d.origen = 'rondas_base «Nación Santa fe» (60 min, INACTIVA, sin puntos)');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select 'cb86521d-2ca2-4095-9110-394b3077d271'::uuid, null, 'horario', 'WhatsApp Aldo Monzón 03/10/2026 09:41 / turnos programados', 'El servicio será cubierto por un vigilador en el horario de 12,00 hs a 07,00 hs., en tanto que sábados y domingos el servicio será de un Guardia de Seguridad las 24 horas.', '«12,00 a 07,00» son 19 h; los turnos programados promedian ~10 h. Posible error de tipeo: confirmar con Aldo.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = 'cb86521d-2ca2-4095-9110-394b3077d271'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = 'cb86521d-2ca2-4095-9110-394b3077d271'::uuid
      and d.tipo = 'horario' and d.origen = 'WhatsApp Aldo Monzón 03/10/2026 09:41 / turnos programados');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '78350006-6fcf-43dc-9457-447aa9fba71e'::uuid, null, 'horario', 'WhatsApp Aldo Monzón 03/10/2026 15:36', 'El servicio se cubrirá con un (01) Guardia de Seguridad en el horario de 09,00 a 19,00 y dos (02) efectivos de 13,00 hs a 19,00 hs.', 'No indica qué días de la semana corresponde esa cobertura.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '78350006-6fcf-43dc-9457-447aa9fba71e'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '78350006-6fcf-43dc-9457-447aa9fba71e'::uuid
      and d.tipo = 'horario' and d.origen = 'WhatsApp Aldo Monzón 03/10/2026 15:36');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '790807dd-8283-4e6e-90bc-832226d016df'::uuid, null, 'asignacion_puesto', 'puestos Vigilador 1 / Vigilador 2 / Vigilador 3', 'Las tareas de los Guardias de Seguridad se reparten en dos, las principales son: ... Y las tareas de refuerzo a saber: ...', 'Definir qué posición diurna (Vigilador 1 o 2) hace las tareas principales y cuál las de refuerzo. El texto menciona un solo vigilador diurno y hay dos posiciones diurnas.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '790807dd-8283-4e6e-90bc-832226d016df'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '790807dd-8283-4e6e-90bc-832226d016df'::uuid
      and d.tipo = 'asignacion_puesto' and d.origen = 'puestos Vigilador 1 / Vigilador 2 / Vigilador 3');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '78350006-6fcf-43dc-9457-447aa9fba71e'::uuid, null, 'asignacion_puesto', 'puestos Principal / Vigilador 2 / Vigilador 3', 'Uno de los vigiladores deberá permanecer en hall de ingreso principal y los dos restantes recorriendo distintos sectores del edificio', 'Definir qué puesto queda fijo en el hall.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '78350006-6fcf-43dc-9457-447aa9fba71e'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '78350006-6fcf-43dc-9457-447aa9fba71e'::uuid
      and d.tipo = 'asignacion_puesto' and d.origen = 'puestos Principal / Vigilador 2 / Vigilador 3');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '6fa49177-49ac-464e-99f5-333fdfd05d00'::uuid, null, 'redaccion', 'WhatsApp Aldo Monzón 10/10/2026 10:13', 'El guardia debe permanecer en el sector de depósito y debiendo abrir y mantener la puerta principal cerrada.', 'Redacción ambigua («abrir y mantener ... cerrada»): aclarar con Aldo.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '6fa49177-49ac-464e-99f5-333fdfd05d00'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '6fa49177-49ac-464e-99f5-333fdfd05d00'::uuid
      and d.tipo = 'redaccion' and d.origen = 'WhatsApp Aldo Monzón 10/10/2026 10:13');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '874fcb68-07ff-4de8-a48c-3405c932a20b'::uuid, null, 'redaccion', 'WhatsApp Aldo Monzón 30/09/2026 14:16', 'realizando rondas de marcación por el predio por espacio no superiores a los 30 minutos.', 'Puede leerse como intervalo máximo entre rondas o como duración máxima de cada ronda. La app tiene configurado un intervalo de 30 min.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '874fcb68-07ff-4de8-a48c-3405c932a20b'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '874fcb68-07ff-4de8-a48c-3405c932a20b'::uuid
      and d.tipo = 'redaccion' and d.origen = 'WhatsApp Aldo Monzón 30/09/2026 14:16');

insert into public.protocolo_diferencias (objetivo_id, version_id, tipo, origen, referencia_original, descripcion, registro_origen)
select '874fcb68-07ff-4de8-a48c-3405c932a20b'::uuid, null, 'excepcion_operativa', 'WhatsApp Aldo Monzón 30/09/2026 14:16 / ronda_alertas', 'En momentos de lluvia o condiciones climáticas adversas permanecerá en el edificio de “La Casona”, ubicado a menos de 100 metros del lugar.', 'La permanencia en La Casona por clima, el uso de sanitarios y la cobertura de La Casona si no llega la policía no tienen forma de registrarse: hoy figuran como rondas no realizadas.', 'auditoria_20261014'
where exists (select 1 from public.objetivos o where o.id = '874fcb68-07ff-4de8-a48c-3405c932a20b'::uuid)
  and not exists (
    select 1 from public.protocolo_diferencias d
    where d.registro_origen = 'auditoria_20261014' and d.objetivo_id = '874fcb68-07ff-4de8-a48c-3405c932a20b'::uuid
      and d.tipo = 'excepcion_operativa' and d.origen = 'WhatsApp Aldo Monzón 30/09/2026 14:16 / ronda_alertas');

commit;
