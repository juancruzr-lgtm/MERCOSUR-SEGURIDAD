-- Rollback 20261220161000_auditorias_solo_agregar: vuelve a los grants, policies y FK
-- vivos de producción leídos el 20/11/2026. Correr como archivo aparte, nunca junto a
-- la migración.
--
-- Las FK se vuelven a crear NOT VALID: mientras la migración estuvo aplicada pudieron
-- quedar filas de auditoría cuyo padre se borró (justamente lo que se quería conservar);
-- validar la FK fallaría con ellas. NOT VALID aplica la regla (y el CASCADE) a partir de
-- ahora sin exigirla sobre lo existente.

do $$
declare
  t text;
begin
  foreach t in array array[
    'registros_asistencia_auditoria', 'turnos_auditoria', 'liquidacion_auditoria',
    'servicios_objetivo_auditoria', 'generacion_turnos_auditoria', 'puestos_auditoria',
    'jwm_sync_log']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('grant update, delete, truncate on table public.%I to authenticated', t);
    end if;
  end loop;
  if to_regclass('public.correccion_turno_manual_log') is not null then
    grant truncate on table public.correccion_turno_manual_log to authenticated;
  end if;
end $$;

drop policy if exists liquidacion_auditoria_lectura on public.liquidacion_auditoria;
drop policy if exists liquidacion_auditoria_alta on public.liquidacion_auditoria;
create policy liquidacion_auditoria_liquidacion on public.liquidacion_auditoria as permissive for all to authenticated
  using (puede_liquidar_actual())
  with check (puede_liquidar_actual());

alter table public.registros_asistencia_auditoria add constraint registros_asistencia_auditoria_registro_id_fkey
  foreign key (registro_id) references public.registros_asistencia(id) on delete cascade not valid;
alter table public.turnos_auditoria add constraint turnos_auditoria_turno_id_fkey
  foreign key (turno_id) references public.turnos(id) on delete cascade not valid;
do $$ begin
  if to_regclass('public.objetivos_auditoria') is not null then
    alter table public.objetivos_auditoria add constraint objetivos_auditoria_objetivo_id_fkey
      foreign key (objetivo_id) references public.objetivos(id) on delete cascade not valid;
  end if;
  if to_regclass('public.ronda_puntos_auditoria') is not null then
    alter table public.ronda_puntos_auditoria add constraint ronda_puntos_auditoria_ronda_punto_id_fkey
      foreign key (ronda_punto_id) references public.ronda_puntos(id) on delete cascade not valid;
  end if;
  if to_regclass('public.liquidacion_periodo') is not null then
    alter table public.liquidacion_auditoria add constraint liquidacion_auditoria_periodo_id_fkey
      foreign key (periodo_id) references public.liquidacion_periodo(id) on delete cascade not valid;
  end if;
end $$;
