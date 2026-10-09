-- Archivo histórico: clasificación e identificación sobre el ÍNDICE del agente.
--
-- ── Qué resuelve ─────────────────────────────────────────────────────────────
-- El índice del agente (repositorio_documental, ~153 mil filas) sólo tiene
-- ruta, nombre, extensión y hash. Estas funciones proponen, SIN leer el
-- contenido de los archivos:
--   * la CATEGORÍA del catálogo, por palabras del nombre del archivo
--     (evidencia "archivo") o de la carpeta (evidencia "carpeta"); las
--     categorías inactivas se marcan como históricas y lo que no va al legajo
--     (recibos, licencias, contratos, comunicaciones) como "fuera del legajo";
--   * la PERSONA, con criterios verificables:
--       inequivoca  el nombre completo (todos los apellidos y nombres) de UN
--                   usuario está dentro de un mismo tramo de la ruta (el nombre
--                   del archivo o una carpeta) y ningún otro usuario coincide en
--                   apellido + primer nombre; o el DNI de un único usuario.
--       probable    apellido completo + primer nombre de un único usuario en la
--                   ruta (no necesariamente en el mismo tramo).
--       dudosa      sólo coinciden apellidos, o hay más de un candidato.
--       sin_identificar  ningún usuario de la app.
--   Un DNI que figura en más de una persona de la app nunca identifica a nadie.
--
-- Nada de esto aprueba ni asocia: la carga (sólo inequívocas, sólo por quien
-- administra la base) crea PROPUESTAS pendientes de revisión, idempotentes por
-- hash, reversibles descartándolas. No copia ni toca archivos.
--
-- Rollback: supabase/rollback/20261010120000_legajo_historico_indice_rollback.sql

begin;

