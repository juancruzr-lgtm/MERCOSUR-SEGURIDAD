-- Tablas (columnas, defaults, PK/UNIQUE/CHECK, FK internas, RLS). Generado con scripts/db-snapshot/consultas.sql (1).

create table public.app_config (
  key text not null,
  value text not null,
  description text,
  updated_at timestamp with time zone default now() not null,
  updated_by uuid
);
alter table public.app_config add constraint app_config_pkey PRIMARY KEY (key);

create table public.asistencia_excepciones_autorizadas (
  id uuid default gen_random_uuid() not null,
  operacion_id uuid not null,
  turno_id uuid not null,
  guardia_id uuid not null,
  motivo text not null,
  autorizado_por uuid not null,
  autorizado_rol text not null,
  autorizado_at timestamp with time zone default now() not null,
  vence_at timestamp with time zone default (now() + '48:00:00'::interval) not null,
  consumida_registro_id uuid,
  consumida_at timestamp with time zone
);
alter table public.asistencia_excepciones_autorizadas add constraint asistencia_excepciones_autorizadas_operacion_id_key UNIQUE (operacion_id);
alter table public.asistencia_excepciones_autorizadas add constraint asistencia_excepciones_autorizadas_pkey PRIMARY KEY (id);
alter table public.asistencia_excepciones_autorizadas add constraint asistencia_excepciones_autorizadas_motivo_check CHECK ((char_length(btrim(motivo)) >= 20));

create table public.evidencias (
  id uuid default gen_random_uuid() not null,
  proceso_tipo text not null,
  proceso_id uuid not null,
  turno_id uuid,
  guardia_id uuid,
  objetivo_id uuid,
  tipo_evidencia text not null,
  bucket text not null,
  storage_path text not null,
  created_at timestamp with time zone default now() not null,
  contenido_sha256 text,
  bytes integer,
  content_type text,
  updated_at timestamp with time zone
);
alter table public.evidencias add constraint evidencias_pkey PRIMARY KEY (id);
alter table public.evidencias add constraint evidencias_bytes_positivo CHECK (((bytes IS NULL) OR (bytes > 0)));
alter table public.evidencias add constraint evidencias_contenido_sha256_formato CHECK (((contenido_sha256 IS NULL) OR (contenido_sha256 ~ '^[0-9a-f]{64}$'::text)));
alter table public.evidencias add constraint evidencias_proceso_tipo_check CHECK ((proceso_tipo = ANY (ARRAY['ingreso'::text, 'egreso'::text, 'supervision'::text, 'ronda'::text, 'cambio_guardia'::text, 'reemplazo'::text, 'protocolo'::text])));
CREATE UNIQUE INDEX uq_evidencias_proceso_tipo_evidencia ON public.evidencias USING btree (proceso_tipo, proceso_id, tipo_evidencia);

create table public.gerencia_delegaciones (
  id uuid default gen_random_uuid() not null,
  usuario_id uuid not null,
  activo boolean default true not null,
  desde timestamp with time zone default now() not null,
  hasta timestamp with time zone,
  otorgado_por uuid not null,
  otorgado_at timestamp with time zone default now() not null,
  revocado_por uuid,
  revocado_at timestamp with time zone
);
alter table public.gerencia_delegaciones add constraint gerencia_delegaciones_pkey PRIMARY KEY (id);

create table public.liquidacion_auditoria (
  id uuid default gen_random_uuid() not null,
  periodo_id uuid not null,
  empleado_id uuid,
  concepto_id uuid,
  codigo text,
  cantidad_anterior numeric,
  cantidad_nueva numeric,
  importe_anterior numeric,
  importe_nuevo numeric,
  origen text,
  lote_id uuid,
  usuario_id uuid,
  motivo text,
  created_at timestamp with time zone default now() not null
);
alter table public.liquidacion_auditoria add constraint liquidacion_auditoria_pkey PRIMARY KEY (id);

