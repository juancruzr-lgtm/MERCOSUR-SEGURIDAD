-- Verificación POST de 20260908120000_alcance_operativo_canonico.sql
-- Una sola sentencia (union all). POST esperado: todas las líneas en 'OK'.
-- Usa las primitivas reales para probar la tabla de decisión por persona.
with esperado(quien, uid, alcance_esp) as (
  values
    ('Juan Cruz (gerencia)',      '3a8e3c04-f4f5-48c4-8830-73edccb73667'::uuid, 'todas'),
    ('Rodolfo (dir_op)',          '3731aa27-ce78-4817-8faa-66ad1edfabaa'::uuid, 'todas'),
    ('Aldo (jefe)',               '023769de-9e99-481a-9caa-c604ef56b14b'::uuid, 'todas'),
    ('Sergio (supervisor)',       '69493cc2-15d6-4618-893e-4a9b1d044df8'::uuid, 'zonas_asignadas'),
    ('Acosta (supervisor)',       '7a401cb9-dbbc-45e6-9781-bbde62a66120'::uuid, 'zonas_asignadas'),
    ('Joel (administracion)',     'a2cd1908-7e9d-4bf4-8407-ecf644e1f351'::uuid, 'todas')
)
select 'alcance: '||e.quien as chequeo,
       case when public.alcance_operativo_de(e.uid) = e.alcance_esp
            then 'OK' else 'REVISAR: '||coalesce(public.alcance_operativo_de(e.uid),'null') end as estado
from esperado e
union all
-- Sergio alcanza objetivos de su zona (>0) pero no todos
select 'Sergio alcanza >0 y < total de objetivos',
       case when (
         select count(*) from public.objetivos o
         where public.alcanza_objetivo('69493cc2-15d6-4618-893e-4a9b1d044df8'::uuid, o.id)
       ) between 1 and (select count(*)-1 from public.objetivos)
       then 'OK' else 'REVISAR' end
union all
-- Un vigilador no alcanza ningún objetivo por zona
select 'vigilador no alcanza objetivos por zona',
       case when (
         select count(*) from public.objetivos o
         where public.alcanza_objetivo((select id from public.usuarios where estado='activo' and puesto_organizacional='vigilador' limit 1), o.id)
       ) = 0 then 'OK' else 'REVISAR' end
union all
-- Juan Cruz (todas) alcanza todos los objetivos
select 'gerencia alcanza todos los objetivos',
       case when (
         select count(*) from public.objetivos o
         where public.alcanza_objetivo('3a8e3c04-f4f5-48c4-8830-73edccb73667'::uuid, o.id)
       ) = (select count(*) from public.objetivos) then 'OK' else 'REVISAR' end;