-- Texto en mayúsculas, sin tildes, sólo letras y números separados por un espacio.
create or replace function public.legajo_historico_normalizar(p text)
returns text language sql immutable set search_path = public, pg_catalog as $fn$
  select trim(regexp_replace(upper(translate(coalesce(p, ''), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNAEIOUUN')), '[^A-Z0-9]+', ' ', 'g'))
$fn$;

-- Categoría por palabras clave. Devuelve código (del catálogo o fuera del legajo) y la palabra que la decidió.
create or replace function public.legajo_historico_categoria_de_texto(p text)
returns table (codigo text, clave text)
language sql immutable set search_path = public, pg_catalog as $fn$
  with t as (select ' ' || public.legajo_historico_normalizar(p) || ' ' as x),
  reglas(orden, codigo, patron) as (values
    (1,  'actuaciones_legales',    ' (AUDIENCIA|CEDULA|CONCILIACION|DEMANDA|SECLO|MEDIACION) '),
    (2,  'cartas_documento',       ' (CARTA DOCUMENTO|CARTA DOC|TELEGRAMA|CD) '),
    (3,  'sanciones',              ' (APERCIBIMIENTO|APERCIBIMIENTOS|SANCION|SANCIONES|SUSPENSION|LLAMADO DE ATENCION) '),
    (4,  'antecedentes_rnr',       ' (REINCIDENCIA|RNR|ANTECEDENTES NACION|ANTECEDENTES NACIONALES) '),
    (5,  'antecedentes_provincia', ' (ANTECEDENTE|ANTECEDENTES|CONDUCTA|PRONTUARIO) '),
    (6,  'acta_credencial',        ' (ACTA CREDENCIAL|ACTA DE CREDENCIAL|ENTREGA DE CREDENCIAL|ENTREGA CREDENCIAL) '),
    (7,  'art51',                  ' (ART 51|ARTICULO 51|ANEXO III) '),
    (8,  'credencial',             ' (CREDENCIAL|CREDENCIALES|CARNET) '),
    (9,  'cuil',                   ' (CUIL) '),
    (10, 'dni',                    ' (DNI|DOCUMENTO NACIONAL) '),
    (11, 'baja_arca',              ' (BAJA|BAJAS) '),
    (12, 'svo',                    ' (SEGURO DE VIDA|SVO) '),
    (13, 'alta_art',               ' (ART|ASEGURADORA DE RIESGO) '),
    (14, 'alta_arca',              ' (ALTA|ALTA TEMPRANA|ALTAS) '),
    (15, 'codem',                  ' (CODEM) '),
    (16, 'estudios_medicos',       ' (PSICOTECNICO|PSICOFISICO|PREOCUPACIONAL|APTO MEDICO|ELECTROCARDIOGRAMA|LABORATORIO|ESTUDIOS MEDICOS) '),
    (17, 'cursos',                 ' (CURSO|CURSOS|CAPACITACION|CAPACITACIONES) '),
    (18, 'entrega_epp',            ' (UNIFORME|UNIFORMES|EPP|ROPA|INDUMENTARIA) '),
    (19, 'domicilio',              ' (DOMICILIO) '),
    (20, 'sindicato',              ' (SINDICATO|AFILIACION|UPSRA) '),
    (21, 'embargos',               ' (EMBARGO|EMBARGOS) '),
    (22, 'secundario',             ' (SECUNDARIO|ANALITICO|TITULO SECUNDARIO) '),
    (23, 'solicitud_empleo',       ' (SOLICITUD DE EMPLEO|CURRICULUM|CV) '),
    -- Fuera del legajo (se identifican, no se proponen como documentación exigible)
    (30, 'fuera:recibo_sueldo',    ' (RECIBO|RECIBOS|REC|SUELDO|SUELDOS|LIQUIDACION|AGUINALDO|SAC) '),
    (31, 'fuera:licencia',         ' (LICENCIA|LICENCIAS|REPOSO|CERTIFICADO MEDICO) '),
    (32, 'fuera:contrato',         ' (CONTRATO|CONTRATOS|HOMOLOGACION|HOMOLOGACIONES) '),
    (33, 'fuera:comunicacion',     ' (NOTA|NOTAS|CIRCULAR|CIRCULARES|COMUNICADO|MEMORANDUM) '),
    (34, 'fuera:empresa',          ' (PODER|PODERES|DEUDORES|MOROSOS|ESTATUTO SOCIAL|CONTRATO SOCIAL) '),
    (0,  'fuera:siniestro',        ' (SINIESTRO|SINIESTROS|ACCIDENTE|ACCIDENTES) ')
  )
  select r.codigo, (regexp_match((select x from t), r.patron))[1]
  from reglas r
  where (select x from t) ~ r.patron
  order by r.orden
  limit 1
$fn$;

-- ── Análisis del índice (lectura) ──────────────────────────────────────────
-- Una fila por archivo vivo (no papelera) de las áreas de personal.
create or replace function public.legajo_historico_indice_analisis()
returns table (
  repositorio_id uuid, ruta text, extension text, hash_sha256 text, area text,
  categoria text, categoria_activa boolean, fuera_del_legajo boolean, categoria_evidencia text,
  empleado_id uuid, nivel text, identidad_evidencia text,
  copias integer, ya_propuesta boolean, es_documento boolean
)
language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
begin
  -- Administración/Gerencia, o la base misma (sin sesión de usuario)
  if auth.uid() is not null and not public.documentacion_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  return query
  with f as (
    select r.id, r.ruta_relativa, lower(coalesce(r.extension, '')) ext, r.hash_sha256 h,
           split_part(r.ruta_relativa, '/', 1) || coalesce('/' || nullif(split_part(r.ruta_relativa, '/', 2), ''), '') area
    from public.repositorio_documental r
    where r.ruta_relativa not ilike 'SyncDebris%' and r.ruta_relativa not ilike '%.debris%'
      and (r.ruta_relativa ilike 'EMPLEADOS/%' or r.ruta_relativa ilike 'POLICIA/%' or r.ruta_relativa ilike 'ADMINISTRACION/POLICIA/%'
        or r.ruta_relativa ilike 'CARTAS DOCUMENTO/%' or r.ruta_relativa ilike 'ADMINISTRACION/CARTAS DOCUMENTO/%'
        or r.ruta_relativa ilike 'NOTAS CIRCULARES Y APERCIBIMIENTOS/%' or r.ruta_relativa ilike 'documentos escaneados/CREDENCIALES ESCANEADAS/%'
        or r.ruta_relativa ilike 'ADMINISTRACION/documentos escaneados/CREDENCIALES ESCANEADAS/%' or r.ruta_relativa ilike 'SUELDOS/%' or r.ruta_relativa ilike 'PRIMIA LABORAL/%'
        or r.ruta_relativa ilike 'ADMINISTRACION/PRIMIA LABORAL/%' or r.ruta_relativa ilike 'ADMINISTRACION/SEGUROS ART%' or r.ruta_relativa ilike 'homologaciones/%')
  ),
  seg as (  -- tramos de la ruta (carpetas y nombre del archivo), normalizados
    select f.id, s.ord, public.legajo_historico_normalizar(regexp_replace(s.t, '\.[A-Za-z0-9]{2,5}$', '')) t
    from f, regexp_split_to_table(f.ruta_relativa, '/') with ordinality s(t, ord)
  ),
  sw as (select distinct seg.id, seg.ord, w from seg, regexp_split_to_table(seg.t, ' ') w where w <> ''),
  uw as (
    select u.id uid, 'ap'::text k, w from public.usuarios u, regexp_split_to_table(public.legajo_historico_normalizar(u.apellido), ' ') w where w <> ''
    union all
    select u.id, 'nom', w from public.usuarios u, regexp_split_to_table(public.legajo_historico_normalizar(u.nombre), ' ') w where w <> ''
    union all
    select u.id, 'dni', regexp_replace(u.dni, '\D', '', 'g') from public.usuarios u
    where length(regexp_replace(coalesce(u.dni, ''), '\D', '', 'g')) >= 7
      and (select count(*) from public.usuarios o where regexp_replace(coalesce(o.dni, ''), '\D', '', 'g') = regexp_replace(u.dni, '\D', '', 'g')) = 1
  ),
  tot as (select uid, count(*) filter (where k = 'ap') nap, count(*) filter (where k = 'nom') nnom from uw group by uid),
  primer as (select u.id uid, split_part(public.legajo_historico_normalizar(u.nombre), ' ', 1) w from public.usuarios u),
  -- coincidencias por tramo
  hs as (
    select sw.id, sw.ord, uw.uid,
           count(distinct uw.w) filter (where uw.k = 'ap') hap, count(distinct uw.w) filter (where uw.k = 'nom') hnom,
           bool_or(uw.k = 'dni') hdni, bool_or(uw.k = 'nom' and uw.w = p.w) hprimer
    from sw join uw on uw.w = sw.w join primer p on p.uid = uw.uid
    group by 1, 2, 3
  ),
  -- coincidencias en toda la ruta
  hr as (
    select hs.id, hs.uid, t.nap, t.nnom,
           bool_or(hs.hdni) dni,
           bool_or(hs.hap = t.nap and hs.hnom = t.nnom and t.nap > 0 and t.nnom > 0) completo_en_tramo,
           bool_or(hs.hap = t.nap and t.nap > 0) apellido_en_tramo,
           bool_or(hs.hprimer) primer_nombre
    from hs join tot t on t.uid = hs.uid group by 1, 2, 3, 4
  ),
  ident as (
    select hr.id,
      array_agg(hr.uid) filter (where hr.dni) por_dni,
      array_agg(hr.uid) filter (where hr.completo_en_tramo) por_completo,
      array_agg(hr.uid) filter (where hr.apellido_en_tramo and hr.primer_nombre) por_ap_primer,
      array_agg(hr.uid) filter (where hr.apellido_en_tramo) por_apellido
    from hr group by hr.id
  ),
  cat as (
    select f.id, a.codigo a_cod, a.clave a_clave, c.codigo c_cod, c.clave c_clave
    from f
    left join lateral public.legajo_historico_categoria_de_texto(regexp_replace(f.ruta_relativa, '^.*/', '')) a on true
    left join lateral public.legajo_historico_categoria_de_texto(regexp_replace(f.ruta_relativa, '/[^/]*$', '')) c on true
  )
  select f.id, f.ruta_relativa, f.ext, f.h, f.area,
    coalesce(c.a_cod, c.c_cod),
    t.activo,
    coalesce(coalesce(c.a_cod, c.c_cod) like 'fuera:%', false),
    case when c.a_cod is not null then 'archivo: ' || lower(c.a_clave)
         when c.c_cod is not null then 'carpeta: ' || lower(c.c_clave) end,
    case when cardinality(i.por_dni) = 1 then i.por_dni[1]
         when cardinality(i.por_completo) = 1 and coalesce(cardinality(i.por_ap_primer), 0) <= 1 then i.por_completo[1]
         when cardinality(i.por_ap_primer) = 1 then i.por_ap_primer[1] end,
    case when cardinality(i.por_dni) = 1 then 'inequivoca'
         when cardinality(i.por_completo) = 1 and coalesce(cardinality(i.por_ap_primer), 0) <= 1 then 'inequivoca'
         when cardinality(i.por_ap_primer) = 1 and coalesce(cardinality(i.por_completo), 0) = 0 then 'probable'
         when cardinality(i.por_ap_primer) > 1 or cardinality(i.por_completo) > 1 or cardinality(i.por_apellido) > 0 then 'dudosa'
         else 'sin_identificar' end,
    case when cardinality(i.por_dni) = 1 then 'DNI en la ruta'
         when cardinality(i.por_completo) = 1 and coalesce(cardinality(i.por_ap_primer), 0) <= 1 then 'nombre completo en un mismo tramo de la ruta'
         when cardinality(i.por_ap_primer) = 1 and coalesce(cardinality(i.por_completo), 0) = 0 then 'apellido y primer nombre'
         when cardinality(i.por_ap_primer) > 1 or cardinality(i.por_completo) > 1 then 'coincide con más de una persona'
         when cardinality(i.por_apellido) > 0 then 'sólo coincide el apellido' end,
    (count(*) over (partition by f.h))::integer,
    exists (select 1 from public.legajo_historico_propuestas p where p.hash_origen = f.h and p.padre_id is null),
    f.ext in ('.pdf', '.jpg', '.jpeg', '.png', '.webp')
  from f
  left join ident i on i.id = f.id
  join cat c on c.id = f.id
  left join public.documentacion_tipos t on t.codigo = coalesce(c.a_cod, c.c_cod);
end;
$fn$;
revoke all on function public.legajo_historico_indice_analisis() from public, anon;
grant execute on function public.legajo_historico_indice_analisis() to authenticated;

-- Resumen (un jsonb) para la pantalla y el informe.
create or replace function public.legajo_historico_indice_resumen()
returns jsonb language plpgsql stable security definer set search_path = public, pg_catalog as $fn$
begin
  if auth.uid() is not null and not public.documentacion_puede_gestionar() then
    raise exception 'Sólo Administración o Gerencia' using errcode = '42501';
  end if;
  return (
    with a as (
      select x.*, u.estado = 'activo' as activo from public.legajo_historico_indice_analisis() x
      left join public.usuarios u on u.id = x.empleado_id
    )
    select jsonb_build_object(
      'archivos', count(*),
      'documentos', count(*) filter (where es_documento),
      'contenidos_distintos', count(distinct hash_sha256),
      'copias_extra', count(*) - count(distinct hash_sha256),
      'por_nivel', (select jsonb_object_agg(nivel, n) from (select nivel, count(*) n from a group by 1) z),
      'identificados_empleado_activo', count(*) filter (where nivel in ('inequivoca','probable') and activo),
      'identificados_exempleado', count(*) filter (where nivel in ('inequivoca','probable') and not activo),
      'con_categoria_catalogo', count(*) filter (where categoria is not null and not fuera_del_legajo),
      'categoria_historica_inactiva', count(*) filter (where categoria_activa = false),
      'fuera_del_legajo', count(*) filter (where fuera_del_legajo),
      'sin_categoria', count(*) filter (where categoria is null),
      'ya_propuestas', count(*) filter (where ya_propuesta),
      'cargables_inequivocas', count(distinct hash_sha256) filter (where nivel = 'inequivoca' and es_documento
                                   and not fuera_del_legajo and not ya_propuesta and categoria is not null),
      'inequivocas_sin_categoria', count(distinct hash_sha256) filter (where nivel = 'inequivoca' and es_documento
                                   and categoria is null and not ya_propuesta),
      'por_categoria', (select jsonb_object_agg(coalesce(categoria, '(sin categoría)'), n) from (select categoria, count(*) n from a group by 1) z)
    ) from a
  );
end;
$fn$;
revoke all on function public.legajo_historico_indice_resumen() from public, anon;
grant execute on function public.legajo_historico_indice_resumen() to authenticated;

-- ── Carga de propuestas desde el índice (sólo la base / service_role) ──────
-- Sólo identificaciones INEQUÍVOCAS, documentos (PDF o imagen) de categorías
-- del legajo o sin categoría (no recibos, licencias, contratos ni
-- comunicaciones), una propuesta por contenido (hash). Simula por defecto.
create or replace function public.legajo_historico_cargar_desde_indice(p_limite integer default 20, p_ejecutar boolean default false)
returns jsonb language plpgsql security definer set search_path = public, pg_catalog as $fn$
declare r record; v jsonb; v_res jsonb := '[]'::jsonb; v_cargadas integer := 0; v_ya integer := 0; v_candidatas integer := 0;
begin
  if auth.uid() is not null then
    raise exception 'La carga desde el índice la ejecuta quien administra la base, no la app' using errcode = '42501';
  end if;
  for r in
    select distinct on (a.hash_sha256) a.*, u.dni, u.nombre, u.apellido
    from public.legajo_historico_indice_analisis() a
    join public.usuarios u on u.id = a.empleado_id
    where a.nivel = 'inequivoca' and a.es_documento and not coalesce(a.fuera_del_legajo, false) and not a.ya_propuesta
      and a.categoria is not null  -- sin categoría del catálogo no entra solo: queda para revisión
      and (select count(*) from public.usuarios o where public.legajo_dni_normalizado(o.dni) = public.legajo_dni_normalizado(u.dni)) = 1
    order by a.hash_sha256, a.ruta
  loop
    v_candidatas := v_candidatas + 1;
    if v_candidatas > greatest(1, least(coalesce(p_limite, 20), 500)) then continue; end if;
    if p_ejecutar then
      v := public.legajo_historico_cargar_propuesta(jsonb_build_object(
        'lote', 'indice-' || to_char(now(), 'YYYY-MM'),
        'hash_origen', r.hash_sha256, 'ruta_origen', r.ruta,
        'tipo_sugerido', case when r.categoria like 'fuera:%' then null else r.categoria end,
        'dni_sugerido', public.legajo_dni_normalizado(r.dni),
        'confianza', case when r.categoria_evidencia like 'archivo:%' then 'alta' else 'media' end,
        'criterio', left('Identificación: ' || r.identidad_evidencia || coalesce(' · Categoría por ' || r.categoria_evidencia, ' · Sin categoría por nombre'), 200),
        'senales', jsonb_build_object('metodo', 'indice', 'nivel', r.nivel, 'identidad', r.identidad_evidencia,
                                      'categoria', r.categoria_evidencia, 'categoria_activa', r.categoria_activa, 'area', r.area,
                                      'copias', r.copias)));
      if v->>'resultado' = 'ya_estaba' then v_ya := v_ya + 1; else v_cargadas := v_cargadas + 1; end if;
    end if;
    if jsonb_array_length(v_res) < 10 then
      v_res := v_res || jsonb_build_array(jsonb_build_object('archivo', regexp_replace(r.ruta, '^.*/', ''), 'categoria', r.categoria,
                                                             'evidencia', r.identidad_evidencia));
    end if;
  end loop;
  return jsonb_build_object('candidatas', v_candidatas, 'limite', p_limite, 'ejecutado', p_ejecutar,
                            'cargadas', v_cargadas, 'ya_estaban', v_ya, 'muestra', v_res);
end;
$fn$;
revoke all on function public.legajo_historico_cargar_desde_indice(integer, boolean) from public, anon, authenticated;

notify pgrst, 'reload schema';
commit;