create table public.objetivos (
  id uuid default gen_random_uuid() not null,
  nombre text not null,
  cliente text not null,
  direccion text,
  lat numeric,
  lng numeric,
  radio_metros integer default 300,
  estado text default 'activo'::text not null,
  created_at timestamp with time zone default now(),
  latitud numeric,
  longitud numeric,
  checklist_plantilla_id uuid,
  frecuencia_supervision_horas integer default 24 not null,
  zona_id uuid,
  es_prueba boolean default false not null,
  ctx_cambio_origen text,
  ctx_cambio_firma text,
  tipo_ubicacion text default 'fijo'::text not null,
  nocturnidad_activa boolean default false not null,
  nocturnidad_desde time without time zone,
  nocturnidad_hasta time without time zone,
  fecha_inicio_servicio date,
  fecha_fin_servicio date,
  frecuencia_ronda_minutos integer
);
alter table public.objetivos add constraint objetivos_nombre_unique UNIQUE (nombre);
alter table public.objetivos add constraint objetivos_pkey PRIMARY KEY (id);
alter table public.objetivos add constraint objetivos_ctx_cambio_en_reposo CHECK (((ctx_cambio_origen IS NULL) AND (ctx_cambio_firma IS NULL)));
alter table public.objetivos add constraint objetivos_estado_check CHECK ((estado = ANY (ARRAY['activo'::text, 'inactivo'::text])));
alter table public.objetivos add constraint objetivos_fechas_servicio_orden CHECK (((fecha_inicio_servicio IS NULL) OR (fecha_fin_servicio IS NULL) OR (fecha_fin_servicio >= fecha_inicio_servicio)));
alter table public.objetivos add constraint objetivos_frecuencia_ronda_minutos_check CHECK (((frecuencia_ronda_minutos IS NULL) OR ((frecuencia_ronda_minutos >= 15) AND (frecuencia_ronda_minutos <= 1440))));
alter table public.objetivos add constraint objetivos_frecuencia_supervision_horas_check CHECK ((frecuencia_supervision_horas > 0));
alter table public.objetivos add constraint objetivos_nocturnidad_completa CHECK (((NOT nocturnidad_activa) OR ((nocturnidad_desde IS NOT NULL) AND (nocturnidad_hasta IS NOT NULL))));
alter table public.objetivos add constraint objetivos_tipo_ubicacion_valido CHECK ((tipo_ubicacion = ANY (ARRAY['fijo'::text, 'movil'::text])));

create table public.puestos (
  id uuid default gen_random_uuid() not null,
  objetivo_id uuid not null,
  nombre text not null,
  activo boolean default true not null,
  orden integer,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  observacion text
);
alter table public.puestos add constraint puestos_objetivo_id_nombre_key UNIQUE (objetivo_id, nombre);
alter table public.puestos add constraint puestos_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX puestos_id_objetivo_unique ON public.puestos USING btree (id, objetivo_id);

