# Lectura de solicitudes de empleo con Gemini: condiciones previas

**Estado: APAGADO.** Ninguna solicitud real se envía a Gemini mientras `IA_SOLICITUDES_HABILITADA` (servidor) y `NEXT_PUBLIC_IA_SOLICITUDES_HABILITADA` (pantallas) no valgan `1`.

Este documento lista lo que hay que **verificar y dejar documentado** antes de encenderlo. La solicitud en papel contiene datos personales y también datos sensibles (salud, antecedentes) que no se extraen, pero que **sí están en la imagen** que se envía.

## 1. Facturación y términos del proyecto de Google (bloqueante)

- [ ] En Google AI Studio → *API keys*, identificar el **proyecto** de la clave `GEMINI_API_KEY` que está en Vercel.
- [ ] Confirmar que ese proyecto tiene **facturación activa** (Cloud Billing vinculado).
  - Con facturación activa aplican los términos de **servicios pagos**: Google no usa las instrucciones, las imágenes ni las respuestas para mejorar sus productos. Ver la [documentación de facturación de la API de Gemini](https://ai.google.dev/gemini-api/docs/billing).
  - En el **nivel gratuito**, Google sí puede usarlas y personas pueden revisarlas. **Con el nivel gratuito, no se habilita.**
- [ ] Guardar una captura de la pantalla de facturación y la fecha de verificación en el legajo de cumplimiento.
- [ ] Revisar y aceptar el **Data Processing Addendum** de Google Cloud aplicable a la API de Gemini. Lo debe hacer un apoderado.
- [ ] Alternativa con residencia de datos: Vertex AI en la región `southamerica-east1` (São Paulo), con el mismo modelo. Requiere cambiar `lib/ia/gemini.ts` a Vertex; **no está implementado**.

> La misma clave ya procesa unas 12.000 fotos operativas (uniforme y libro de guardia). Esta verificación también las cubre.

## 2. Ley 25.326 de Protección de Datos Personales

- [ ] **Consentimiento informado** del postulante (arts. 5 y 6), firmado en la solicitud. Texto sugerido, para validar con un asesor legal:
  > "Autorizo a Mercosur Seguridad a tratar los datos de esta solicitud para evaluar mi postulación y, si ingreso, para mi legajo laboral. Sé que la solicitud puede ser leída con un servicio de inteligencia artificial de un proveedor externo (Google) que la procesa fuera de la Argentina, sólo para transcribirla. Puedo pedir acceso, rectificación o supresión de mis datos en [contacto]."
- [ ] **Transferencia internacional** (art. 12): queda cubierta por el consentimiento expreso y las cláusulas contractuales de Google. Validarlo con un asesor legal.
- [ ] **Registro de la base** "Personal y postulantes" en la AAIP (art. 21).
- [ ] Actualizar `app/privacidad`: hoy sólo menciona WhatsApp (Meta). Agregar Google (Gemini) como encargado del tratamiento, la finalidad y el plazo de conservación.

## 3. Minimización (ya implementada)

- La IA **no transcribe** grupo sanguíneo, enfermedades, medicación, causas judiciales, conflictos laborales, armas, nombres de los padres, con quién vive, si fuma ni la firma.
  - Así lo indican las instrucciones (`lib/solicitud-lectura.ts`).
  - El formato de respuesta no tiene lugar para esos datos.
  - El servidor descarta cualquier campo que no esté en el catálogo.
  - La tabla `postulaciones` no tiene columnas para ellos.
- **Recomendación:** nueva versión del formulario en papel que no pregunte salud, antecedentes ni datos de familia. Lo que haga falta (por ejemplo, el certificado de antecedentes) se pide en el trámite de habilitación.
- **Postulantes descartados:** sus datos y la foto se pueden eliminar desde `eliminar_desde` (180 días). **Falta** la tarea automática de borrado; hoy se hace a mano.

## 4. Controles técnicos (ya implementados)

- La foto original va a un bucket privado `postulaciones`, sin políticas de Storage. Sólo la ve quien tiene permiso, mediante un enlace de 60 segundos, y cada apertura queda registrada.
- La lectura la autoriza la base con la sesión del usuario: quien puede editar esa postulación.
- Límites: 5 lecturas por solicitud y 40 por persona por día.
- Doble lectura de DNI, CUIL, fecha de nacimiento y celular con un segundo modelo.
- Controles de formato y coherencia (dígito verificador del CUIL, CUIL↔DNI, edad, característica del celular). Cada campo que no cierra queda **dudoso**.
- La lectura **no guarda nada**: la persona confirma cada dato dudoso y guarda. No se puede marcar "revisada" una postulación con datos dudosos.
- Registro de cada lectura en `postulacion_lecturas_ia`: quién, modelo, tokens, costo estimado y resultado saneado. Es inmutable.

## 5. Encendido

1. Completar las secciones 1 y 2.
2. Probar con 2 o 3 solicitudes **reales con consentimiento** y la cuenta de prueba. Comparar campo por campo contra el papel.
3. `IA_SOLICITUDES_HABILITADA=1` y `NEXT_PUBLIC_IA_SOLICITUDES_HABILITADA=1` en Vercel. Después, nuevo deploy.
4. Revisar el costo real en `postulacion_lecturas_ia` (precios en `PRECIOS_USD_MILLON`; verificarlos en la página oficial).
