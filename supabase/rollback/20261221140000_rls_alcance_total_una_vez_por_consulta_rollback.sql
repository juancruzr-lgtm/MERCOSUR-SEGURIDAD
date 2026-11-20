-- Rollback de 20261221140000_rls_alcance_total_una_vez_por_consulta.sql (expresiones de hoy)
alter policy registros_asistencia_alcance_total on public.registros_asistencia
  using (public.alcance_operativo_de(public.rondas_usuario_actual_id()) = 'todas')
  with check (public.alcance_operativo_de(public.rondas_usuario_actual_id()) = 'todas');

alter policy registros_asistencia_select_alcance on public.registros_asistencia
  using (public.alcanza_turno_actual(turno_id));

alter policy turnos_alcance_operativo on public.turnos
  using (public.alcanza_objetivo_actual(objetivo_id))
  with check (public.alcanza_objetivo_actual(objetivo_id));

alter policy supervisiones_select_alcance on public.supervisiones
  using (public.alcanza_objetivo_actual(objetivo_id)
         or (public.es_operador_actual() and supervisor_id in (select u.id from public.usuarios u where u.auth_user_id = auth.uid())));
