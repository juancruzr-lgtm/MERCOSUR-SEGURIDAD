-- Saneamiento de las observaciones de IA anteriores al criterio vigente.
--
-- POR QUE HACE FALTA UN ESTADO NUEVO
-- La revision humana solo tenia dos salidas: CORRECTO ("la IA acerto") e
-- INCORRECTO ("la IA se equivoco"). Ninguna de las dos sirve para cerrar el
-- backlog viejo:
--
--   · CORRECTO afirmaria que la observacion era cierta, o sea generaria un
--     incumplimiento del vigilador que nadie verifico;
--   · INCORRECTO afirmaria lo contrario, convirtiendo en evidencia correcta
--     algo que tampoco nadie miro, y ademas ensuciaria las metricas de
--     precision y la memoria visual, que son justo lo que se usa para mejorar
--     la IA.
--
-- Por eso se agrega SANEADO: no es un juicio sobre la foto ni sobre la persona.
-- Dice lo unico que realmente paso —se cerro administrativamente porque quedo
-- fuera del criterio vigente— y queda distinguible para siempre de una decision
-- humana real.
--
-- QUE NO TOCA
-- No borra fotos ni filas. No modifica clasificacion_ia, clasificacion_efectiva,
-- resultado_json, motivos ni resumen: la prediccion original de la IA queda
-- exactamente como fue. Y como SANEADO no entra en ninguno de los contadores de
-- ia_punto_memoria (que filtran por CORRECTO / INCORRECTO / PENDIENTE), tampoco
-- distorsiona el aprendizaje.
--
-- EL CORTE NO SE HARDCODEA
-- Sale de ia_configuraciones: el instante en que se activo la lista blanca
-- (motivosQueHabilitanRevisar) es la entrada en vigencia del criterio nuevo.
-- Si manana se cambia el criterio, el corte se mueve solo.

alter table public.evidencia_analisis
  drop constraint if exists evidencia_analisis_revision_estado_check;
alter table public.evidencia_analisis
  add constraint evidencia_analisis_revision_estado_check
  check (revision_estado in ('PENDIENTE', 'CORRECTO', 'INCORRECTO', 'SANEADO'));

alter table public.evidencia_analisis_revisiones
  drop constraint if exists evidencia_analisis_revisiones_decision_check;
alter table public.evidencia_analisis_revisiones
  add constraint evidencia_analisis_revisiones_decision_check
  check (decision in ('CORRECTO', 'INCORRECTO', 'SANEADO'));

comment on column public.evidencia_analisis.revision_estado is
  'PENDIENTE | CORRECTO | INCORRECTO | SANEADO. SANEADO es cierre administrativo: '
  'no afirma nada sobre la evidencia ni sobre el vigilador, y queda fuera de las '
  'metricas de precision de la IA.';

notify pgrst, 'reload schema';
