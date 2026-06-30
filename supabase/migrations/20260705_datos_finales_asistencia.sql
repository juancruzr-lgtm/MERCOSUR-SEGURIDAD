/*
Arquitectura: datos originales / datos finales en registros_asistencia.

- Los datos originales (hora_entrada_real, hora_salida_real, guardia_id,
  tipo_registro, GPS, coordenadas, alertas) nunca se modifican.
  Representan la evidencia del fichaje.

- Los datos finales son la corrección operativa decidida por el
  supervisor o admin para reportes, liquidación y facturación.
  Si están vacíos, los reportes usan los datos originales.

- Una asistencia representa un solo guardia. Si dos guardias
  cubrieron el mismo turno, existen dos registros separados.
*/

alter table registros_asistencia
  add column if not exists guardia_final_id   uuid references usuarios(id),
  add column if not exists objetivo_final_id  uuid references objetivos(id),
  add column if not exists hora_entrada_final time,
  add column if not exists hora_salida_final  time,
  add column if not exists comentario_final   text;