create table public.registros_asistencia (
  id uuid default gen_random_uuid() not null,
  turno_id uuid,
  guardia_id uuid,
  hora_entrada_real time without time zone,
  hora_salida_real time without time zone,
  lat_entrada numeric,
  lng_entrada numeric,
  lat_salida numeric,
  lng_salida numeric,
  foto_entrada_url text,
  horas_trabajadas numeric,
  alerta_entrada text,
  alerta_salida text,
  uniforme_estado text,
  uniforme_puntaje integer,
  uniforme_detalle jsonb,
  observacion text,
  created_at timestamp with time zone default now(),
  estado_revision text default 'pendiente_supervisor'::text,
  observacion_supervisor text,
  editado_por uuid,
  latitud_ingreso numeric,
  longitud_ingreso numeric,
  precision_ingreso numeric,
  distancia_ingreso_metros numeric,
  geo_ok_ingreso boolean,
  alerta_gps_ingreso text,
  latitud_egreso numeric,
  longitud_egreso numeric,
  precision_egreso numeric,
  distancia_egreso_metros numeric,
  geo_ok_egreso boolean,
  alerta_gps_egreso text,
  gps_ingreso_estado text,
  gps_egreso_estado text,
  tipo_registro text default 'fichaje_gps'::text not null,
  guardia_final_id uuid,
  objetivo_final_id uuid,
  hora_entrada_final time without time zone,
  hora_salida_final time without time zone,
  comentario_final text,
  origen text default 'operacion'::text not null,
  horas_liquidables numeric(6,2),
  origen_cobertura text,
  cierre_automatico boolean default false not null,
  cobertura_anulada_at timestamp with time zone,
  cobertura_anulada_por uuid,
  cobertura_anulada_motivo text,
  cobertura_intervencion_origen_id uuid,
  cobertura_anulacion_intervencion_id uuid,
  horas_liquidables_antes_anulacion numeric,
  registro_anulado_at timestamp with time zone,
  registro_anulado_por uuid,
  registro_anulado_motivo text,
  _horas_liquidables_pre_backfill numeric(6,2),
  excepcion_asistencia_id uuid
);
alter table public.registros_asistencia add constraint registros_asistencia_pkey PRIMARY KEY (id);
alter table public.registros_asistencia add constraint registros_asistencia_alerta_entrada_check CHECK ((alerta_entrada = ANY (ARRAY['tarde'::text, 'anticipada'::text, NULL::text])));
alter table public.registros_asistencia add constraint registros_asistencia_alerta_salida_check CHECK ((alerta_salida = ANY (ARRAY['anticipada'::text, 'posterior'::text, NULL::text])));
alter table public.registros_asistencia add constraint registros_asistencia_cobertura_anulada_horas_cero CHECK (((cobertura_anulada_at IS NULL) OR (COALESCE(horas_liquidables, (0)::numeric) = (0)::numeric)));
alter table public.registros_asistencia add constraint registros_asistencia_estado_revision_check CHECK ((estado_revision = ANY (ARRAY['pendiente_supervisor'::text, 'aprobado'::text, 'rechazado'::text])));
alter table public.registros_asistencia add constraint registros_asistencia_tipo_registro_check CHECK ((tipo_registro = ANY (ARRAY['fichaje_gps'::text, 'presente_manual'::text, 'ausencia'::text, 'reemplazo'::text, 'carga_manual'::text])));
alter table public.registros_asistencia add constraint registros_asistencia_uniforme_estado_check CHECK ((uniforme_estado = ANY (ARRAY['ok'::text, 'advertencia'::text, 'alerta'::text, NULL::text])));

create table public.registros_asistencia_auditoria (
  id uuid default gen_random_uuid() not null,
  registro_id uuid,
  turno_id uuid not null,
  modificado_por uuid not null,
  campo text not null,
  valor_anterior text,
  valor_nuevo text,
  comentario text,
  created_at timestamp with time zone default now() not null
);
alter table public.registros_asistencia_auditoria add constraint registros_asistencia_auditoria_pkey PRIMARY KEY (id);

create table public.ronda_ejecuciones (
  id uuid default gen_random_uuid() not null,
  ronda_base_id uuid not null,
  turno_id uuid not null,
  guardia_id uuid not null,
  objetivo_id uuid not null,
  puesto_id uuid not null,
  fecha_operativa date not null,
  iniciada_at timestamp with time zone default now() not null,
  finalizada_at timestamp with time zone,
  estado text default 'en_curso'::text not null,
  resultado text,
  iniciada_fuera_horario boolean default false not null,
  puntos_total integer not null,
  snap_ronda_nombre text not null,
  snap_intervalo_minutos integer not null,
  snap_hora_inicio time without time zone,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  cerrada_por uuid,
  cerrada_at timestamp with time zone,
  cerrada_motivo text
);
alter table public.ronda_ejecuciones add constraint ronda_ejecuciones_pkey PRIMARY KEY (id);
alter table public.ronda_ejecuciones add constraint ronda_ejecuciones_cierre_admin_completo CHECK ((num_nonnulls(cerrada_por, cerrada_at, cerrada_motivo) = ANY (ARRAY[0, 3])));
alter table public.ronda_ejecuciones add constraint ronda_ejecuciones_cierre_admin_estado CHECK (((cerrada_por IS NULL) OR (estado = 'finalizada'::text)));
alter table public.ronda_ejecuciones add constraint ronda_ejecuciones_cierre_admin_motivo_util CHECK (((cerrada_motivo IS NULL) OR (length(btrim(cerrada_motivo)) >= 10)));
alter table public.ronda_ejecuciones add constraint ronda_ejecuciones_cierre_coherente CHECK (((estado = 'en_curso'::text) = (finalizada_at IS NULL)));
alter table public.ronda_ejecuciones add constraint ronda_ejecuciones_estado_valido CHECK ((estado = ANY (ARRAY['en_curso'::text, 'finalizada'::text, 'cancelada'::text])));
alter table public.ronda_ejecuciones add constraint ronda_ejecuciones_puntos_total_valido CHECK ((puntos_total > 0));
alter table public.ronda_ejecuciones add constraint ronda_ejecuciones_resultado_coherente CHECK (((estado = 'finalizada'::text) = (resultado IS NOT NULL)));
alter table public.ronda_ejecuciones add constraint ronda_ejecuciones_resultado_valido CHECK (((resultado IS NULL) OR (resultado = ANY (ARRAY['completa'::text, 'incompleta'::text, 'pendiente_validacion'::text]))));
CREATE UNIQUE INDEX ronda_ejecuciones_turno_guardia_en_curso_unique ON public.ronda_ejecuciones USING btree (turno_id, guardia_id) WHERE (estado = 'en_curso'::text);

