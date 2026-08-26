-- El techo de volumen del Entrenador, configurable.
--
-- El cooldown por tipo impedia repetir el MISMO tema, pero no impedia que
-- alguien con cuatro dimensiones flojas recibiera cuatro mensajes distintos en
-- cuatro corridas seguidas: uno de procedimiento, otro de puntualidad, otro de
-- rondas, otro de uniforme. Desde el telefono eso no se lee como cuatro
-- consejos; se lee como que el sistema le encontro cuatro cosas mal en una
-- semana.
--
-- Catorce dias entre CUALQUIER par de mensajes a la misma persona: da tiempo a
-- que aplique lo que se le dijo antes de senalarle lo siguiente. Va en
-- app_config y no en el codigo porque es exactamente el numero que hay que
-- poder ajustar cuando la operacion muestre que molesta.

insert into public.app_config (key, value, description) values
  ('entrenamiento_cooldown_global_dias', '14',
   'Dias minimos entre dos entrenamientos operativos a la MISMA persona, sea cual sea el tema. 0 = sin techo.')
on conflict (key) do nothing;
