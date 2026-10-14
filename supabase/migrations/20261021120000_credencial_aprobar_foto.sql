-- Aprobar la foto de la credencial corrigiendo el vencimiento.
--
-- El documento guarda tal cual lo que declaró el vigilador (no se modifica). Si al
-- revisar la foto Administración lee otro vencimiento en la tarjeta (p. ej. el
-- vigilador dejó la fecha del día), lo corrige al aprobar: la credencial queda
-- registrada con la fecha correcta y la corrección queda en el historial.
-- El trigger de 20261018120000 ve la credencial ya registrada para ese documento y
-- sólo encola la copia al servidor.
--
-- Rollback: supabase/rollback/20261021120000_credencial_aprobar_foto_rollback.sql

begin;

create or replace function public.credencial_aprobar_foto(p_documento_id uuid, p_vence_el date, p_numero text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare d public.documentacion_documentos%rowtype; t public.habilitacion_tramites%rowtype;
        v_num text := nullif(btrim(coalesce(p_numero, '')), ''); v_cierra boolean; v_corrige boolean;
begin
  if not public.documentacion_puede_gestionar() then raise exception 'Sólo Administración o Gerencia' using errcode = '42501'; end if;
  d := (select x from public.documentacion_documentos x where x.id = p_documento_id);
  if d.id is null or d.tipo <> 'credencial' then raise exception 'No es una foto de credencial'; end if;
  if d.estado <> 'pendiente_revision' then raise exception 'Esta foto ya fue revisada'; end if;
  if p_vence_el is null or p_vence_el < date '2000-01-01' or p_vence_el > current_date + interval '15 years' then
    raise exception 'La fecha de vencimiento no es válida'; end if;
  if v_num is not null and v_num !~ '^[A-Za-z0-9 ./-]{1,40}$' then raise exception 'El número de credencial no es válido'; end if;
  v_corrige := p_vence_el is distinct from d.vence_el;
  t := (select x from public.habilitacion_tramites x where x.empleado_id = d.empleado_id and x.estado in ('en_curso','presentado')
         order by x.abierto_at desc limit 1);
  v_cierra := t.id is not null and p_vence_el > current_date;
  update public.habilitacion_credenciales c
     set anulada_at = now(), anulada_por = public.documentacion_usuario_actual(),
         motivo_anulacion = 'Reemplazada por la foto de la credencial aprobada en Documentación'
   where c.empleado_id = d.empleado_id and c.anulada_at is null and not c.verificada;
  insert into public.habilitacion_credenciales (id, empleado_id, numero, fecha_emision, vence_el, documento_id, tramite_id, verificada, observacion, registrada_por)
  values (gen_random_uuid(), d.empleado_id, v_num, d.fecha_emision, p_vence_el, d.id, case when v_cierra then t.id end, true,
          'Foto de la credencial aprobada en Documentación'
            || case when v_corrige then ' · vencimiento corregido al revisar: el vigilador había puesto ' || coalesce(to_char(d.vence_el, 'DD/MM/YYYY'), '—') else '' end,
          public.documentacion_usuario_actual());
  if v_cierra then
    update public.habilitacion_tramites set estado = 'emitido', cerrado_at = now(), ultimo_movimiento_at = now() where id = t.id;
  end if;
  perform public.habilitacion_registrar_evento(d.empleado_id, case when v_cierra then t.id end, 'credencial_registrada', jsonb_build_object(
    'vence_el', p_vence_el, 'vence_declarado', d.vence_el, 'corregido', v_corrige, 'numero', v_num, 'verificada', true,
    'documento_id', d.id, 'observacion', 'Foto aprobada en Documentación', 'cierra_tramite', v_cierra));
  -- Aprueba el documento (el trigger encola la copia al servidor y no duplica la credencial).
  perform public.documentacion_revisar(d.id, 'aprobar', null);
  return jsonb_build_object('vence_el', p_vence_el, 'corregido', v_corrige, 'tramite_cerrado', v_cierra);
end;
$fn$;

revoke all on function public.credencial_aprobar_foto(uuid, date, text) from public, anon;
grant execute on function public.credencial_aprobar_foto(uuid, date, text) to authenticated;

notify pgrst, 'reload schema';

commit;
