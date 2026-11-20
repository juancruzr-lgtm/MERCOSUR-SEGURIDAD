-- Rendimiento: el «alcance total» del usuario se calcula UNA vez por consulta, no por fila.
--
-- Mismo resultado: sólo se agrega, delante, un atajo `(select alcance) = 'todas'` que
-- implica lo que ya devolvía cada política (alcanza_objetivo / alcanza_turno con alcance
-- 'todas' es siempre verdadero, y registros_asistencia_alcance_total ya daba todo a ese
-- alcance). Comprobado con los usuarios reales (13 perfiles): mismas filas en
-- registros_asistencia, turnos y supervisiones.
--
-- Medido en producción (Administración, sin cambiar nada): el filtro de registros pasa de
-- ~2.500 ms a ~3 ms. La carga mensual de asistencias tardaba 3,9 s de promedio (máx. 6,2 s,
-- cerca del corte de 8 s).

alter policy registros_asistencia_alcance_total on public.registros_asistencia
  using ((select public.alcance_operativo_de(public.rondas_usuario_actual_id())) = 'todas')
  with check ((select public.alcance_operativo_de(public.rondas_usuario_actual_id())) = 'todas');

alter policy registros_asistencia_select_alcance on public.registros_asistencia
  using ((select public.alcance_operativo_de(public.rondas_usuario_actual_id())) = 'todas'
         or public.alcanza_turno_actual(turno_id));

alter policy turnos_alcance_operativo on public.turnos
  using ((select public.alcance_operativo_de(public.rondas_usuario_actual_id())) = 'todas'
         or public.alcanza_objetivo_actual(objetivo_id))
  with check ((select public.alcance_operativo_de(public.rondas_usuario_actual_id())) = 'todas'
         or public.alcanza_objetivo_actual(objetivo_id));

alter policy supervisiones_select_alcance on public.supervisiones
  using ((select public.alcance_operativo_de(public.rondas_usuario_actual_id())) = 'todas'
         or public.alcanza_objetivo_actual(objetivo_id)
         or (public.es_operador_actual() and supervisor_id in (select u.id from public.usuarios u where u.auth_user_id = auth.uid())));