create table public.supervision_fotos (
  id uuid default gen_random_uuid() not null,
  supervision_id uuid not null,
  storage_path text not null,
  created_at timestamp with time zone default now() not null
);
alter table public.supervision_fotos add constraint supervision_fotos_pkey PRIMARY KEY (id);

create table public.supervision_respuestas (
  id uuid default gen_random_uuid() not null,
  supervision_id uuid not null,
  item_id uuid not null,
  resultado text not null,
  observacion text,
  created_at timestamp with time zone default now() not null
);
alter table public.supervision_respuestas add constraint supervision_respuestas_unicas UNIQUE (supervision_id, item_id);
alter table public.supervision_respuestas add constraint supervision_respuestas_pkey PRIMARY KEY (id);
alter table public.supervision_respuestas add constraint supervision_respuestas_resultado_check CHECK ((resultado = ANY (ARRAY['correcto'::text, 'observado'::text, 'no_aplica'::text])));

create table public.supervisiones (
  id uuid default gen_random_uuid() not null,
  objetivo_id uuid not null,
  supervisor_id uuid not null,
  plantilla_id uuid,
  lat numeric not null,
  lng numeric not null,
  precision_gps numeric not null,
  estado text default 'ok'::text not null,
  observaciones text,
  created_at timestamp with time zone default now() not null
);
alter table public.supervisiones add constraint supervisiones_pkey PRIMARY KEY (id);
alter table public.supervisiones add constraint supervisiones_estado_check CHECK ((estado = ANY (ARRAY['ok'::text, 'con_observacion'::text, 'critico'::text, 'incompleta'::text])));

create table public.supervisor_zonas (
  id uuid default gen_random_uuid() not null,
  supervisor_id uuid not null,
  zona_id uuid not null,
  created_at timestamp with time zone default now() not null
);
alter table public.supervisor_zonas add constraint supervisor_zonas_unicas UNIQUE (supervisor_id, zona_id);
alter table public.supervisor_zonas add constraint supervisor_zonas_pkey PRIMARY KEY (id);

create table public.turnos (
  id uuid default gen_random_uuid() not null,
  guardia_id uuid,
  objetivo_id uuid,
  fecha date not null,
  hora_inicio time without time zone not null,
  hora_fin time without time zone not null,
  estado text default 'programado'::text not null,
  created_at timestamp with time zone default now(),
  servicio_base_id uuid,
  guardia_original_id uuid,
  guardia_real_id uuid,
  motivo_reemplazo text,
  editado_por uuid,
  observacion text,
  updated_at timestamp with time zone default now(),
  tipo_evento text default 'normal'::text not null,
  estado_revision text default 'aprobado'::text,
  observacion_guardia text,
  observacion_supervisor text,
  puesto_id uuid,
  origen text default 'planificado'::text not null,
  revisado_por uuid,
  revisado_at timestamp with time zone,
  publicado boolean default false not null,
  publicado_at timestamp with time zone,
  publicado_por uuid,
  reemplaza_turno_id uuid
);
alter table public.turnos add constraint turnos_pkey PRIMARY KEY (id);
alter table public.turnos add constraint turnos_estado_check CHECK ((estado = ANY (ARRAY['programado'::text, 'cubierto'::text, 'descubierto'::text, 'ausente'::text, 'reemplazado'::text, 'anulado'::text, 'cancelado'::text])));
alter table public.turnos add constraint turnos_estado_revision_check CHECK ((estado_revision = ANY (ARRAY['pendiente_supervisor'::text, 'aprobado'::text, 'rechazado'::text])));
alter table public.turnos add constraint turnos_tipo_evento_check CHECK ((tipo_evento = ANY (ARRAY['normal'::text, 'cobertura'::text, 'capacitacion'::text])));
CREATE UNIQUE INDEX idx_turno_unico ON public.turnos USING btree (guardia_id, objetivo_id, fecha, hora_inicio);
CREATE UNIQUE INDEX turnos_servicio_fecha_unique ON public.turnos USING btree (servicio_base_id, fecha) WHERE (servicio_base_id IS NOT NULL);

