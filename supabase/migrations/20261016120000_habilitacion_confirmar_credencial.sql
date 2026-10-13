-- Confirmar una credencial informada (sin verificar) sin volver a cargarla.
--
-- Las credenciales recuperadas de planillas quedaron «informadas, sin verificar».
-- Administración, al ver la credencial (o la constancia de Control de Agencias),
-- la confirma con un clic: agrega el número si lo tiene y corrige las fechas sólo
-- si no coinciden. Queda en el historial. No cierra trámites (la credencial ya existía).
--
-- Rollback: supabase/rollback/20261016120000_habilitacion_confirmar_credencial_rollback.sql

begin;

create or replace function public.habilitacion_confirmar_credencial(
  p_id uuid, p_observacion text, p_numero text default null, p_vence_el date default null, p_fecha_emision date default null
)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare
  c public.habilitacion_credenciales%rowtype;
  v_num text := nullif(btrim(coalesce(p_numero, '')), '');
  v_obs text := nullif(btrim(coalesce(p_observacion, '')), '');
  v_vence date; v_emision date;
begin
  if not public.documentacion_puede_gestionar() then raise exception 'Sólo Administración o Gerencia' using errcode = '42501'; end if;
  c := (select x from public.habilitacion_credenciales x where x.id = p_id);
  if c.id is null or c.anulada_at is not null then raise exception 'Credencial inexistente o anulada'; end if;
  if c.verificada then raise exception 'La credencial ya está verificada'; end if;
  if v_obs is null or char_length(v_obs) < 5 then raise exception 'Escribí cómo la verificaste (p. ej.: vi la credencial, consulta en Control de Agencias)'; end if;
  if v_num is not null and v_num !~ '^[A-Za-z0-9 ./-]{1,40}$' then raise exception 'El número de credencial no es válido'; end if;
  v_vence := coalesce(p_vence_el, c.vence_el);
  v_emision := coalesce(p_fecha_emision, c.fecha_emision);
  if v_vence < date '2000-01-01' or v_vence > current_date + interval '15 years' then raise exception 'La fecha de vencimiento no es válida'; end if;
  if v_emision is not null and (v_emision > current_date or v_emision > v_vence) then raise exception 'La fecha de emisión no es válida'; end if;
  update public.habilitacion_credenciales
     set verificada = true, numero = coalesce(v_num, numero), vence_el = v_vence, fecha_emision = v_emision,
         observacion = left(coalesce(observacion || ' · ', '') || 'Verificada: ' || v_obs, 500)
   where id = c.id;
  perform public.habilitacion_registrar_evento(c.empleado_id, c.tramite_id, 'credencial_verificada', jsonb_build_object(
    'observacion', v_obs, 'numero', coalesce(v_num, c.numero),
    'vence_antes', c.vence_el, 'vence_el', v_vence, 'corrigio_vencimiento', v_vence is distinct from c.vence_el));
  return jsonb_build_object('estado', 'verificada', 'vence_el', v_vence);
end;
$fn$;

revoke all on function public.habilitacion_confirmar_credencial(uuid, text, text, date, date) from public, anon;
grant execute on function public.habilitacion_confirmar_credencial(uuid, text, text, date, date) to authenticated;

notify pgrst, 'reload schema';

commit;
