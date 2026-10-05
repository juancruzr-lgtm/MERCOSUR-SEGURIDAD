-- 20261005180000_extras_fijas_septiembre
-- Carga de EXTRAS FIJAS mensuales (columna EXTRA/AP) con vigencia abierta desde
-- 2026-09 ("fijas hasta que se cambien"), vía el RPC canónico set_extra_mensual
-- (cierra la vigencia previa si la hubiera e inserta la nueva). Idempotente:
-- reejecutar sólo actualiza el importe del período.
--
-- Supervisores operativos (requieren el cambio de código #253 para reflejarse):
--   Aranda 300.000 · Sergio Martínez 400.000 · Jose Luis Martínez 250.000
-- Administrativos (ya usaban la EXTRA fija): $115.389,10 c/u
--   joel juarez · Laura M · Andrea Narvarte · juan cruz romero · Rodolfo Romero ·
--   Facundo Romero (gerencia, usuario real 5a8e3f70; el 1b248b6f es un perfil de
--   prueba y NO se toca).
do $$
begin
  perform public.set_extra_mensual('251289de-c16c-4315-969c-c8ee574ff7c1'::uuid, 300000,    '2026-09'); -- ARANDA (supervisor)
  perform public.set_extra_mensual('69493cc2-15d6-4618-893e-4a9b1d044df8'::uuid, 400000,    '2026-09'); -- SERGIO MARTINEZ (jefe_supervisores)
  perform public.set_extra_mensual('2b51e32a-f493-46cc-82ee-6880a8c715b8'::uuid, 250000,    '2026-09'); -- JOSE LUIS MARTINEZ (supervisor, sin CUIL)
  perform public.set_extra_mensual('a2cd1908-7e9d-4bf4-8407-ecf644e1f351'::uuid, 115389.10, '2026-09'); -- JUAREZ JOEL (administracion)
  perform public.set_extra_mensual('1384746c-0520-4ebe-8d7b-17788d833cba'::uuid, 115389.10, '2026-09'); -- MAGARO LAURA (administracion)
  perform public.set_extra_mensual('eecd4b5c-095d-4062-be10-25e78ea9f499'::uuid, 115389.10, '2026-09'); -- NARVARTE ANDREA (administracion)
  perform public.set_extra_mensual('3a8e3c04-f4f5-48c4-8830-73edccb73667'::uuid, 115389.10, '2026-09'); -- ROMERO JUAN CRUZ (gerencia)
  perform public.set_extra_mensual('3731aa27-ce78-4817-8faa-66ad1edfabaa'::uuid, 115389.10, '2026-09'); -- ROMERO RODOLFO (direccion_operativa)
  perform public.set_extra_mensual('5a8e3f70-77ef-4f89-8332-b9878f32a293'::uuid, 115389.10, '2026-09'); -- ROMERO FACUNDO (gerencia, real)
end $$;
