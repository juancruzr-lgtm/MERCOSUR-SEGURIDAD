-- La lista de escalamiento tambien puede incluir supervisores.
--
-- El escalamiento de 30 minutos va al "grupo de supervisores y directivos". La
-- primera version solo admitia jefe_supervisores, operaciones y direccion, y
-- dejaba afuera el caso mas simple: sumar a un supervisor concreto que la
-- empresa quiere que se entere aunque no sea el responsable de esa zona.
--
-- No cambia nada de lo ya cargado: solo agrega un valor permitido.

begin;

alter table public.escalamiento_destinatarios
  drop constraint if exists escalamiento_destinatarios_rol_check;

alter table public.escalamiento_destinatarios
  add constraint escalamiento_destinatarios_rol_check
  check (rol_en_escalamiento in (
    'jefe_supervisores',
    'operaciones',
    'direccion',
    'supervisor',
    'otro'
  ));

comment on table public.escalamiento_destinatarios is
  'Quienes reciben el escalamiento de 30 minutos por puesto descubierto. '
  'Apunta a usuarios existentes: el telefono sale de usuarios.telefono y se '
  'edita en la pantalla de Guardias, NUNCA se copia aca. El nivel de 15 no se '
  'configura en esta tabla: sale de la guardia operativa vigente en el horario '
  'del turno (supervisores_guardia) y, si no hay, del responsable unico de zona.';

notify pgrst, 'reload schema';

commit;