create table public.turnos_auditoria (
  id uuid default gen_random_uuid() not null,
  turno_id uuid not null,
  modificado_por uuid not null,
  campo text not null,
  valor_anterior text,
  valor_nuevo text,
  comentario text,
  created_at timestamp with time zone default now() not null
);
alter table public.turnos_auditoria add constraint turnos_auditoria_pkey PRIMARY KEY (id);

create table public.usuarios (
  id uuid default gen_random_uuid() not null,
  nombre text not null,
  apellido text not null,
  dni text,
  telefono text,
  legajo text not null,
  rol text not null,
  estado text default 'activo'::text not null,
  foto_url text,
  auth_user_id uuid,
  created_at timestamp with time zone default now(),
  email text,
  cuil text,
  legajo_visual text,
  cuenta_bancaria text,
  es_prueba boolean default false not null,
  puesto_organizacional text,
  acceso_interfaz_admin boolean default false not null,
  acceso_admin_pleno boolean default false not null,
  excluir_pago_banco boolean default false not null,
  acceso_bloqueado boolean default false not null,
  acceso_bloqueado_motivo text,
  acceso_bloqueado_at timestamp with time zone,
  acceso_bloqueado_por uuid,
  acceso_auth_bloqueado_at timestamp with time zone,
  acceso_facturacion boolean default false not null
);
alter table public.usuarios add constraint usuarios_legajo_key UNIQUE (legajo);
alter table public.usuarios add constraint usuarios_legajo_unique UNIQUE (legajo);
alter table public.usuarios add constraint usuarios_pkey PRIMARY KEY (id);
alter table public.usuarios add constraint usuarios_estado_check CHECK ((estado = ANY (ARRAY['activo'::text, 'inactivo'::text])));
alter table public.usuarios add constraint usuarios_puesto_organizacional_check CHECK (((puesto_organizacional IS NULL) OR (puesto_organizacional = ANY (ARRAY['vigilador'::text, 'supervisor'::text, 'jefe_supervisores'::text, 'direccion_operativa'::text, 'administracion'::text, 'gerencia'::text]))));
alter table public.usuarios add constraint usuarios_rol_check CHECK ((rol = ANY (ARRAY['admin'::text, 'supervisor'::text, 'guardia'::text])));
CREATE UNIQUE INDEX usuarios_auth_user_id_idx ON public.usuarios USING btree (auth_user_id);
CREATE UNIQUE INDEX usuarios_cuil_unique ON public.usuarios USING btree (cuil) WHERE (cuil IS NOT NULL);

create table public.zonas_operativas (
  id uuid default gen_random_uuid() not null,
  nombre text not null,
  descripcion text,
  estado text default 'activo'::text not null,
  created_at timestamp with time zone default now() not null
);
alter table public.zonas_operativas add constraint zonas_operativas_nombre_key UNIQUE (nombre);
alter table public.zonas_operativas add constraint zonas_operativas_pkey PRIMARY KEY (id);
alter table public.zonas_operativas add constraint zonas_operativas_estado_check CHECK ((estado = ANY (ARRAY['activo'::text, 'inactivo'::text])));

-- FK entre tablas del snapshot (las que apuntan afuera, p. ej. auth.users, se omiten)

