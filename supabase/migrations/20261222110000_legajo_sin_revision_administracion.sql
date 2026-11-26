-- ============================================================================
-- Legajo: lo que carga el vigilador entra DIRECTO, sin revisión de Administración
-- (JC, 24/11/2026: "no vamos a ir a mirar a ningún lado ... se pone aceptar de
-- manera mecánica, es un paso de más")
-- ============================================================================
-- 1. Datos personales: todos los campos que el vigilador puede cargar dejan de
--    requerir validación (legajo_campos.requiere_validacion = false). Se aplican
--    al legajo al guardar y quedan en el historial (legajo_cambios_datos,
--    estado 'aplicado', con valor anterior y nuevo).
--    Fecha de ingreso sigue siendo sólo de Administración (no cambia).
-- 2. DNI que sube el vigilador: queda 'aprobado' al terminar de subirse
--    (documentacion_confirmar). La CREDENCIAL se sigue revisando: de esa
--    revisión salen el número y el vencimiento de la habilitación.
--    Se modifica sólo esa condición, sobre la definición viva de la función.
-- 3. Lo que hoy espera revisión se aprueba de una vez:
--    datos del vigilador en 'pendiente' -> 'aprobado' y aplicados al legajo;
--    DNI del vigilador en 'pendiente_revision' -> 'aprobado'.
--
-- Rollback: supabase/rollback/20261222110000_legajo_sin_revision_administracion_rollback.sql
--   (vuelve a pedir revisión para lo nuevo; lo ya aprobado queda aprobado)
-- ============================================================================

begin;

-- 1. Datos sin revisión
update public.legajo_campos
   set requiere_validacion = false
 where vigilador_propone and requiere_validacion;

-- 2. DNI del vigilador aprobado al subirse
do $do$
declare
  v_def text := pg_get_functiondef('public.documentacion_confirmar(uuid)'::regprocedure);
  v_buscar text := 'v_estado := case when v_doc.origen = ''vigilador'' or v_doc.tipo = ''credencial'' then';
  v_nuevo text := 'v_estado := case when v_doc.origen = ''vigilador'' and v_doc.tipo = ''dni'' then ''aprobado'' when v_doc.origen = ''vigilador'' or v_doc.tipo = ''credencial'' then';
begin
  if (length(v_def) - length(replace(v_def, v_buscar, ''))) / length(v_buscar) <> 1 then
    raise exception 'documentacion_confirmar no tiene la condición esperada: no se modifica';
  end if;
  execute replace(v_def, v_buscar, v_nuevo);
end
$do$;

-- 3. Aprobar lo pendiente
do $do$
declare r record;
begin
  for r in
    select c.id, c.empleado_id, c.campo, c.valor_nuevo, c.creado_por
      from public.legajo_cambios_datos c
     where c.estado = 'pendiente' and c.origen = 'vigilador'
     order by c.creado_at
  loop
    perform public.legajo_aplicar(r.empleado_id, r.campo, r.valor_nuevo, r.creado_por);
    update public.legajo_cambios_datos set estado = 'aprobado', revisado_at = now() where id = r.id;
  end loop;

  for r in
    select d.id from public.documentacion_documentos d
     where d.estado = 'pendiente_revision' and d.tipo = 'dni' and d.origen = 'vigilador'
     order by d.creado_at
  loop
    update public.documentacion_documentos set estado = 'aprobado', revisado_at = now() where id = r.id;
    perform public.documentacion_reemplazar_anteriores(r.id, array['aprobado', 'aceptado']);
    perform public.documentacion_registrar_evento(r.id, 'aprobado', jsonb_build_object('automatico', '20261222110000'));
  end loop;
end
$do$;

commit;
