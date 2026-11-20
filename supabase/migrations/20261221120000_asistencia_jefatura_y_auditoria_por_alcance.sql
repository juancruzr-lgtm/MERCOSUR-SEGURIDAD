-- Asistencias: permisos de supervisión según puesto y alcance (no según el rol legado).
--
-- Sólo permisos. No cambia cálculos de horas, tramos, coberturas ni períodos.
--
-- 1. Historial de correcciones (registros_asistencia_auditoria): además de Administración,
--    lo consulta quien alcanza el turno (supervisor: su zona; jefatura: su alcance).
--    Sólo lectura: la tabla sigue siendo de sólo agregar.
--
-- 2. cerrar_turno: volver a cerrar un turno ya revisado lo podía hacer sólo el rol legado
--    'admin'. Ahora también jefatura de supervisores y Dirección Operativa
--    (puede_autorizar_excepcion_asistencia), dentro de su alcance (paso 5 sin cambios).
--    El supervisor de zona sigue sin poder volver a cerrarlo.
--
-- 3. anular_registro_manual: además del rol legado 'admin', jefatura de supervisores y
--    Dirección Operativa, y sólo sobre turnos de su alcance. Sigue siendo sólo para cargas
--    manuales y la anulación conserva el registro (marca + horas en 0 + auditoría).
--
-- 2 y 3 reemplazan únicamente la condición indicada dentro del cuerpo vigente
-- (pg_get_functiondef): si el cuerpo no coincide, la migración falla sin tocar nada.

create policy registros_asistencia_auditoria_select_alcance
  on public.registros_asistencia_auditoria
  as permissive for select to authenticated
  using (public.alcanza_turno_actual(turno_id));

do $mig$
declare
  d text;
  reemplazos constant text[][] := array[
    ['public.cerrar_turno(uuid,jsonb,text)',
     $a$IF v_turno_revisado_por IS NOT NULL AND v_rol <> 'admin' THEN$a$,
     $a$IF v_turno_revisado_por IS NOT NULL AND v_rol <> 'admin'
     AND NOT coalesce(public.puede_autorizar_excepcion_asistencia(v_usuario_id), false) THEN$a$],
    ['public.anular_registro_manual(uuid,text)',
     $a$if v_rol is distinct from 'admin' then$a$,
     $a$if v_rol is distinct from 'admin'
     and not coalesce(public.puede_autorizar_excepcion_asistencia(v_usuario_id), false) then$a$],
    ['public.anular_registro_manual(uuid,text)',
     $a$if v_tipo_registro <> 'carga_manual' then$a$,
     $a$if v_rol is distinct from 'admin' and not public.alcanza_turno_actual(v_turno_id) then
    raise exception 'FUERA_DE_ALCANCE: el turno de este registro no está en tu alcance operativo'
      using errcode = '42501';
  end if;

  if v_tipo_registro <> 'carga_manual' then$a$]
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
