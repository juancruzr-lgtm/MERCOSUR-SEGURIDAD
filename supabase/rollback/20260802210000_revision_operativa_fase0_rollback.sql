-- Rollback Fase 0 Revisión Operativa. Ejecutar solamente si la migración fue aplicada.

revoke all on function public.registrar_intervencion_operativa(uuid, uuid, text, text, uuid, text, text, uuid, boolean) from authenticated;
revoke all on function public.registrar_intervencion_operativa(uuid, uuid, text, text, uuid, text, text, uuid, boolean) from service_role;
drop function if exists public.registrar_intervencion_operativa(uuid, uuid, text, text, uuid, text, text, uuid, boolean);

drop policy if exists "Revision operativa insercion autenticada" on public.supervisor_intervenciones;
drop policy if exists "Revision operativa lectura por alcance" on public.supervisor_intervenciones;

grant select, insert, update, delete on table public.supervisor_intervenciones to authenticated;

create policy "Admin acceso total supervisor intervenciones"
on public.supervisor_intervenciones
for all
using (true);

drop index if exists public.supervisor_intervenciones_ocurrencia_idx;
drop index if exists public.supervisor_intervenciones_operacion_id_uidx;

alter table public.supervisor_intervenciones
  drop column if exists resultado_json,
  drop column if exists solicitud_json,
  drop column if exists reapertura_de_id,
  drop column if exists operacion_id;
