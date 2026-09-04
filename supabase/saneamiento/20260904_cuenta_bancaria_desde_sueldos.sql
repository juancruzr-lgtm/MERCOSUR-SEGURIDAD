-- ============================================================================
-- SANEAMIENTO · cuenta_bancaria desde la planilla de sueldos (julio 2026)
-- ============================================================================
-- Carga la cuenta de acreditacion identificando a cada persona por CUIL
-- exacto. Solo completa donde cuenta_bancaria es NULL: jamas pisa un valor
-- ya cargado. Fuente: "sueldos julio para gpt.xlsx" (Escritorio, copia en
-- el scratchpad de la sesion 24bdec42), columna CUENTA. Requiere la
-- migracion 20260904120000. Reejecutable: cada update es idempotente.
-- EXCLUIDOS a proposito: filas 82-89 de la planilla (bloque borrador con
-- CUILes en la columna CUENTA), los sin CUIT (admins/supervisores: acosta,
-- monzon, juarez, narvarte, magaro, rodolfo romero, juan cruz, y ROMERO
-- FACUNDO por homonimos) y los sin cuenta (VAZQUEZ, WILHJELM).

begin;

update public.usuarios set cuenta_bancaria = '00404906522208' where cuenta_bancaria is null and cuil = '20144945817'; -- ALMADA, ESTANISLAO
update public.usuarios set cuenta_bancaria = '0720237988000004763790' where cuenta_bancaria is null and cuil = '20295393522'; -- ALMARA, SILVIO EDUARDO
update public.usuarios set cuenta_bancaria = '00403163342202' where cuenta_bancaria is null and cuil = '20251760307'; -- ARANDA, SABINO
update public.usuarios set cuenta_bancaria = '00417505691117' where cuenta_bancaria is null and cuil = '20431638267'; -- BARETTA, FRANCISCO CARLOS
update public.usuarios set cuenta_bancaria = '00402471892205' where cuenta_bancaria is null and cuil = '20182154181'; -- BARREIRO, ARIEL GUSTAVO
update public.usuarios set cuenta_bancaria = '00405585162204' where cuenta_bancaria is null and cuil = '20251614033'; -- BARRIENTOS, DANIEL GUSTAVO
update public.usuarios set cuenta_bancaria = '00405910512200' where cuenta_bancaria is null and cuil = '20385975024'; -- BARRIOS, BRIAN EMANUEL
update public.usuarios set cuenta_bancaria = '00401972702209' where cuenta_bancaria is null and cuil = '20149137751'; -- BASSE, NARCISO ROBERTO
update public.usuarios set cuenta_bancaria = '00405266222200' where cuenta_bancaria is null and cuil = '20260157958'; -- BENITEZ, MIGUEL ANGEL
update public.usuarios set cuenta_bancaria = '00405209012200' where cuenta_bancaria is null and cuil = '20206740672'; -- BLANCO, ROBERTO ALEJANDRO
update public.usuarios set cuenta_bancaria = '00403707622202' where cuenta_bancaria is null and cuil = '20280355942'; -- BORGNIS, MARTÍN
update public.usuarios set cuenta_bancaria = '00407051792209' where cuenta_bancaria is null and cuil = '27306711585'; -- BUSTAMANTE, DAMIAN ARIEL
update public.usuarios set cuenta_bancaria = '00405266912207' where cuenta_bancaria is null and cuil = '20404513797'; -- BUSTOS, SANTIAGO
update public.usuarios set cuenta_bancaria = '00405363772208' where cuenta_bancaria is null and cuil = '20265689001'; -- CACERES, DARIO
update public.usuarios set cuenta_bancaria = '00401659313453' where cuenta_bancaria is null and cuil = '20227799855'; -- CONTARDE, MAURO
update public.usuarios set cuenta_bancaria = '00405549602208' where cuenta_bancaria is null and cuil = '20281259882'; -- CORREA, SERGIO ADRIAN
update public.usuarios set cuenta_bancaria = '00405113312207' where cuenta_bancaria is null and cuil = '20291403779'; -- FERNANDEZ BALTAR, LISANDRO
update public.usuarios set cuenta_bancaria = '00404976812205' where cuenta_bancaria is null and cuil = '20359132132'; -- FERNANDEZ, ALBERTO MAXIMILIANO
update public.usuarios set cuenta_bancaria = '00403845772206' where cuenta_bancaria is null and cuil = '20408918228'; -- FERNANDEZ,JONATAN
update public.usuarios set cuenta_bancaria = '00407040912208' where cuenta_bancaria is null and cuil = '20463702285'; -- FIGGINI, MAXIMILIANO
update public.usuarios set cuenta_bancaria = '00405113662208' where cuenta_bancaria is null and cuil = '20173370955'; -- FLEYTAS, CLAUDIO
update public.usuarios set cuenta_bancaria = '00401921982204' where cuenta_bancaria is null and cuil = '20227096617'; -- FOTI, ADRIAN
update public.usuarios set cuenta_bancaria = '00403039512200' where cuenta_bancaria is null and cuil = '20285365814'; -- FULLA, WALTER DARIO
update public.usuarios set cuenta_bancaria = '00400982053451' where cuenta_bancaria is null and cuil = '20334238688'; -- GALLO, LAUDELINO
update public.usuarios set cuenta_bancaria = '00405149012203' where cuenta_bancaria is null and cuil = '23398180119'; -- GAUTO, MISAEL
update public.usuarios set cuenta_bancaria = '00403354872209' where cuenta_bancaria is null and cuil = '23303816089'; -- GONZALEZ, ADALBERTO LUCAS
update public.usuarios set cuenta_bancaria = '00407040752200' where cuenta_bancaria is null and cuil = '20449187483'; -- GONZALEZ,NICOLAS
update public.usuarios set cuenta_bancaria = '00418475461111' where cuenta_bancaria is null and cuil = '20352944166'; -- IBARRA, JONATAN [cuenta tenia un espacio en la planilla: verificar]
update public.usuarios set cuenta_bancaria = '00405338742201' where cuenta_bancaria is null and cuil = '20266772484'; -- LEGUIZAMON, RUBEN DARIO
update public.usuarios set cuenta_bancaria = '00404470130349' where cuenta_bancaria is null and cuil = '20238072396'; -- LUDUEÑA, CRISTIAN OSCAR
update public.usuarios set cuenta_bancaria = '00404024272206' where cuenta_bancaria is null and cuil = '20393689618'; -- MAIDANA, JUAN CLAUDIO
update public.usuarios set cuenta_bancaria = '00402064232642' where cuenta_bancaria is null and cuil = '20311154703'; -- MARTINEZ RAUL
update public.usuarios set cuenta_bancaria = '00402981662203' where cuenta_bancaria is null and cuil = '20381327192'; -- MARTÍNEZ, EDUARDO
update public.usuarios set cuenta_bancaria = '00407051872202' where cuenta_bancaria is null and cuil = '20433774389'; -- MARTINEZ, SANTIAGO
update public.usuarios set cuenta_bancaria = '00401120112200' where cuenta_bancaria is null and cuil = '20260157400'; -- MARTINEZ, SERGIO
update public.usuarios set cuenta_bancaria = '00402797812203' where cuenta_bancaria is null and cuil = '23201676339'; -- MENA, ROBERTO CARLOS
update public.usuarios set cuenta_bancaria = '00404976912201' where cuenta_bancaria is null and cuil = '20395019474'; -- OJEDA, MARCOS NICOLAS
update public.usuarios set cuenta_bancaria = '00405329162206' where cuenta_bancaria is null and cuil = '20354572738'; -- OTERO, RUBÉN
update public.usuarios set cuenta_bancaria = '00405199442201' where cuenta_bancaria is null and cuil = '20247729187'; -- OVEJERO, CÉSAR
update public.usuarios set cuenta_bancaria = '00410506640752' where cuenta_bancaria is null and cuil = '20262020852'; -- OYOLA, JORGE MARCELO
update public.usuarios set cuenta_bancaria = '00411515410796' where cuenta_bancaria is null and cuil = '20304070170'; -- PINERO, WALTER [CUIT roto en la planilla; CUIL del padron]
update public.usuarios set cuenta_bancaria = '00402861412203' where cuenta_bancaria is null and cuil = '20307020476'; -- PONCE, PABLO NICOLÁS
update public.usuarios set cuenta_bancaria = '00403993292209' where cuenta_bancaria is null and cuil = '20135023826'; -- PRINZEN, MIGUEL ANGEL
update public.usuarios set cuenta_bancaria = '00402681352201' where cuenta_bancaria is null and cuil = '23235137259'; -- QUINTANA, CARLOS
update public.usuarios set cuenta_bancaria = '00403776512208' where cuenta_bancaria is null and cuil = '20370739340'; -- RAMOS, CLAUDIO
update public.usuarios set cuenta_bancaria = '00405338822205' where cuenta_bancaria is null and cuil = '23167284779'; -- RÍOS, RAUL MIGUEL
update public.usuarios set cuenta_bancaria = '00401972972206' where cuenta_bancaria is null and cuil = '20233444953'; -- RIVAS, JUAN DOMINGO
update public.usuarios set cuenta_bancaria = '00404569342204' where cuenta_bancaria is null and cuil = '20238571678'; -- ROSÓN, JUAN RAMÓN
update public.usuarios set cuenta_bancaria = '00403698712201' where cuenta_bancaria is null and cuil = '20267102075'; -- SANCHEZ, CÉSAR LUIS
update public.usuarios set cuenta_bancaria = '00404993072206' where cuenta_bancaria is null and cuil = '20319315463'; -- SERVIN, NESTOR ROMAN
update public.usuarios set cuenta_bancaria = '00405747322204' where cuenta_bancaria is null and cuil = '20407869002'; -- SILVA, IVAN MAXIMILIANO
update public.usuarios set cuenta_bancaria = '00406479852201' where cuenta_bancaria is null and cuil = '20375375622'; -- SOLER, JONATHAN EMANUEL
update public.usuarios set cuenta_bancaria = '00405075202202' where cuenta_bancaria is null and cuil = '20336825653'; -- TABORDA, NICOLÁS
update public.usuarios set cuenta_bancaria = '00401973272208' where cuenta_bancaria is null and cuil = '23174623929'; -- TERAN, ADRIAN
update public.usuarios set cuenta_bancaria = '00404976732201' where cuenta_bancaria is null and cuil = '20349379652'; -- VIEYRA, ALBERTO GERNAN

commit;
