-- Rollback de 20261221120000_asistencia_jefatura_y_auditoria_por_alcance.sql
-- Deshace exactamente los tres reemplazos y quita la política de lectura.
drop policy if exists registros_asistencia_auditoria_select_alcance on public.registros_asistencia_auditoria;

do $mig$
declare
  d text;
  reemplazos constant text[][] := array[
    ['public.cerrar_turno(uuid,jsonb,text)',
     $a$IF v_turno_revisado_por IS NOT NULL AND v_rol <> 'admin'
     AND NOT coalesce(public.puede_autorizar_excepcion_asistencia(v_usuario_id), false) THEN$a$,
     $a$IF v_turno_revisado_por IS NOT NULL AND v_rol <> 'admin' THEN$a$],
    ['public.anular_registro_manual(uuid,text)',
     $a$if v_rol is distinct from 'admin'
     and not coalesce(public.puede_autorizar_excepcion_asistencia(v_usuario_id), false) then$a$,
     $a$if v_rol is distinct from 'admin' then$a$],
    ['public.anular_registro_manual(uuid,text)',
     $a$if v_rol is distinct from 'admin' and not public.alcanza_turno_actual(v_turno_id) then
    raise exception 'FUERA_DE_ALCANCE: el turno de este registro no está en tu alcance operativo'
      using errcode = '42501';
  end if;

  if v_tipo_registro <> 'carga_manual' then$a$,
     $a$if v_tipo_registro <> 'carga_manual' then$a$]
  ];
  i int;
  n int;
begin
  for i in 1 .. array_length(reemplazos, 1) loop
    d := pg_get_functiondef(reemplazos[i][1]::regprocedure);
    n := (length(d) - length(replace(d, reemplazos[i][2], ''))) / length(reemplazos[i][2]);
    if n <> 1 then
      raise exception 'Cuerpo de % distinto del esperado (% coincidencias)', reemplazos[i][1], n;
    end if;
    execute replace(d, reemplazos[i][2], reemplazos[i][3]);
  end loop;
end
$mig$;
