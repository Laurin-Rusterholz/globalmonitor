/* ════════════════════════════════════════════════════════════════
   INTERNATIONALE ORGANISATIONEN
   ────────────────────────────────────────────────────────────────
   Über 70 internationale Organisationen mit Rolle, Mitgliedern,
   Funktion. Wird über window.ORGS verfügbar.
   ════════════════════════════════════════════════════════════════ */
window.ORGS = {

// ════ UN-SYSTEM ════
'UN':     { name:'Vereinte Nationen', full:'United Nations', founded:1945, members:193, hq:'New York (US)', type:'political', desc:'Wichtigstes Forum globaler Diplomatie. 193 Mitgliedstaaten, 6 Organe (UNGA, UNSC, ECOSOC, IGH, Sekretariat, Treuhandrat).', role:'Hauptforum für Krisendiplomatie - aber blockiert durch Veto-Mächte im Sicherheitsrat.', web:'https://www.un.org' },
'UNSC':   { name:'UN-Sicherheitsrat', full:'UN Security Council', founded:1945, members:15, memberIsos:['US','GB','FR','CN','RU'], hq:'New York', type:'political', desc:'5 ständige Vetomächte (USA, UK, FR, CN, RU) + 10 nicht-ständige Mitglieder (rotieren). Resolutionen verbindlich nach Kapitel VII.', role:'Zentrale Konflikt-Resolutionen - Ukraine-Krieg (Veto RU), Gaza (Veto US), Iran (gemischt).', web:'https://www.un.org/securitycouncil' },
'UNGA':   { name:'UN-Generalversammlung', full:'UN General Assembly', founded:1945, members:193, hq:'New York', type:'political', desc:'Alle 193 Mitglieder, jeder eine Stimme. Resolutionen nicht-bindend aber legitimitätsstiftend.', role:'Verurteilungs-Resolutionen (Russland-Ukraine 141-7, Israel-Gaza wechselnd).', web:'https://www.un.org/en/ga' },
'IAEO':   { name:'IAEA / IAEO', full:'International Atomic Energy Agency', founded:1957, members:178, hq:'Wien (AT)', type:'specialized', desc:'UN-Sonderorganisation für friedliche Nutzung der Atomenergie und Nichtverbreitungs-Überwachung.', role:'Inspekteure in Iran, Nordkorea, Saporischschja-AKW im Ukraine-Krieg.', web:'https://www.iaea.org' },
'WHO':    { name:'WHO', full:'World Health Organization', founded:1948, members:194, hq:'Genf (CH)', type:'specialized', desc:'UN-Gesundheits-Sonderorganisation.', role:'COVID-Lessons, Pandemievertrag-Verhandlungen, Gaza-Gesundheitskrise.', web:'https://www.who.int' },
'WTO':    { name:'WTO', full:'World Trade Organization', founded:1995, members:164, hq:'Genf', type:'economic', desc:'Welthandelsorganisation. Regeln für internationalen Handel und Streitbeilegung.', role:'Trump-Zoll-Streitigkeiten lähmen Berufungsgremium. China-Reform-Debatte.', web:'https://www.wto.org' },
'IWF':    { name:'IWF (IMF)', full:'International Monetary Fund', founded:1944, members:190, hq:'Washington (US)', type:'economic', desc:'Internationaler Währungsfonds. Notkredite, Wirtschafts-Stabilisierung.', role:'Aktive Programme: Ägypten, Pakistan, Sri Lanka, Argentinien, Ukraine.', web:'https://www.imf.org' },
'WB':     { name:'Weltbank', full:'World Bank Group', founded:1944, members:189, hq:'Washington', type:'economic', desc:'Entwicklungsfinanzierung. IBRD + IDA + IFC + MIGA + ICSID.', role:'Ukraine-Wiederaufbau (geplant >500 Mrd), Klimafinanzierung, Bridgetown-Initiative.', web:'https://www.worldbank.org' },
'UNHCR':  { name:'UNHCR', full:'UN High Commissioner for Refugees', founded:1950, members:'-', hq:'Genf', type:'humanitarian', desc:'Flüchtlingshilfswerk. Mandat: Schutz und Lösungen für Vertriebene.', role:'120M+ Vertriebene weltweit Rekord. Ukraine, Sudan, Gaza, Myanmar.', web:'https://www.unhcr.org' },
'UNICEF': { name:'UNICEF', full:'UN Children\'s Fund', founded:1946, members:'-', hq:'New York', type:'humanitarian', desc:'Kinderhilfswerk der UN.', role:'Bildungs- und Gesundheitsprogramme in Krisengebieten.', web:'https://www.unicef.org' },
'WFP':    { name:'WFP', full:'World Food Programme', founded:1961, members:'-', hq:'Rom (IT)', type:'humanitarian', desc:'Welternährungsprogramm. Größte humanitäre Org.', role:'Hungerkrisen Sudan, Gaza, Jemen, Afghanistan. Friedensnobelpreis 2020.', web:'https://www.wfp.org' },
'UNRWA':  { name:'UNRWA', full:'UN Relief and Works Agency for Palestine Refugees', founded:1949, members:'-', hq:'Amman+Gaza', type:'humanitarian', desc:'Speziell für palästinensische Flüchtlinge. Schulen, Gesundheit.', role:'2024: schwere Krise nach israelischen Vorwürfen, US-Finanzierung gekürzt.', web:'https://www.unrwa.org' },
'OCHA':   { name:'OCHA', full:'Office for Coordination of Humanitarian Affairs', founded:1991, members:'-', hq:'New York', type:'humanitarian', desc:'Koordiniert humanitäre UN-Reaktionen.', role:'Reliefweb, FTS, humanitäre Bedarfs-Reports.', web:'https://www.unocha.org' },
'IGH':    { name:'IGH (ICJ)', full:'International Court of Justice', founded:1945, members:193, hq:'Den Haag (NL)', type:'judicial', desc:'Hauptrechtsorgan der UN für Staatenstreitigkeiten.', role:'Südafrika vs Israel (Völkermord-Anklage), Nicaragua vs Deutschland.', web:'https://www.icj-cij.org' },
'IStGH':  { name:'IStGH (ICC)', full:'International Criminal Court', founded:2002, members:124, hq:'Den Haag', type:'judicial', desc:'Verfolgt Individuen für Völkermord, Kriegsverbrechen, Verbrechen gg. Menschlichkeit. USA, China, Russland nicht Mitglied.', role:'Haftbefehle 2024: Netanyahu, Gallant, Putin, Lwowa-Belowa, Hamas-Führer.', web:'https://www.icc-cpi.int' },
'OPCW':   { name:'OPCW', full:'Organisation for the Prohibition of Chemical Weapons', founded:1997, members:193, hq:'Den Haag', type:'judicial', desc:'Überwacht Chemiewaffen-Konvention.', role:'Syrien-Chemiewaffen-Inspektionen, Skripal/Nawalny Novichok-Untersuchungen.', web:'https://www.opcw.org' },

// ════ MILITÄRBÜNDNISSE ════
'NATO':   { name:'NATO', full:'North Atlantic Treaty Organization', founded:1949, members:32, memberIsos:['US','CA','GB','FR','DE','IT','ES','PL','NL','BE','LU','PT','NO','DK','IS','TR','GR','CZ','SK','HU','RO','BG','SI','EE','LT','LV','HR','AL','ME','MK','FI','SE'], hq:'Brüssel (BE)', type:'military', desc:'Verteidigungsbündnis. Artikel 5 = kollektive Verteidigung. Mil-Ausgaben: ~$1,3 Bil zusammen.', role:'Ukraine-Hauptunterstützer (ohne direkte Teilnahme). Ostflanken-Aufrüstung. Trump-Beistands-Zweifel.', web:'https://www.nato.int' },
'CSTO':   { name:'OVKS (CSTO)', full:'Collective Security Treaty Organization', founded:2002, members:6, memberIsos:['RU','BY','KZ','KG','TJ','AM'], hq:'Moskau', type:'military', desc:'Russland-geführtes Verteidigungsbündnis ehem. Sowjetstaaten. Armenien Mitgliedschaft eingefroren.', role:'Kasachstan-Intervention 2022. Schwer beschädigt durch Berg-Karabach (CSTO nicht intervenierend).', web:'https://en.odkb-csto.org' },
'AUKUS':  { name:'AUKUS', full:'Australia-UK-US Security Pact', founded:2021, members:3, memberIsos:['AU','GB','US'], hq:'-', type:'military', desc:'Trilateral. Hauptziel: nukleare U-Boote für Australien + KI/Quanten-Tech.', role:'Indo-Pazifik-Antwort auf Chinas Aufstieg.', web:'-' },
'QUAD':   { name:'QUAD', full:'Quadrilateral Security Dialogue', founded:2007, members:4, memberIsos:['US','JP','IN','AU'], hq:'-', type:'military', desc:'Informelles Sicherheits-Forum. Keine Allianz im klassischen Sinn.', role:'Indo-Pazifik-Balance gegen China. Indien hält Distanz zu offener Anti-CN-Linie.', web:'-' },
'ANZUS':  { name:'ANZUS', full:'Australia-New Zealand-US Treaty', founded:1951, members:3, memberIsos:['AU','NZ','US'], hq:'-', type:'military', desc:'Pazifik-Sicherheitspakt. NZ-Pflichten 1986 wegen Atomwaffen-Streit suspendiert.', role:'Faktisch nur US-AU aktiv.', web:'-' },
'5EYES':  { name:'Five Eyes', full:'Five Eyes Intelligence Alliance', founded:1946, members:5, memberIsos:['US','GB','CA','AU','NZ'], hq:'-', type:'military', desc:'Geheimdienst-Allianz. SIGINT-Sharing (NSA, GCHQ, CSE, ASD, GCSB).', role:'Engste westliche Intel-Kooperation. China-Spionage-Berichte.', web:'-' },
'JEF':    { name:'JEF', full:'Joint Expeditionary Force', founded:2014, members:10, memberIsos:['GB','DK','EE','FI','IS','LV','LT','NL','NO','SE'], hq:'-', type:'military', desc:'UK-geführte schnelle Eingreiftruppe Nord-Europa.', role:'Ostsee-/Arktis-Patrouillen.', web:'-' },

// ════ EU & EUROPA ════
'EU':     { name:'EU', full:'European Union', founded:1993, members:27, memberIsos:['DE','FR','IT','ES','NL','BE','LU','PT','AT','IE','DK','SE','FI','PL','CZ','SK','HU','RO','BG','SI','HR','EE','LT','LV','GR','CY','MT'], hq:'Brüssel', type:'political', desc:'Politische und Wirtschaftsunion. 450M Menschen. Beitrittskandidaten: UA, MD, BA, ME, MK, AL, RS, TR (eingefroren), GE (ausgesetzt).', role:'Sanktionspakete gg. Russland, Ukraine-Hilfe, Migrations-Politik.', web:'https://europa.eu' },
'EFTA':   { name:'EFTA', full:'European Free Trade Association', founded:1960, members:4, memberIsos:['CH','NO','IS','LI'], hq:'Genf', type:'economic', desc:'Freihandelszone Nicht-EU-Europa. CH, NO, IS, LI.', role:'Bilaterale Verträge mit EU. CH-EU-Rahmenabkommen-Verhandlungen.', web:'https://www.efta.int' },
'EWR':    { name:'EWR (EEA)', full:'European Economic Area', founded:1994, members:30, hq:'-', type:'economic', desc:'EU + NO, IS, LI im Binnenmarkt.', role:'Bietet EU-Marktzugang ohne EU-Mitgliedschaft.', web:'-' },
'OSZE':   { name:'OSZE (OSCE)', full:'Organization for Security and Cooperation in Europe', founded:1975, members:57, hq:'Wien', type:'political', desc:'Größte regionale Sicherheitsorg. weltweit. KSZE-Helsinki-Akte.', role:'Ukraine-Beobachtungsmissionen 2014-22, Konsens-Lähmung durch RU.', web:'https://www.osce.org' },
'CoE':    { name:'Europarat', full:'Council of Europe', founded:1949, members:46, hq:'Strasbourg (FR)', type:'political', desc:'46 Staaten. EMRK, EGMR. Russland ausgeschlossen 2022.', role:'Menschenrechte. Ukraine-Schadenregister.', web:'https://www.coe.int' },
'V4':     { name:'Visegrád-Gruppe', full:'Visegrád Four', founded:1991, members:4, memberIsos:['CZ','HU','PL','SK'], hq:'rotierend', type:'political', desc:'Mitteleuropäische Kooperation.', role:'Ukraine-Spaltung: HU/SK pro-RU, PL/CZ pro-UA.', web:'https://www.visegradgroup.eu' },
'Drei-Meere':{ name:'Drei-Meere-Initiative', full:'Three Seas Initiative', founded:2015, members:13, hq:'-', type:'economic', desc:'12 EU-Staaten zwischen Ostsee, Adria, Schwarzem Meer. Polen-geführt.', role:'Infrastruktur-Süd-Nord-Korridore als Anti-RU-Strategie.', web:'-' },

// ════ ASIEN ════
'ASEAN':  { name:'ASEAN', full:'Association of Southeast Asian Nations', founded:1967, members:10, memberIsos:['ID','MY','TH','SG','PH','VN','MM','LA','KH','BN'], hq:'Jakarta (ID)', type:'political', desc:'Südostasiatische Staatengemeinschaft. Konsens-Prinzip.', role:'Süd-China-See-Konflikte, Myanmar-Krise (5-Punkte-Konsens ohne Wirkung).', web:'https://asean.org' },
'SCO':    { name:'SCO', full:'Shanghai Cooperation Organization', founded:2001, members:10, memberIsos:['CN','RU','KZ','KG','TJ','UZ','IN','PK','IR','BY'], hq:'Peking (CN)', type:'political', desc:'Eurasisches Sicherheitsforum. Belarus 2024 beigetreten.', role:'Anti-Westen-Block, Eurasische Kooperation. Iran-Beitritt 2023.', web:'http://eng.sectsco.org' },
'BRICS+': { name:'BRICS+', full:'BRICS+', founded:2006, members:9, memberIsos:['BR','RU','IN','CN','ZA','IR','AE','EG','ET'], hq:'-', type:'economic', desc:'Erweitert 2024 um IR, AE, EG, ET (SA ungeklärt, AR abgesagt). Mehr als G7-Bevölkerung.', role:'Dollar-Alternative-Bemühungen, BRICS Pay, Anti-Westen-Forum.', web:'-' },
'GCC':    { name:'GCC', full:'Gulf Cooperation Council', founded:1981, members:6, memberIsos:['SA','AE','KW','QA','BH','OM'], hq:'Riad (SA)', type:'economic', desc:'Golf-Kooperationsrat. Erdöl/Erdgas-dominiert.', role:'Iran-Ausgleich, Mediator-Funktionen (QA: Hamas, OM: Iran).', web:'https://www.gcc-sg.org' },
'EAEU':   { name:'EAWU (EAEU)', full:'Eurasian Economic Union', founded:2014, members:5, memberIsos:['RU','BY','KZ','KG','AM'], hq:'Moskau', type:'economic', desc:'Russland-geführte Zollunion. Iran assoziiert.', role:'Sanktions-Umgehung über Mitgliedstaaten.', web:'-' },
'SAARC':  { name:'SAARC', full:'South Asian Association for Regional Cooperation', founded:1985, members:8, memberIsos:['AF','BD','BT','IN','MV','NP','PK','LK'], hq:'Kathmandu (NP)', type:'political', desc:'Südasiatische Kooperation.', role:'Faktisch paralysiert durch IN-PK-Spannungen.', web:'http://www.saarc-sec.org' },
'CPTPP':  { name:'CPTPP', full:'Comprehensive and Progressive Trans-Pacific Partnership', founded:2018, members:12, hq:'-', type:'economic', desc:'Pazifik-Handelspakt nach US-Ausstieg unter Trump-1. UK 2024 beigetreten.', role:'CN-Beitrittsantrag offen. TW-Beitritt blockiert.', web:'-' },
'RCEP':   { name:'RCEP', full:'Regional Comprehensive Economic Partnership', founded:2020, members:15, hq:'-', type:'economic', desc:'Asien-Pazifik-Handelspakt. ASEAN + CN, JP, KR, AU, NZ. Größtes Handelsabkommen weltweit.', role:'China-zentriertes Handelsregime. Indien nicht beigetreten.', web:'-' },

// ════ AFRIKA ════
'AU':     { name:'AU', full:'African Union', founded:2002, members:55, hq:'Addis Abeba (ET)', type:'political', desc:'Nachfolger OAU. Friedens- und Sicherheitsrat. Burkina/Mali/Niger/Gabun/Guinea/Sudan suspendiert.', role:'Sahel-Krise, Sudan-Vermittlungsversuche.', web:'https://au.int' },
'ECOWAS': { name:'ECOWAS', full:'Economic Community of West African States', founded:1975, members:15, hq:'Abuja (NG)', type:'economic', desc:'15 westafrikanische Staaten. Mali/Burkina/Niger 2024 ausgetreten.', role:'Krise nach Sahel-Putschen, Sahel-Allianz-Konkurrenz.', web:'https://ecowas.int' },
'SADC':   { name:'SADC', full:'Southern African Development Community', founded:1992, members:16, hq:'Gaborone (BW)', type:'political', desc:'Südliches Afrika.', role:'Mosambik-Cabo Delgado, DRC Ost-Konflikt-Intervention.', web:'https://www.sadc.int' },
'EAC':    { name:'EAC', full:'East African Community', founded:2000, members:7, hq:'Arusha (TZ)', type:'political', desc:'KE, UG, TZ, BI, RW, SS, DRC, Somalia (2024).', role:'DRC-Krise (EACRF abgezogen). Somalia-Beitritt.', web:'https://www.eac.int' },
'IGAD':   { name:'IGAD', full:'Intergovernmental Authority on Development', founded:1996, members:7, hq:'Djibouti', type:'political', desc:'Horn von Afrika.', role:'Sudan-Vermittlungen, Äthiopien-Tigray, Südsudan.', web:'https://igad.int' },
'AES':    { name:'Alliance of Sahel States (AES)', full:'Confédération des États du Sahel', founded:2023, members:3, memberIsos:['ML','BF','NE'], hq:'Niamey', type:'military', desc:'Sahel-Allianz der drei Junta-Staaten. Pro-Russland-orientiert.', role:'Ersetzt G5 Sahel und ECOWAS-Bindung. Wagner/Africa Corps zentral.', web:'-' },
'AfCFTA': { name:'AfCFTA', full:'African Continental Free Trade Area', founded:2018, members:54, hq:'Accra (GH)', type:'economic', desc:'Größte Freihandelszone weltweit (Mitgliederzahl).', role:'Langsame Umsetzung. Symbolisch wichtig.', web:'-' },

// ════ AMERIKA ════
'OAS':    { name:'OAS', full:'Organization of American States', founded:1948, members:35, hq:'Washington', type:'political', desc:'Amerikanische Staatenorganisation. Kuba 1962 suspendiert, eingeladen 2009 (nicht zurück). Venezuela Krise.', role:'Schwach geworden. CELAC als Alternative.', web:'http://www.oas.org' },
'USMCA':  { name:'USMCA', full:'United States-Mexico-Canada Agreement', founded:2020, members:3, memberIsos:['US','MX','CA'], hq:'-', type:'economic', desc:'NAFTA-Nachfolge. 2026 Review.', role:'Trump-Zölle gefährden Vertrag.', web:'-' },
'Mercosur':{ name:'Mercosur', full:'Mercado Común del Sur', founded:1991, members:6, memberIsos:['AR','BR','PY','UY','BO','VE'], hq:'Montevideo (UY)', type:'economic', desc:'Südamerikanischer Gemeinsamer Markt. Venezuela suspendiert.', role:'EU-Mercosur-Abkommen 2024 fertig verhandelt - umstritten in Frankreich.', web:'-' },
'CARICOM':{ name:'CARICOM', full:'Caribbean Community', founded:1973, members:15, hq:'Georgetown (GY)', type:'political', desc:'Karibische Gemeinschaft.', role:'Haiti-Krise, Klimaschutz-Stimme.', web:'https://caricom.org' },
'ALBA':   { name:'ALBA', full:'Bolivarian Alliance for the Peoples of Our America', founded:2004, members:10, memberIsos:['VE','CU','NI','BO','DM','AG','SV','HN','VC','LC','KN','GD'], hq:'Caracas (VE)', type:'political', desc:'Anti-USA-Block in Lateinamerika.', role:'Schwach: nur Kuba/VE/NI aktiv. ALBA-TCP-Initiativen.', web:'-' },
'CELAC':  { name:'CELAC', full:'Community of Latin American and Caribbean States', founded:2010, members:33, hq:'-', type:'political', desc:'Alle Latam-Staaten ohne USA/Kanada.', role:'Russland/China-Annäherung, EU-CELAC-Gipfel.', web:'-' },

// ════ NAH-/MITTELOST ════
'AL':     { name:'Arabische Liga', full:'Arab League', founded:1945, members:22, hq:'Kairo (EG)', type:'political', desc:'22 arabische Staaten. Syrien 2023 wiederaufgenommen.', role:'Gaza-Beirat, Saudi-Iran-Annäherung, Sudan.', web:'-' },
'OIC':    { name:'OIC', full:'Organisation of Islamic Cooperation', founded:1969, members:57, hq:'Jeddah (SA)', type:'political', desc:'Größte muslimische Org. (57 Staaten).', role:'Gaza-Diplomatie, Indien-Kashmir-Position.', web:'https://www.oic-oci.org' },
'OPEC':   { name:'OPEC', full:'Organization of Petroleum Exporting Countries', founded:1960, members:12, memberIsos:['DZ','AO','CG','GQ','GA','IR','IQ','KW','LY','NG','SA','AE','VE'], hq:'Wien', type:'economic', desc:'Ölproduzenten-Kartell. Ecuador, Indonesien, Katar ausgetreten.', role:'Förder-Quoten beeinflussen Welt-Ölpreis maßgeblich.', web:'https://www.opec.org' },
'OPEC+':  { name:'OPEC+', full:'OPEC + Non-OPEC Producers', founded:2016, members:23, hq:'-', type:'economic', desc:'OPEC + RU, MX, KZ, OM und weitere.', role:'Saudi-Russland-Förderkürzungen seit 2023 zur Preis-Stützung.', web:'-' },

// ════ G-FORMATE ════
'G7':     { name:'G7', full:'Group of Seven', founded:1975, members:7, memberIsos:['US','GB','FR','DE','IT','CA','JP'], hq:'-', type:'political', desc:'Westliche Industriestaaten + EU. Russland 2014 ausgeschlossen.', role:'Ukraine-Hilfen-Koordination, Sanktions-Ausweitung, Preis-Cap Öl.', web:'-' },
'G20':    { name:'G20', full:'Group of Twenty', founded:1999, members:19, hq:'-', type:'political', desc:'20 größte Volkswirtschaften (19 Staaten + EU + AU). Brasilien-Vorsitz 2024, Südafrika 2025, USA 2026.', role:'Klima, Schulden, Globale Steuern. Trump-Boykott möglich.', web:'-' },
'G77':    { name:'G77', full:'Group of 77', founded:1964, members:134, hq:'-', type:'political', desc:'Größter Block im UN-System: Entwicklungsländer + China.', role:'COP-Verhandlungen, IMF-Reform-Forderungen.', web:'https://www.g77.org' },
'NAM':    { name:'Bewegung Blockfreier', full:'Non-Aligned Movement', founded:1961, members:120, hq:'-', type:'political', desc:'120 Staaten - größter Block nach UN.', role:'Indien-Brasilien-Gespräche, schwächer als G77.', web:'-' },
'OECD':   { name:'OECD', full:'Organisation for Economic Cooperation and Development', founded:1961, members:38, hq:'Paris (FR)', type:'economic', desc:'"Club der Reichen". Klassisch entwickelte Wirtschaften.', role:'Globale Steuer-Reform (2-Säulen-Lösung), Anti-Korruption.', web:'https://www.oecd.org' },

// ════ FINANZ/REGULIERUNG ════
'BIS':    { name:'BIZ (BIS)', full:'Bank for International Settlements', founded:1930, members:63, hq:'Basel (CH)', type:'economic', desc:'"Zentralbank der Zentralbanken". 63 Mitgliedszentralbanken.', role:'Basel III/IV Reform, CBDC-Forschung.', web:'https://www.bis.org' },
'FSB':    { name:'FSB', full:'Financial Stability Board', founded:2009, members:25, hq:'Basel', type:'economic', desc:'Internationale Finanzstabilitätsbehörde.', role:'Crypto-Regulierung, Klima-Risiko-Standards.', web:'https://www.fsb.org' },
'FATF':   { name:'FATF', full:'Financial Action Task Force', founded:1989, members:40, hq:'Paris', type:'specialized', desc:'Geldwäsche-/Terrorfinanzierungs-Bekämpfung.', role:'Schwarze Liste: NK, IR, MM. Graue Liste: TR, AE (entfernt 2024).', web:'https://www.fatf-gafi.org' },

// ════ EXPORTKONTROLLE ════
'NSG':    { name:'NSG', full:'Nuclear Suppliers Group', founded:1975, members:48, hq:'-', type:'specialized', desc:'Atomtechnologie-Exportkontrolle.', role:'Indien-Beitritts-Streit blockiert seit Jahren (CN-Veto).', web:'-' },
'MTCR':   { name:'MTCR', full:'Missile Technology Control Regime', founded:1987, members:35, hq:'-', type:'specialized', desc:'Raketen-/Drohnen-Tech-Kontrolle.', role:'CN, IR, NK nicht Mitglieder.', web:'-' },
'WA':     { name:'Wassenaar-Abkommen', full:'Wassenaar Arrangement', founded:1996, members:42, hq:'Wien', type:'specialized', desc:'Konventionelle Waffen + Dual-Use-Tech.', role:'Russland 2022 ausgeschlossen.', web:'-' },

// ════ HUMANITÄR/NGO ════
'IKRK':   { name:'IKRK', full:'International Committee of the Red Cross', founded:1863, members:'-', hq:'Genf', type:'humanitarian', desc:'Genfer Konventionen Hüterin. Neutral.', role:'Gefangenenaustausch Ukraine, Gaza-Geiseln, Sudan-Korridor.', web:'https://www.icrc.org' },
'MSF':    { name:'Ärzte ohne Grenzen', full:'Médecins Sans Frontières', founded:1971, members:'-', hq:'Genf', type:'humanitarian', desc:'Med. Nothilfe in Krisen. 1999 Nobelpreis.', role:'Gaza-Krise, Sudan, Mittelmeer-Seenotrettung.', web:'https://www.msf.org' },

// ════ JUSTIZ/SCHIEDS ════
'ITLOS':  { name:'ITLOS', full:'International Tribunal for the Law of the Sea', founded:1996, members:'-', hq:'Hamburg (DE)', type:'judicial', desc:'Seerechts-Tribunal.', role:'Süd-China-See-Urteile, Klima-Gutachten 2024.', web:'https://www.itlos.org' },
'PCA':    { name:'PCA', full:'Permanent Court of Arbitration', founded:1899, members:122, hq:'Den Haag', type:'judicial', desc:'Internationale Schiedsgerichtsbarkeit. Älteste IGO weltweit.', role:'2016 Schiedsspruch Süd-China-See (CN ignoriert).', web:'-' },

// ════ POLIZEI/SICHERHEIT ════
'INTERPOL':{name:'INTERPOL', full:'International Criminal Police Organization', founded:1923, members:196, hq:'Lyon (FR)', type:'specialized', desc:'195 Mitglieder + Palästina. Rote Notices.', role:'Russland-Missbrauchsvorwürfe, Korea-Süd-Vorsitz 2024.', web:'https://www.interpol.int' },
'Europol':{name:'Europol', full:'European Union Agency for Law Enforcement Cooperation', founded:1999, members:27, hq:'Den Haag', type:'specialized', desc:'EU-Polizei-Kooperation.', role:'Organisierte Kriminalität, Cybercrime, Terror.', web:'https://www.europol.europa.eu' },

// ════ KULTUR/SPRACHE ════
'Commonwealth':{name:'Commonwealth', full:'Commonwealth of Nations', founded:1949, members:56, hq:'London', type:'political', desc:'56 Mitglieder, meist Ex-Briten-Kolonien. Mosambik/Ruanda/Togo/Gabun ohne Kolonial-Bindung.', role:'Sicht von Charles III. zentral. Republik-Diskussionen.', web:'https://thecommonwealth.org' },
'Frankophonie':{name:'Frankophonie (OIF)', full:'Organisation Internationale de la Francophonie', founded:1970, members:88, hq:'Paris', type:'political', desc:'88 frz.-sprachige Mitglieder/Beobachter.', role:'Afrika-Krise: Mali/Burkina/Niger ausgetreten.', web:'https://www.francophonie.org' },
'CPLP':   { name:'CPLP', full:'Comunidade dos Países de Língua Portuguesa', founded:1996, members:9, hq:'Lissabon (PT)', type:'political', desc:'Portugiesisch-sprachige Staaten.', role:'Mosambik, Brasilien-Vermittlung.', web:'-' },
'TURK':   { name:'Türk. Staaten-Organisation', full:'Organization of Turkic States', founded:2009, members:5, memberIsos:['TR','AZ','KZ','KG','UZ'], hq:'Istanbul (TR)', type:'political', desc:'Türkische Staaten. Ungarn Beobachter.', role:'Erdoğan-Eurasische Strategie, AZ-Karabach-Sieg.', web:'-' },

// ════ ENERGIE/KLIMA ════
'IRENA':  { name:'IRENA', full:'International Renewable Energy Agency', founded:2009, members:168, hq:'Abu Dhabi (AE)', type:'specialized', desc:'Erneuerbare Energien.', role:'COP-Verhandlungen, Tripling-Goal 2030.', web:'https://www.irena.org' },
'IEA':    { name:'IEA', full:'International Energy Agency', founded:1974, members:31, hq:'Paris', type:'specialized', desc:'OECD-nahe Energie-Agentur.', role:'Energiewende-Berichte, Notreserven-Koordination.', web:'https://www.iea.org' },
'UNFCCC':{ name:'UNFCCC', full:'UN Framework Convention on Climate Change', founded:1992, members:198, hq:'Bonn (DE)', type:'specialized', desc:'Klima-Rahmenkonvention. COP-Konferenzen jährlich.', role:'COP30 Belém 2025, Bilanz Pariser Abkommen.', web:'https://unfccc.int' },

// ════ INDISCH-OZ./ANDERE ════
'PIF':    { name:'Pacific Islands Forum', full:'Pacific Islands Forum', founded:1971, members:18, hq:'Suva (FJ)', type:'political', desc:'Pazifik-Inselstaaten.', role:'Klima-Krise, CN-AUS-USA-Wettbewerb um Inseln.', web:'https://www.forumsec.org' },
'IORA':   { name:'IORA', full:'Indian Ocean Rim Association', founded:1997, members:23, hq:'Mauritius', type:'economic', desc:'Indischer-Ozean-Anrainer.', role:'Seehandel, Piraterie, China-Strategie.', web:'-' },

}; // end window.ORGS

// ISO → in welchen Orgs ist dieses Land Mitglied
window.getOrgsForCountry = function(iso) {
  const result = [];
  Object.entries(window.ORGS).forEach(([key, o]) => {
    if (o.memberIsos?.includes(iso)) result.push({key, ...o});
  });
  // Statische REF.actors-Allianzen ergänzen
  try {
    (window.REF?.actors || []).forEach(a => {
      if (a.members?.includes(iso) && !result.find(r => r.name === a.n)) {
        result.push({ key: a.n, name: a.n, type: a.type, desc: a.d });
      }
    });
  } catch {}
  return result;
};