alter table public.asistencia_excepciones_autorizadas add constraint asistencia_excepciones_autorizadas_autorizado_por_fkey FOREIGN KEY (autorizado_por) REFERENCES usuarios(id);
alter table public.asistencia_excepciones_autorizadas add constraint asistencia_excepciones_autorizadas_guardia_id_fkey FOREIGN KEY (guardia_id) REFERENCES usuarios(id);
alter table public.asistencia_excepciones_autorizadas add constraint asistencia_excepciones_autorizadas_turno_id_fkey FOREIGN KEY (turno_id) REFERENCES turnos(id);
alter table public.evidencias add constraint evidencias_guardia_id_fkey FOREIGN KEY (guardia_id) REFERENCES usuarios(id);
alter table public.evidencias add constraint evidencias_objetivo_id_fkey FOREIGN KEY (objetivo_id) REFERENCES objetivos(id);
alter table public.evidencias add constraint evidencias_turno_id_fkey FOREIGN KEY (turno_id) REFERENCES turnos(id);
alter table public.gerencia_delegaciones add constraint gerencia_delegaciones_otorgado_por_fkey FOREIGN KEY (otorgado_por) REFERENCES usuarios(id);
alter table public.gerencia_delegaciones add constraint gerencia_delegaciones_revocado_por_fkey FOREIGN KEY (revocado_por) REFERENCES usuarios(id);
alter table public.gerencia_delegaciones add constraint gerencia_delegaciones_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE;
alter table public.liquidacion_auditoria add constraint liquidacion_auditoria_empleado_id_fkey FOREIGN KEY (empleado_id) REFERENCES usuarios(id);
alter table public.liquidacion_auditoria add constraint liquidacion_auditoria_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id);
alter table public.objetivos add constraint objetivos_zona_id_fkey FOREIGN KEY (zona_id) REFERENCES zonas_operativas(id);
alter table public.puestos add constraint puestos_objetivo_id_fkey FOREIGN KEY (objetivo_id) REFERENCES objetivos(id);
alter table public.registros_asistencia add constraint registros_asistencia_cobertura_anulada_por_fkey FOREIGN KEY (cobertura_anulada_por) REFERENCES usuarios(id);
alter table public.registros_asistencia add constraint registros_asistencia_editado_por_fkey FOREIGN KEY (editado_por) REFERENCES usuarios(id);
alter table public.registros_asistencia add constraint registros_asistencia_excepcion_asistencia_id_fkey FOREIGN KEY (excepcion_asistencia_id) REFERENCES asistencia_excepciones_autorizadas(id);
alter table public.registros_asistencia add constraint registros_asistencia_guardia_final_id_fkey FOREIGN KEY (guardia_final_id) REFERENCES usuarios(id);
alter table public.registros_asistencia add constraint registros_asistencia_guardia_id_fkey FOREIGN KEY (guardia_id) REFERENCES usuarios(id);
alter table public.registros_asistencia add constraint registros_asistencia_objetivo_final_id_fkey FOREIGN KEY (objetivo_final_id) REFERENCES objetivos(id);
alter table public.registros_asistencia add constraint registros_asistencia_turno_id_fkey FOREIGN KEY (turno_id) REFERENCES turnos(id);
alter table public.registros_asistencia_auditoria add constraint registros_asistencia_auditoria_modificado_por_fkey FOREIGN KEY (modificado_por) REFERENCES usuarios(id);
alter table public.registros_asistencia_auditoria add constraint registros_asistencia_auditoria_registro_id_fkey FOREIGN KEY (registro_id) REFERENCES registros_asistencia(id) ON DELETE CASCADE;
alter table public.registros_asistencia_auditoria add constraint registros_asistencia_auditoria_turno_id_fkey FOREIGN KEY (turno_id) REFERENCES turnos(id);
alter table public.ronda_ejecuciones add constraint ronda_ejecuciones_cerrada_por_fkey FOREIGN KEY (cerrada_por) REFERENCES usuarios(id) ON DELETE RESTRICT;
alter table public.ronda_ejecuciones add constraint ronda_ejecuciones_guardia_id_fkey FOREIGN KEY (guardia_id) REFERENCES usuarios(id) ON DELETE RESTRICT;
alter table public.ronda_ejecuciones add constraint ronda_ejecuciones_puesto_objetivo_fkey FOREIGN KEY (puesto_id, objetivo_id) REFERENCES puestos(id, objetivo_id);
alter table public.ronda_ejecuciones add constraint ronda_ejecuciones_turno_id_fkey FOREIGN KEY (turno_id) REFERENCES turnos(id) ON DELETE RESTRICT;
alter table public.supervision_fotos add constraint supervision_fotos_supervision_id_fkey FOREIGN KEY (supervision_id) REFERENCES supervisiones(id) ON DELETE CASCADE;
alter table public.supervision_respuestas add constraint supervision_respuestas_supervision_id_fkey FOREIGN KEY (supervision_id) REFERENCES supervisiones(id) ON DELETE CASCADE;
alter table public.supervisiones add constraint supervisiones_objetivo_id_fkey FOREIGN KEY (objetivo_id) REFERENCES objetivos(id);
alter table public.supervisiones add constraint supervisiones_supervisor_id_fkey FOREIGN KEY (supervisor_id) REFERENCES usuarios(id);
alter table public.supervisor_zonas add constraint supervisor_zonas_supervisor_id_fkey FOREIGN KEY (supervisor_id) REFERENCES usuarios(id) ON DELETE CASCADE;
alter table public.supervisor_zonas add constraint supervisor_zonas_zona_id_fkey FOREIGN KEY (zona_id) REFERENCES zonas_operativas(id) ON DELETE CASCADE;
alter table public.turnos add constraint turnos_editado_por_fkey FOREIGN KEY (editado_por) REFERENCES usuarios(id) ON DELETE SET NULL;
alter table public.turnos add constraint turnos_guardia_id_fkey FOREIGN KEY (guardia_id) REFERENCES usuarios(id);
alter table public.turnos add constraint turnos_guardia_original_id_fkey FOREIGN KEY (guardia_original_id) REFERENCES usuarios(id) ON DELETE SET NULL;
alter table public.turnos add constraint turnos_guardia_real_id_fkey FOREIGN KEY (guardia_real_id) REFERENCES usuarios(id) ON DELETE SET NULL;
alter table public.turnos add constraint turnos_objetivo_id_fkey FOREIGN KEY (objetivo_id) REFERENCES objetivos(id) ON DELETE CASCADE;
alter table public.turnos add constraint turnos_publicado_por_fkey FOREIGN KEY (publicado_por) REFERENCES usuarios(id);
alter table public.turnos add constraint turnos_puesto_objetivo_fkey FOREIGN KEY (puesto_id, objetivo_id) REFERENCES puestos(id, objetivo_id);
alter table public.turnos add constraint turnos_reemplaza_turno_id_fkey FOREIGN KEY (reemplaza_turno_id) REFERENCES turnos(id) ON DELETE SET NULL;
alter table public.turnos add constraint turnos_revisado_por_fkey FOREIGN KEY (revisado_por) REFERENCES usuarios(id);
alter table public.turnos_auditoria add constraint turnos_auditoria_modificado_por_fkey FOREIGN KEY (modificado_por) REFERENCES usuarios(id);
alter table public.turnos_auditoria add constraint turnos_auditoria_turno_id_fkey FOREIGN KEY (turno_id) REFERENCES turnos(id) ON DELETE CASCADE;
alter table public.usuarios add constraint usuarios_acceso_bloqueado_por_fkey FOREIGN KEY (acceso_bloqueado_por) REFERENCES usuarios(id) ON DELETE SET NULL;

alter table public.app_config enable row level security;
alter table public.asistencia_excepciones_autorizadas enable row level security;
alter table public.gerencia_delegaciones enable row level security;
alter table public.liquidacion_auditoria enable row level security;
alter table public.objetivos enable row level security;
alter table public.puestos enable row level security;
alter table public.registros_asistencia enable row level security;
alter table public.registros_asistencia_auditoria enable row level security;
alter table public.supervision_fotos enable row level security;
alter table public.supervision_respuestas enable row level security;
alter table public.supervisiones enable row level security;
alter table public.supervisor_zonas enable row level security;
alter table public.turnos enable row level security;
alter table public.turnos_auditoria enable row level security;
alter table public.usuarios enable row level security;
alter table public.zonas_operativas enable row level security;
