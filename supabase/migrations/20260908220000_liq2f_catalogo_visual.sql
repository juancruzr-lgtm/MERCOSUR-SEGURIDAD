-- ============================================================================
-- LIQ2F — Catálogo de conceptos de Visual (config de importación)
-- ============================================================================
-- Siembra el maestro de conceptos de la empresa 63 (auditado del propio Visual)
-- con la POLÍTICA de exportación por código, derivada de la evidencia:
--   politica='valor'      -> MERCOSUR informa cantidad/importe (Clase A)
--   politica='linea_cero' -> MERCOSUR crea la línea 0/0 para TODOS; Visual calcula
--                            (011 antigüedad, 050, 101 jub, 102, 103, 133 dif OS)
--   politica='individual' -> por empleado vía permanente: 104/977/48410 (0/0),
--                            111/993 (importe real)
--   politica='no'         -> NUNCA se manda (lo calcula Visual o es histórico)
-- `entrada` (IMP|CAN|CANIMP|CALCULADO) = contrato del concepto (de la FÓRMULA).
-- MERCOSUR NO implementa fórmulas legales: sólo crea líneas y provee inputs.
--
-- ROLLBACK: supabase/rollback/20260908220000_liq2f_catalogo_visual_rollback.sql
-- ============================================================================

alter table public.liquidacion_concepto_catalogo add column if not exists entrada     text;   -- IMP|CAN|CANIMP|CALCULADO
alter table public.liquidacion_concepto_catalogo add column if not exists politica    text;   -- valor|linea_cero|individual|no
alter table public.liquidacion_concepto_catalogo add column if not exists formula     text;   -- fórmula de Visual (referencia; NO se ejecuta acá)
alter table public.liquidacion_concepto_catalogo add column if not exists tipo_visual text;   -- Remunerativo|No Remunerativo|Descuento|Asignacion/Creditos|Para Calculos

create unique index if not exists ux_liq_catalogo_codigo on public.liquidacion_concepto_catalogo (codigo_visual);

