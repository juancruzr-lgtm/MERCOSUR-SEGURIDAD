-- ============================================================================
-- MATRIZ DE PERMISOS EN VIVO — Supervisores de guardia (PR #279)
--
-- CUÁNDO: inmediatamente DESPUÉS de aplicar 20261008190000 en producción.
-- CÓMO: pegar entero en el SQL Editor. Simula a cada persona real con el
-- patrón de la casa (request.jwt + set local role) y TERMINA EN EXCEPCIÓN a
-- propósito: el "error" final ES el reporte, y garantiza el ROLLBACK de todas
-- las filas de prueba. No deja ningún cambio.
--
-- Personas simuladas: ARANDA (supervisor, Rosario), WILHJELM (supervisor,
-- Rafaela), MARTINEZ SERGIO (jefe_supervisores), ROMERO JC (gerencia).
-- Esperado: 14 líneas, todas "OK".
-- ============================================================================
begin;

do $do$
declare
  a_aranda text; a_wil text; a_sergio text; a_jc text;
  g_ros uuid; g_raf uuid; v_n int; v_rep text := ''; v_origen text; v_motivo text;
begin
  select auth_user_id::text into a_aranda from usuarios where id='251289de-c16c-4315-969c-c8ee574ff7c1';
  select auth_user_id::text into a_wil    from usuarios where id='a4084933-c7a8-41bf-9767-2148eb5833bb';
  select auth_user_id::text into a_sergio from usuarios where id='69493cc2-15d6-4618-893e-4a9b1d044df8';
  select auth_user_id::text into a_jc     from usuarios where id='3a8e3c04-f4f5-48c4-8830-73edccb73667';

  -- Filas de prueba (como sistema): Rosario y Rafaela, a 30 días.
  insert into supervisores_guardia (id, supervisor_id, fecha, hora_inicio, hora_fin, zona, rol_operativo, estado, tipo_evento, observacion)
  values (gen_random_uuid(), '251289de-c16c-4315-969c-c8ee574ff7c1', current_date + 30, '07:00','19:00','Rosario','supervisor','activo','normal','TEST-RLS')
  returning id into g_ros;
  insert into supervisores_guardia (id, supervisor_id, fecha, hora_inicio, hora_fin, zona, rol_operativo, estado, tipo_evento, observacion)
  values (gen_random_uuid(), 'a4084933-c7a8-41bf-9767-2148eb5833bb', current_date + 30, '07:00','19:00','Rafaela','supervisor','activo','normal','TEST-RLS')
  returning id into g_raf;
  select origen into v_origen from supervisores_guardia_auditoria where guardia_id=g_ros;
  v_rep := v_rep || '0 Alta como sistema auditada origen=' || coalesce(v_origen,'SIN AUDITORIA') || E'\n';

  -- ===== ARANDA (supervisor, Rosario) =====
  perform set_config('request.jwt.claim.sub', a_aranda, true);
  perform set_config('request.jwt.claims', '{"sub":"'||a_aranda||'","role":"authenticated"}', true);
  set local role authenticated;

  select count(*) into v_n from supervisores_guardia where id = g_ros;
  v_rep := v_rep || '1 Aranda ve su zona: ' || case when v_n=1 then 'OK' else 'FALLO' end || E'\n';
  select count(*) into v_n from supervisores_guardia where id = g_raf;
  v_rep := v_rep || '2 Aranda NO ve Rafaela: ' || case when v_n=0 then 'OK' else 'FALLO: la ve' end || E'\n';

  update supervisores_guardia set observacion='HACK' where id = g_ros;
  get diagnostics v_n = row_count;
  v_rep := v_rep || '3 Aranda UPDATE directo: ' || case when v_n=0 then 'OK bloqueado' else 'FALLO: '||v_n||' filas' end || E'\n';

  begin
    insert into supervisores_guardia (supervisor_id, fecha, hora_inicio, hora_fin, zona, rol_operativo, estado)
    values ('251289de-c16c-4315-969c-c8ee574ff7c1', current_date + 31, '07:00','19:00','Rosario','supervisor','activo');
    v_rep := v_rep || '4 Aranda INSERT directo: FALLO (pasó)' || E'\n';
  exception when others then
    v_rep := v_rep || '4 Aranda INSERT directo: OK bloqueado (' || SQLSTATE || ')' || E'\n';
  end;

  begin
    delete from supervisores_guardia where id = g_ros;
    v_rep := v_rep || '5 Aranda DELETE: FALLO (pasó)' || E'\n';
  exception when others then
    v_rep := v_rep || '5 Aranda DELETE: OK bloqueado (' || SQLSTATE || ')' || E'\n';
  end;

  perform guardia_excepcion_supervisor('modificar', g_ros, '{"hora_inicio":"08:00"}'::jsonb, 'Cobertura por ausencia del titular');
  select origen, motivo into v_origen, v_motivo from supervisores_guardia_auditoria
   where guardia_id=g_ros and accion='modificar' order by created_at desc limit 1;
  v_rep := v_rep || '6 Aranda RPC su zona c/motivo: ' ||
    case when v_origen='excepcion_supervisor' and v_motivo like 'Cobertura%' then 'OK auditada' else 'FALLO origen='||coalesce(v_origen,'?') end || E'\n';

  begin
    perform guardia_excepcion_supervisor('modificar', g_raf, '{"hora_inicio":"08:00"}'::jsonb, 'Motivo valido de prueba');
    v_rep := v_rep || '7 Aranda RPC zona ajena: FALLO (pasó)' || E'\n';
  exception when others then
    v_rep := v_rep || '7 Aranda RPC zona ajena: OK rechazada' || E'\n';
  end;

  begin
    perform guardia_excepcion_supervisor('modificar', g_ros, '{"hora_inicio":"09:00"}'::jsonb, '');
    v_rep := v_rep || '8 Aranda RPC sin motivo: FALLO (pasó)' || E'\n';
  exception when others then
    v_rep := v_rep || '8 Aranda RPC sin motivo: OK rechazada' || E'\n';
  end;

  begin
    perform guardia_excepcion_supervisor('crear', null,
      ('{"fecha":"'||(current_date-1)||'","hora_inicio":"07:00","hora_fin":"19:00","zona":"Rosario"}')::jsonb,
      'Motivo valido de prueba');
    v_rep := v_rep || '9 Aranda RPC fecha pasada: FALLO (pasó)' || E'\n';
  exception when others then
    v_rep := v_rep || '9 Aranda RPC fecha pasada: OK rechazada' || E'\n';
  end;

  -- ===== WILHJELM (supervisor, Rafaela) =====
  reset role;
  perform set_config('request.jwt.claim.sub', a_wil, true);
  perform set_config('request.jwt.claims', '{"sub":"'||a_wil||'","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_n from supervisores_guardia where id = g_ros;
  v_rep := v_rep || '10 Wilhjelm NO ve Rosario: ' || case when v_n=0 then 'OK' else 'FALLO' end || E'\n';

  -- ===== SERGIO (jefe de supervisores) =====
  reset role;
  perform set_config('request.jwt.claim.sub', a_sergio, true);
  perform set_config('request.jwt.claims', '{"sub":"'||a_sergio||'","role":"authenticated"}', true);
  set local role authenticated;
  select count(*) into v_n from supervisores_guardia where id in (g_ros, g_raf);
  v_rep := v_rep || '11 Jefe ve todas las zonas: ' || case when v_n=2 then 'OK' else 'FALLO' end || E'\n';
  update supervisores_guardia set observacion='ajuste jefatura' where id = g_raf;
  get diagnostics v_n = row_count;
  select origen into v_origen from supervisores_guardia_auditoria
   where guardia_id=g_raf and accion='modificar' order by created_at desc limit 1;
  v_rep := v_rep || '12 Jefe UPDATE directo: ' ||
    case when v_n=1 and v_origen='jefatura' then 'OK auditado jefatura' else 'FALLO' end || E'\n';
  begin
    delete from supervisores_guardia where id = g_raf;
    v_rep := v_rep || '13 Jefe DELETE: FALLO (pasó)' || E'\n';
  exception when others then
    v_rep := v_rep || '13 Jefe DELETE: OK bloqueado (nadie borra)' || E'\n';
  end;

  -- ===== JC (gerencia) =====
  reset role;
  perform set_config('request.jwt.claim.sub', a_jc, true);
  perform set_config('request.jwt.claims', '{"sub":"'||a_jc||'","role":"authenticated"}', true);
  set local role authenticated;
  insert into supervisores_guardia (supervisor_id, fecha, hora_inicio, hora_fin, zona, rol_operativo, estado)
  values ('251289de-c16c-4315-969c-c8ee574ff7c1', current_date + 32, '19:00','07:00','Rosario','supervisor','activo');
  v_rep := v_rep || '14 Gerencia INSERT directo: OK' || E'\n';

  reset role;
  -- La excepción ES el reporte, y fuerza el rollback de todo lo de arriba.
  raise exception using message = E'REPORTE MATRIZ DE PERMISOS (todo revertido):\n' || v_rep;
end $do$;

rollback;  -- por si alguien quita el raise: nada de esto debe persistir jamás
