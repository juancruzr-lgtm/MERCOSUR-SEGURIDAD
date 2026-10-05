-- Rollback de 20261005180000_extras_fijas_septiembre
-- No existía extra vigente previa para ninguno (todas abiertas en 2026-09), así que
-- el rollback elimina exactamente las filas creadas por este parche.
delete from public.liquidacion_extra_mensual
 where vigencia_desde = '2026-09-01'
   and usuario_id in (
     '251289de-c16c-4315-969c-c8ee574ff7c1',
     '69493cc2-15d6-4618-893e-4a9b1d044df8',
     '2b51e32a-f493-46cc-82ee-6880a8c715b8',
     'a2cd1908-7e9d-4bf4-8407-ecf644e1f351',
     '1384746c-0520-4ebe-8d7b-17788d833cba',
     'eecd4b5c-095d-4062-be10-25e78ea9f499',
     '3a8e3c04-f4f5-48c4-8830-73edccb73667',
     '3731aa27-ce78-4817-8faa-66ad1edfabaa',
     '5a8e3f70-77ef-4f89-8332-b9878f32a293'
   );