insert into public.liquidacion_concepto_catalogo (codigo_visual, nombre, categoria, origen, entrada, politica, formula, tipo_visual) values
('000','DIAS TRABAJADAS','base_auxiliar','mercosur','CAN','valor','CAN','Para Calculos'),
('00089','proporcional dias trabajados','imponible','mercosur','IMP','no','IMP','Remunerativo'),
('001','horas trabajadas','imponible','mercosur','IMP','valor','IMP','Remunerativo'),
('002','Resolución 563/2020 fuerza mayor','imponible','calculado_visual','CALCULADO','no','16275-(001#+088#)','Remunerativo'),
('003','adicional','imponible','mercosur','IMP','valor','IMP','Remunerativo'),
('0033','gratificacion extraordinaria','imponible','mercosur','IMP','no','IMP','Remunerativo'),
('00333','rectificativa afip','base_auxiliar','mercosur','IMP','no','IMP','Para Calculos'),
('004','adicional nocturnidad','asignacion','mercosur','IMP','valor','IMP','Asignacion/Creditos'),
('005','Horas extras 100%','imponible','mercosur','CAN','no','CAN * 002# * 2','Remunerativo'),
('006','Feriado','asignacion','mercosur','CANIMP','valor','CAN*IMP','Asignacion/Creditos'),
('007','SAC','imponible','mercosur','IMP','valor','IMP','Remunerativo'),
('008','Parte Medico','no_imponible','mercosur','CANIMP','valor','CAN*IMP','No Remunerativo'),
('009','Día del Gremio','imponible','mercosur','IMP','no','IMP','Remunerativo'),
('010','Acc Laboral','imponible','mercosur','CANIMP','valor','CAN*IMP','Remunerativo'),
('011','Antiguedad','imponible','calculado_visual','CALCULADO','linea_cero','(001#+006#+008#+013#)*ANTIG*0.01','Remunerativo'),
('01119','jubilacion c19','descuento','calculado_visual','CALCULADO','no','MAXBRUTO*0.11','Descuento'),
('012','Antig','imponible','mercosur','IMP','no','IMP','Remunerativo'),
('013','Horas Nocturnas','imponible','mercosur','CAN','no','CAN*24.3','Remunerativo'),
('014','Vac','no_imponible','mercosur','CANIMP','no','CAN*IMP','No Remunerativo'),
('015','Lic Nacimiento','imponible','mercosur','CANIMP','no','CAN*IMP','Remunerativo'),
('016','remuneradivo rectificacion','imponible','mercosur','IMP','no','IMP','Remunerativo'),
('017','aportes viejos','base_auxiliar','mercosur','IMP','no','IMP','Para Calculos'),
('033','Horas normales','imponible','mercosur','CAN','no','CAN*94.15','Remunerativo'),
('042020','sueldo','asignacion','mercosur','IMP','no','IMP','Asignacion/Creditos'),
('0420201','obra social sobre no rem','descuento','calculado_visual','CALCULADO','no','(042020#)*0.03','Descuento'),
('049','dif ob s ab 21','base_auxiliar','calculado_visual','CALCULADO','no','35500','Para Calculos'),
('050','ajuste','base_auxiliar','calculado_visual','CALCULADO','linea_cero','911650','Para Calculos'),
('051','ajuste 4 y 8 afip','base_auxiliar','mercosur','IMP','no','IMP','Para Calculos'),
('052','diferencia os afip ab 21','base_auxiliar','calculado_visual','CALCULADO','no','35500-051#-001#','Para Calculos'),
('053','diferencial aporte','base_auxiliar','mercosur','IMP','no','IMP','Para Calculos'),
('088','licencia','imponible','mercosur','IMP','valor','IMP','Remunerativo'),
('1000','expediente SABINO ARANDA','descuento','calculado_visual','CALCULADO','no','((001#+203#+204#+007#)-(101#+102#+103#+104#))*0.20','Descuento'),
('1001','expediente lopez aldo','descuento','calculado_visual','CALCULADO','no','(001#+010#-101#-102#-103#)*0.30','Descuento'),
('101','Jubilación','descuento','calculado_visual','CALCULADO','linea_cero','(BRUTO )* 0.11','Descuento'),
('1010','base diferencial seguridad social','base_auxiliar','mercosur','IMP','no','IMP','Para Calculos'),
('1011','descuento solo adicional jubilacion','descuento','calculado_visual','CALCULADO','no','1013#* 0.11','Descuento'),
('1012','detraccion','base_auxiliar','mercosur','IMP','no','IMP','Para Calculos'),
('1013','diferencia ajuste afip','base_auxiliar','calculado_visual','CALCULADO','no','1010#-001#-003#-016#','Para Calculos'),
('102','INSSJyP - Ley 19032','descuento','calculado_visual','CALCULADO','linea_cero','(BRUTO) * 0.03','Descuento'),
('1022','inssjyp solo adicional','descuento','calculado_visual','CALCULADO','no','1013#* 0.03','Descuento'),
('103','Obra Social','descuento','calculado_visual','CALCULADO','linea_cero','(BRUTO)*0.03','Descuento'),
('1033','obs afip','descuento','calculado_visual','CALCULADO','no','(003#)*-0.03','Descuento'),
('104','Sindicato','descuento','calculado_visual','CALCULADO','individual','(BRUTO+204#)*0.03','Descuento'),
('1044','fondo solidario','descuento','calculado_visual','CALCULADO','no','050#*0.02','Descuento'),
('105','Obra Social','descuento','calculado_visual','CALCULADO','no','159.3','Descuento'),
('106','Fondo de Ayuda Solidario','descuento','calculado_visual','CALCULADO','no','BRUTO*0.01','Descuento'),
('107','Exped Acuña','descuento','calculado_visual','CALCULADO','no','((001#+203#+204#)-(101#+102#+103#+104#))*0.20','Descuento'),
('108','Exped Basse','descuento','calculado_visual','CALCULADO','no','(001#-101#-102#-103#)*0.30','Descuento'),
('109','Obra Social','descuento','calculado_visual','CALCULADO','no','180','Descuento'),
('110','Exped 119/2014 Soso','descuento','calculado_visual','CALCULADO','no','((001#+203#+204)-3600)*0.20','Descuento'),
('111','Exped','descuento','mercosur','IMP','individual','IMP','Descuento'),
('112','expediente prinzen','descuento','calculado_visual','CALCULADO','no','1702.32','Descuento'),
('114','sindicato','descuento','calculado_visual','CALCULADO','no','(5000+310)*0.03','Descuento'),
('120003','sac proporcional','imponible','mercosur','CANIMP','valor','CAN*IMP','Remunerativo'),
('133','diferencias O.S.','descuento','calculado_visual','CALCULADO','linea_cero','((050#-001#-011#-088#-002#-007#-010#)*0.03)','Descuento'),
('134','dif obs abril 21 vafp','descuento','calculado_visual','CALCULADO','no','((049#-001#-011#-088#-002#-007#-010#)*0.03)','Descuento'),
('141','vega dic','imponible','mercosur','IMP','no','IMP','Remunerativo'),
('1764','expediente barberis 16094.16','descuento','calculado_visual','CALCULADO','no','3156','Descuento'),
('201','Asignación por hijo','asignacion','calculado_visual','CALCULADO','no','HIJOS*40','Asignacion/Creditos'),
('202','Familia numerosa','asignacion','calculado_visual','CALCULADO','no','20 * SI( HIJOS>2,HIJOS-2,0)','Asignacion/Creditos'),
('2024','adicional rectificacion','imponible','mercosur','IMP','no','IMP','Remunerativo'),
('203','Viaticos','asignacion','mercosur','IMP','valor','IMP','Asignacion/Creditos'),
('204','presentismo','asignacion','mercosur','IMP','valor','IMP','Asignacion/Creditos'),
('205','Vacac','asignacion','mercosur','CANIMP','valor','CAN*IMP','Asignacion/Creditos'),
('206','indemnización','asignacion','mercosur','IMP','no','IMP','Asignacion/Creditos'),
('207','Indem por Antig','asignacion','mercosur','IMP','valor','IMP','Asignacion/Creditos'),
('208','Vac No Goz','asignacion','mercosur','CANIMP','valor','CAN*IMP','Asignacion/Creditos'),
('209','Vac No Goz 2012','asignacion','mercosur','CANIMP','no','CAN*IMP','Asignacion/Creditos'),
('210','Vac no goz 2014','asignacion','mercosur','CANIMP','no','CAN*IMP','Asignacion/Creditos'),
('211','vac no goz 2015','asignacion','mercosur','CANIMP','no','CAN*IMP','Asignacion/Creditos'),
('212','ADICIONAL','asignacion','mercosur','CANIMP','valor','CAN*IMP','Asignacion/Creditos'),
('213','Suma No Remunerativa','base_auxiliar','mercosur','IMP','valor','IMP','Para Calculos'),
('214','“Suma No Remunerativa – Acuerdo 2025','no_imponible','mercosur','IMP','valor','IMP','No Remunerativo'),
('215','incremento solidario','no_imponible','mercosur','IMP','no','IMP','No Remunerativo'),
('216','incremento solidario','no_imponible','mercosur','IMP','no','IMP','No Remunerativo'),
('217','sac sobre vacaciones no goz','no_imponible','mercosur','IMP','valor','IMP','No Remunerativo'),
('219','ajuste Resolución 563/2020','no_imponible','calculado_visual','CALCULADO','no','001#+088#-15000','No Remunerativo'),
('22','Valor básico horario','no_imponible','mercosur','CAN','no','395/25*CAN','No Remunerativo'),
('220','ajuste Resolución 563/2020 O.S.','no_imponible','calculado_visual','CALCULADO','no','001#-15000','No Remunerativo'),
('221','ajuste art 6 DN','no_imponible','calculado_visual','CALCULADO','no','001#+088#-15000','No Remunerativo'),
('229437434','espediente leiva hast 43749 (20% de lo que supere el minimo vital)','descuento','calculado_visual','CALCULADO','no','(001#+203#+204#+205#+208#)*0.20','Descuento'),
('248','indemnizacion articulo 248 lct','no_imponible','mercosur','IMP','no','IMP','No Remunerativo'),
('250','HORAS','imponible','mercosur','CAN','no','CAN*34','Remunerativo'),
('251','LIC. CASAMIENTO','imponible','mercosur','CANIMP','no','CAN*IMP','Remunerativo'),
('252','preaviso','asignacion','mercosur','IMP','no','IMP','Asignacion/Creditos'),
('3106','expediente zamarini 44765','descuento','calculado_visual','CALCULADO','no','(001#-101#-102#-103#)*0.20','Descuento'),
('484','EXPEDIENTE dec 484/87 30%','descuento','calculado_visual','CALCULADO','no','(NETO-SFIJA1)*0.1','Descuento'),
('48410','embargo 10% sobre minimo','descuento','calculado_visual','CALCULADO','individual','(NETO-SFIJA1)*0.10','Descuento'),
('48420','descuento sobre mvm 20%','descuento','calculado_visual','CALCULADO','no','(NETO-SFIJA1)*0.20','Descuento'),
('5580','embargo silva w','descuento','calculado_visual','CALCULADO','no','(001#+007#-101#-102#-103#-133#)*0.35','Descuento'),
('561','decreto 561/19','descuento','calculado_visual','CALCULADO','no','(BRUTO * 0.0875)*-1','Descuento'),
('56119','decreto 561/19','descuento','calculado_visual','CALCULADO','no','-2000','Descuento'),
('665','Dec.665/19 ANR- Cuota Nro 1','no_imponible','calculado_visual','CALCULADO','no','1000','No Remunerativo'),
('6652','Dec.665/19 ANR- Cuota Nro 2','no_imponible','calculado_visual','CALCULADO','no','1000','No Remunerativo'),
('6653','dec 665/19 cuota n 3','asignacion','calculado_visual','CALCULADO','no','1000','Asignacion/Creditos'),
('843','bono 843/2023','no_imponible','mercosur','IMP','no','IMP','No Remunerativo'),
('888','licencia','asignacion','mercosur','CANIMP','no','CAN*IMP','Asignacion/Creditos'),
('945','expedienrte morales r','descuento','calculado_visual','CALCULADO','no','(001#+203#+204#+205#+208#)*0.20','Descuento'),
('950','expediente aguero jonatan','descuento','calculado_visual','CALCULADO','no','(001#+007#-101#-102#-103#-133#)*0.25','Descuento'),
('976','expediente peralta','descuento','calculado_visual','CALCULADO','no','(001#-101#-102#-103#)*0.20','Descuento'),
('977','EXPEDIENTE 20%','descuento','calculado_visual','CALCULADO','individual','(001#+204#+203#+205#+007#-101#-102#-103#)*0.20','Descuento'),
('992','salinas confina 50586.96 + 15147.3','descuento','calculado_visual','CALCULADO','no','(001#-101#-102#-103#)*0.20','Descuento'),
('993','embargo suma fija','descuento','mercosur','IMP','individual','IMP','Descuento'),
('994','exspediente aranda decreto','imponible','calculado_visual','CALCULADO','no','(001#-101#-102#-103#-133#)*0.35','Remunerativo'),
('995','expediente silva decreto','descuento','calculado_visual','CALCULADO','no','(001#+204#-101#-102#-103#-133#)*0.35','Descuento'),
('996','expediente lopez decreto','descuento','calculado_visual','CALCULADO','no','(001#+010#-101#-102#-103#-133#)*0.30','Descuento'),
('997','EXPEDIENTE ALIMENTOS 25%','descuento','calculado_visual','CALCULADO','no','(001#+204#+203#+205#+007#-101#-102#-103#)*0.25','Descuento'),
('999','expediente doratto nestor','descuento','calculado_visual','CALCULADO','no','(001#+007#-101#-102#-103#)*0.22','Descuento')
on conflict (codigo_visual) do update set
  nombre = excluded.nombre, categoria = excluded.categoria, origen = excluded.origen,
  entrada = excluded.entrada, politica = excluded.politica, formula = excluded.formula, tipo_visual = excluded.tipo_visual;

update public.liquidacion_concepto_catalogo
   set exporta_visual = (politica is distinct from 'no'),
       manda_cantidad = (entrada in ('CAN','CANIMP')),
       manda_importe  = (entrada in ('IMP','CANIMP'))
 where codigo_visual is not null;
