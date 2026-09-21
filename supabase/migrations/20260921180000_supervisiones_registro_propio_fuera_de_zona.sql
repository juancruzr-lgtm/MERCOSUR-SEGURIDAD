-- ============================================================================
-- Supervisiones: permitir registrar la PROPIA aunque el objetivo esté fuera de zona
-- ============================================================================
--
-- JC (21/09): la supervisión es un REGISTRO de una visita. Un supervisor debe poder
-- GUARDAR la suya aunque el objetivo esté fuera de su zona (a veces se supervisan
-- entre ellos). Ajuste sobre Fase 2C (#241): a la vía por ZONA
-- (alcanza_objetivo_actual) se le SUMA la vía PROPIA (supervisor_id = el actor).
--
-- Efecto: cada operador ve/crea/edita/borra sus propias supervisiones en cualquier
-- objetivo, y además las de su zona (globales, todas). Vigilador sigue afuera
-- (no es supervisor_id de ninguna supervisión y alcance='propio'=false). No amplía
-- lo que un supervisor ve de OTROS fuera de su zona.
--
-- fotos/respuestas heredan la misma regla vía alcanza_supervision_actual.
--
-- ROLLBACK: supabase/rollback/20260921180000_supervisiones_registro_propio_fuera_de_zona_rollback.sql
-- ============================================================================

begin;

-- supervisiones: alcance por ZONA, o PROPIA (sólo OPERADORES — es_operador_actual
-- excluye al vigilador, que no puede autoinsertarse una supervisión por RLS directa).
drop policy if exists supervisiones_alcance on public.supervisiones;
create policy supervisiones_alcance on public.supervisiones
  for all to authenticated
  using (
    public.alcanza_objetivo_actual(objetivo_id)
    or (public.es_operador_actual() and supervisor_id in (select u.id from public.usuarios u where u.auth_user_id = auth.uid()))
  )
  with check (
    public.alcanza_objetivo_actual(objetivo_id)
    or (public.es_operador_actual() and supervisor_id in (select u.id from public.usuarios u where u.auth_user_id = auth.uid()))
  );

-- fotos/respuestas: heredan alcance del padre O supervisión propia (operador).
create or replace function public.alcanza_supervision_actual(p_supervision_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
  select exists (
    select 1
    from public.supervisiones s
    where s.id = p_supervision_id
      and (
        public.alcanza_objetivo_actual(s.objetivo_id)
        or (public.es_operador_actual() and s.supervisor_id in (select u.id from public.usuarios u where u.auth_user_id = auth.uid()))
      )
  )
$function$;

commit;

notify pgrst, 'reload schema';
