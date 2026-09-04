-- ============================================================================
-- SANEAMIENTO · legajo_visual desde el padrón oficial (empleados.xls 04/09/2026)
-- ============================================================================
-- Carga la etiqueta de Legajo de Visual Sueldos (columna LEGAJO del padrón,
-- alfanumérica) identificando a cada persona por CUIL exacto. Sólo completa
-- donde legajo_visual es NULL: jamás pisa un valor ya cargado. Los 6 sin CUIL
-- en la app (3 admins por-nombre, Laura M, Facundo admin, GURUCHAR) no se
-- tocan. Requiere migración 20260904110000.

begin;

update public.usuarios set legajo_visual = '1 JUAREZ JOEL' where legajo_visual is null and cuil = '23395054309'; -- 1 JUAREZ JOEL ALEXIS JULIAN
update public.usuarios set legajo_visual = '1.1 MAGARO' where legajo_visual is null and cuil = '27130777487'; -- 1 MAGARO LAURA NORA
update public.usuarios set legajo_visual = '1 NARVARTE' where legajo_visual is null and cuil = '23174138664'; -- 1 NARVARTE MARIA ANDREA
update public.usuarios set legajo_visual = '1 ROMERO F' where legajo_visual is null and cuil = '23322899599'; -- 1 ROMERO FACUNDO MARTIN
update public.usuarios set legajo_visual = '1 ROMERO jc' where legajo_visual is null and cuil = '20313933335'; -- 1 ROMERO JUAN CRUZ
update public.usuarios set legajo_visual = 'ALMADA' where legajo_visual is null and cuil = '20144945817'; -- ALMADA ESTANISLAO
update public.usuarios set legajo_visual = 'ALMARA' where legajo_visual is null and cuil = '20295393522'; -- ALMARA SILVIO EDUARDO
update public.usuarios set legajo_visual = 'ALVAREZ YAMIL' where legajo_visual is null and cuil = '20373962997'; -- ALVAREZ YAMIL EMANUEL
update public.usuarios set legajo_visual = 'Aranda' where legajo_visual is null and cuil = '20251760307'; -- ARANDA SABINO
update public.usuarios set legajo_visual = 'BARETTA FRANCISCO' where legajo_visual is null and cuil = '20431638267'; -- BARETTA FRANCISCO CARLOS
update public.usuarios set legajo_visual = 'BARREIR' where legajo_visual is null and cuil = '20182154181'; -- BARREIRO ARIEL GUSTAVO
update public.usuarios set legajo_visual = 'BARRIENTOS DANIEL' where legajo_visual is null and cuil = '20251614033'; -- BARRIENTOS DANIEL GUSTAVO
update public.usuarios set legajo_visual = 'BARRIOS BRIAN' where legajo_visual is null and cuil = '20385975024'; -- BARRIOS BRIAN EMANUEL
update public.usuarios set legajo_visual = 'BASSE' where legajo_visual is null and cuil = '20149137751'; -- BASSE NARCISO ROBERTO
update public.usuarios set legajo_visual = 'BENITEZ M' where legajo_visual is null and cuil = '20260157958'; -- BENITEZ MIGUEL ANGEL
update public.usuarios set legajo_visual = 'BLANCO' where legajo_visual is null and cuil = '20206740672'; -- BLANCO ROBERTO ALEJANDRO
update public.usuarios set legajo_visual = 'BORGNIS' where legajo_visual is null and cuil = '20280355942'; -- BORGNIS MARTIN GABRIEL
update public.usuarios set legajo_visual = 'BUSTAMANTE DAMIAN ARIEL' where legajo_visual is null and cuil = '27306711585'; -- BUSTAMANTE DAMIAN ARIEL
update public.usuarios set legajo_visual = 'BUSTOS' where legajo_visual is null and cuil = '20404513797'; -- BUSTOS SANTIAGO AGUSTIN
update public.usuarios set legajo_visual = 'CACERES d' where legajo_visual is null and cuil = '20265689001'; -- CACERES DARIO
update public.usuarios set legajo_visual = '009 Bis' where legajo_visual is null and cuil = '20420339616'; -- CENTURION AGUSTIN EZEQUIEL
update public.usuarios set legajo_visual = 'CONTARDE' where legajo_visual is null and cuil = '20227799855'; -- CONTARDE MAURO RENE
update public.usuarios set legajo_visual = 'CORREA SERGIO ADRIAN' where legajo_visual is null and cuil = '20281259882'; -- CORREA SERGIO ADRIAN
update public.usuarios set legajo_visual = '003 Bis' where legajo_visual is null and cuil = '20312511925'; -- FAIXAT DAVID ANTONIO
update public.usuarios set legajo_visual = 'FERNANDEZ a' where legajo_visual is null and cuil = '20359132132'; -- FERNANDEZ ALBERTO MAXIMILIANO
update public.usuarios set legajo_visual = 'FERNANDEZ BALTAR' where legajo_visual is null and cuil = '20291403779'; -- FERNANDEZ BALTAR LISANDRO MIGUEL
update public.usuarios set legajo_visual = 'FERNANDEZ j' where legajo_visual is null and cuil = '20408918228'; -- FERNANDEZ JONATAN OSCAR
update public.usuarios set legajo_visual = 'FIGGINI MAXIMILIANO' where legajo_visual is null and cuil = '20463702285'; -- FIGGINI MAXIMILIANO TOMAS
update public.usuarios set legajo_visual = 'FLEYTAS' where legajo_visual is null and cuil = '20173370955'; -- FLEYTAS CLAUDIO LUJAN
update public.usuarios set legajo_visual = 'FOT' where legajo_visual is null and cuil = '20227096617'; -- FOTI ADRIAN JORGE
update public.usuarios set legajo_visual = 'FULLA w' where legajo_visual is null and cuil = '20285365814'; -- FULLA WALTER DARIO
update public.usuarios set legajo_visual = 'GALLO 2' where legajo_visual is null and cuil = '20334238688'; -- GALLO LAUDELINO ORESTE
update public.usuarios set legajo_visual = 'GAUTO' where legajo_visual is null and cuil = '23398180119'; -- GAUTO MISAEL NICOLAS
update public.usuarios set legajo_visual = 'GOMEZ JOSE MARIA' where legajo_visual is null and cuil = '20331285359'; -- GOMEZ JOSE MARIA
update public.usuarios set legajo_visual = '007 Bis' where legajo_visual is null and cuil = '20394555577'; -- GOMEZ LUCAS EMANUEL
update public.usuarios set legajo_visual = 'GONZALEZ a' where legajo_visual is null and cuil = '23303816089'; -- GONZALEZ ADALBERTO LUCAS
update public.usuarios set legajo_visual = 'GONZALEZ NICOLaS' where legajo_visual is null and cuil = '20449187483'; -- GONZALEZ NICOL?S FEDERICO
update public.usuarios set legajo_visual = 'GURUCHAR' where legajo_visual is null and cuil = '23142066599'; -- GURUCHAR ADRIAN OMAR
update public.usuarios set legajo_visual = 'IBARRA JONATAN' where legajo_visual is null and cuil = '20352944166'; -- IBARRA JONATAN EZEQUIEL
update public.usuarios set legajo_visual = 'LEGUIZAMON r' where legajo_visual is null and cuil = '20266772484'; -- LEGUIZAMON RUBEN DARIO
update public.usuarios set legajo_visual = 'LUDUEnACRISTIAN' where legajo_visual is null and cuil = '20238072396'; -- LUDUEÑA CRISTIAN OSCAR
update public.usuarios set legajo_visual = 'MAIDANA' where legajo_visual is null and cuil = '20393689618'; -- MAIDANA JUAN CLAUDIO
update public.usuarios set legajo_visual = 'MARTINEZ E' where legajo_visual is null and cuil = '20381327192'; -- MARTINEZ EDUARDO DARIO
update public.usuarios set legajo_visual = 'MARTINEZ RAUL EXEQUIEL' where legajo_visual is null and cuil = '20311154703'; -- MARTINEZ RAUL EXEQUIEL
update public.usuarios set legajo_visual = 'MARTINEZ SANTIAGO NICOLAS' where legajo_visual is null and cuil = '20433774389'; -- MARTINEZ SANTIAGO NICOLAS
update public.usuarios set legajo_visual = 'MARTINEZ S' where legajo_visual is null and cuil = '20260157400'; -- MARTINEZ SERGIO RUBEN
update public.usuarios set legajo_visual = '013' where legajo_visual is null and cuil = '23400389829'; -- MENA BRIAN LUCIANO
update public.usuarios set legajo_visual = 'MENA' where legajo_visual is null and cuil = '23201676339'; -- MENA ROBERTO CARLOS
update public.usuarios set legajo_visual = 'OJEDA m' where legajo_visual is null and cuil = '20395019474'; -- OJEDA MARCOS NICOLAS
update public.usuarios set legajo_visual = 'OTERO' where legajo_visual is null and cuil = '20354572738'; -- OTERO RUBEN GUSTAVO
update public.usuarios set legajo_visual = 'OVEJERO' where legajo_visual is null and cuil = '20247729187'; -- OVEJERO CESAR FABIAN
update public.usuarios set legajo_visual = 'OYOLA' where legajo_visual is null and cuil = '20262020852'; -- OYOLA JORGE MARCELO
update public.usuarios set legajo_visual = '010 Bis' where legajo_visual is null and cuil = '20441767871'; -- PANIAGUA EDGAR IVAN
update public.usuarios set legajo_visual = '001 Bis' where legajo_visual is null and cuil = '20477655239'; -- PEREZ SANTIAGO MATIAS
update public.usuarios set legajo_visual = 'PINERO WALTER DANIE' where legajo_visual is null and cuil = '20304070170'; -- PIÑERO WALTER DANIEL
update public.usuarios set legajo_visual = 'PONCE' where legajo_visual is null and cuil = '20307020476'; -- PONCE PABLO NICOLAS
update public.usuarios set legajo_visual = 'PRINZEN' where legajo_visual is null and cuil = '20135023826'; -- PRINZEN MIGUEL ANGEL
update public.usuarios set legajo_visual = 'QUINTANA' where legajo_visual is null and cuil = '23235137259'; -- QUINTANA CARLOS WALTER
update public.usuarios set legajo_visual = 'RAMOS c' where legajo_visual is null and cuil = '20370739340'; -- RAMOS CLAUDIO ARIEL
update public.usuarios set legajo_visual = '008 Bis' where legajo_visual is null and cuil = '20416925713'; -- RAMOS JUAN BAUTISTA
update public.usuarios set legajo_visual = 'RIOS raul' where legajo_visual is null and cuil = '23167284779'; -- RIOS RAUL MIGUEL
update public.usuarios set legajo_visual = 'RIVA' where legajo_visual is null and cuil = '20233444953'; -- RIVAS JUAN DOMINGO
update public.usuarios set legajo_visual = '001 Bis' where legajo_visual is null and cuil = '20283797555'; -- RODRIGUEZ DIEGO FABIAN
update public.usuarios set legajo_visual = 'ROSON J' where legajo_visual is null and cuil = '20238571678'; -- ROSON JUAN RAMON
update public.usuarios set legajo_visual = 'SANCHEZ C' where legajo_visual is null and cuil = '20267102075'; -- SANCHEZ CESAR LUIS
update public.usuarios set legajo_visual = 'SERVIN' where legajo_visual is null and cuil = '20319315463'; -- SERVIN NESTOR ROMAN
update public.usuarios set legajo_visual = 'SILVA IVAN' where legajo_visual is null and cuil = '20407869002'; -- SILVA IVAN MAXIMILIANO
update public.usuarios set legajo_visual = 'SOLER JONATHAN' where legajo_visual is null and cuil = '20375375622'; -- SOLER JONATHAN EMANUEL
update public.usuarios set legajo_visual = 'TABORDA' where legajo_visual is null and cuil = '20336825653'; -- TABORDA NICOLAS MARTIN
update public.usuarios set legajo_visual = '002 Bis' where legajo_visual is null and cuil = '20295164507'; -- TABORDA PABLO FEDERICO
update public.usuarios set legajo_visual = 'TERA' where legajo_visual is null and cuil = '23174623929'; -- TERAN ADRIAN GUSTAVO
update public.usuarios set legajo_visual = 'VAZQUEZ VICTOR' where legajo_visual is null and cuil = '20416335061'; -- VAZQUEZ VICTOR EZEQUIEL
update public.usuarios set legajo_visual = 'VIEYRA' where legajo_visual is null and cuil = '20349379652'; -- VIEYRA ALBERTO HERNAN
update public.usuarios set legajo_visual = '011 Bis' where legajo_visual is null and cuil = '20446312996'; -- VILLA URIEL DANIEL

commit;
