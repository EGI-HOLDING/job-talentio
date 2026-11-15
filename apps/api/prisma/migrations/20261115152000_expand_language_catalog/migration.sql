-- ISO 639-1 codes from the Library of Congress language registry:
-- https://www.loc.gov/standards/iso639-2/ISO-639-2_utf-8.txt
-- Display names from Unicode CLDR via Intl.DisplayNames, plus Southeast Asian entries.
BEGIN;

CREATE TEMP TABLE language_catalog_release (
  code TEXT PRIMARY KEY, name TEXT NOT NULL, "nameId" TEXT, "nameUz" TEXT, "nameRu" TEXT,
  "normalizedKey" TEXT NOT NULL, "legacyKeys" TEXT NOT NULL, "legacyCodes" TEXT NOT NULL
) ON COMMIT DROP;

INSERT INTO language_catalog_release VALUES
  ('aa', 'Afar', 'Afar', 'afar', 'афарский', 'afar', 'afar', 'aar'),
  ('ab', 'Abkhazian', 'Abkhaz', 'abxaz', 'абхазский', 'abkhazian', 'abkhazian', 'abk'),
  ('ace', 'Acehnese', 'Aceh', 'achin', 'ачехский', 'acehnese', 'acehnese', ''),
  ('ae', 'Avestan', 'Avesta', NULL, 'авестийский', 'avestan', 'avestan', 'ave'),
  ('af', 'Afrikaans', 'Afrikaans', 'afrikaans', 'африкаанс', 'afrikaans', 'afrikaans', 'afr'),
  ('ak', 'Akan', 'Akan', 'akan', 'акан', 'akan', 'akan', 'aka'),
  ('am', 'Amharic', 'Amharik', 'amxar', 'амхарский', 'amharic', 'amharic', 'amh'),
  ('an', 'Aragonese', 'Aragon', 'aragon', 'арагонский', 'aragonese', 'aragonese', 'arg'),
  ('ar', 'Arabic', 'Arab', 'arab', 'арабский', 'arabic', 'arabic', 'ara'),
  ('as', 'Assamese', 'Assam', 'assam', 'ассамский', 'assamese', 'assamese', 'asm'),
  ('av', 'Avaric', 'Avar', 'avar', 'аварский', 'avaric', 'avaric', 'ava'),
  ('ay', 'Aymara', 'Aymara', 'aymara', 'аймара', 'aymara', 'aymara', 'aym'),
  ('az', 'Azerbaijani', 'Azerbaijani', 'ozarbayjon', 'азербайджанский', 'azerbaijani', 'azerbaijani', 'aze'),
  ('ba', 'Bashkir', 'Bashkir', 'boshqird', 'башкирский', 'bashkir', 'bashkir', 'bak'),
  ('ban', 'Balinese', 'Bali', 'bali', 'балийский', 'balinese', 'balinese', ''),
  ('bbc', 'Toba Batak', 'Batak Toba', NULL, NULL, 'tobabatak', 'tobabatak', ''),
  ('be', 'Belarusian', 'Belarusia', 'belarus', 'белорусский', 'belarusian', 'belarusian', 'bel'),
  ('bew', 'Betawi', 'Betawi', NULL, NULL, 'betawi', 'betawi', ''),
  ('bg', 'Bulgarian', 'Bulgaria', 'bolgar', 'болгарский', 'bulgarian', 'bulgarian', 'bul'),
  ('bi', 'Bislama', 'Bislama', 'bislama', 'бислама', 'bislama', 'bislama', 'bis'),
  ('bjn', 'Banjar', 'Banjar', NULL, NULL, 'banjar', 'banjar', ''),
  ('bm', 'Bambara', 'Bambara', 'bambara', 'бамбара', 'bambara', 'bambara', 'bam'),
  ('bn', 'Bangla', 'Bengali', 'bengal', 'бенгальский', 'bangla', 'bangla,bengali', 'ben'),
  ('bo', 'Tibetan', 'Tibet', 'tibet', 'тибетский', 'tibetan', 'tibetan', 'tib,bod'),
  ('br', 'Breton', 'Breton', 'breton', 'бретонский', 'breton', 'breton', 'bre'),
  ('bs', 'Bosnian', 'Bosnia', 'bosniy', 'боснийский', 'bosnian', 'bosnian', 'bos'),
  ('bug', 'Buginese', 'Bugis', 'bugi', 'бугийский', 'buginese', 'buginese', ''),
  ('ca', 'Catalan', 'Katalan', 'katalan', 'каталанский', 'catalan', 'catalan', 'cat'),
  ('ce', 'Chechen', 'Chechen', 'chechen', 'чеченский', 'chechen', 'chechen', 'che'),
  ('ch', 'Chamorro', 'Chamorro', 'chamorro', 'чаморро', 'chamorro', 'chamorro', 'cha'),
  ('co', 'Corsican', 'Korsika', 'korsikan', 'корсиканский', 'corsican', 'corsican', 'cos'),
  ('cr', 'Cree', 'Kree', NULL, 'кри', 'cree', 'cree', 'cre'),
  ('cs', 'Czech', 'Ceko', 'chex', 'чешский', 'czech', 'czech', 'cze,ces'),
  ('cu', 'Church Slavic', 'Bahasa Gereja Slavonia', 'slavyan (cherkov)', 'церковнославянский', 'churchslavic', 'churchslavic', 'chu'),
  ('cv', 'Chuvash', 'Chuvash', 'chuvash', 'чувашский', 'chuvash', 'chuvash', 'chv'),
  ('cy', 'Welsh', 'Welsh', 'valliy', 'валлийский', 'welsh', 'welsh', 'wel,cym'),
  ('da', 'Danish', 'Dansk', 'dan', 'датский', 'danish', 'danish', 'dan'),
  ('de', 'German', 'Jerman', 'nemischa', 'немецкий', 'german', 'german', 'ger,deu'),
  ('dv', 'Divehi', 'Divehi', 'divexi', 'мальдивский', 'divehi', 'divehi', 'div'),
  ('dz', 'Dzongkha', 'Dzongkha', 'dzongka', 'дзонг-кэ', 'dzongkha', 'dzongkha', 'dzo'),
  ('ee', 'Ewe', 'Ewe', 'eve', 'эве', 'ewe', 'ewe', 'ewe'),
  ('el', 'Greek', 'Yunani', 'grek', 'греческий', 'greek', 'greek,moderngreek1453', 'gre,ell'),
  ('en', 'English', 'Inggris', 'inglizcha', 'английский', 'english', 'english', 'eng'),
  ('eo', 'Esperanto', 'Esperanto', 'esperanto', 'эсперанто', 'esperanto', 'esperanto', 'epo'),
  ('es', 'Spanish', 'Spanyol', 'ispancha', 'испанский', 'spanish', 'spanish', 'spa'),
  ('et', 'Estonian', 'Estonia', 'estoncha', 'эстонский', 'estonian', 'estonian', 'est'),
  ('eu', 'Basque', 'Basque', 'bask', 'баскский', 'basque', 'basque', 'baq,eus'),
  ('fa', 'Persian', 'Persia', 'fors', 'персидский', 'persian', 'persian', 'per,fas'),
  ('ff', 'Fula', 'Fula', 'fula', 'фулах', 'fula', 'fula,fulah', 'ful'),
  ('fi', 'Finnish', 'Suomi', 'fincha', 'финский', 'finnish', 'finnish', 'fin'),
  ('fil', 'Filipino', 'Filipino', 'filipincha', 'филиппинский', 'filipino', 'filipino', ''),
  ('fj', 'Fijian', 'Fiji', 'fiji', 'фиджи', 'fijian', 'fijian', 'fij'),
  ('fo', 'Faroese', 'Faroe', 'farercha', 'фарерский', 'faroese', 'faroese', 'fao'),
  ('fr', 'French', 'Prancis', 'fransuzcha', 'французский', 'french', 'french', 'fre,fra'),
  ('fy', 'Western Frisian', 'Frisia Barat', 'g‘arbiy friz', 'западнофризский', 'westernfrisian', 'westernfrisian', 'fry'),
  ('ga', 'Irish', 'Irlandia', 'irland', 'ирландский', 'irish', 'irish', 'gle'),
  ('gd', 'Scottish Gaelic', 'Gaelik Skotlandia', 'shotland-gel', 'гэльский', 'scottishgaelic', 'scottishgaelic,gaelic', 'gla'),
  ('gl', 'Galician', 'Galisia', 'galisiy', 'галисийский', 'galician', 'galician', 'glg'),
  ('gn', 'Guarani', 'Guarani', 'guarani', 'гуарани', 'guarani', 'guarani', 'grn'),
  ('gor', 'Gorontalo', 'Gorontalo', 'gorontalo', 'горонтало', 'gorontalo', 'gorontalo', ''),
  ('gu', 'Gujarati', 'Gujarat', 'gujarot', 'гуджарати', 'gujarati', 'gujarati', 'guj'),
  ('gv', 'Manx', 'Manx', 'men', 'мэнский', 'manx', 'manx', 'glv'),
  ('ha', 'Hausa', 'Hausa', 'xausa', 'хауса', 'hausa', 'hausa', 'hau'),
  ('he', 'Hebrew', 'Ibrani', 'ivrit', 'иврит', 'hebrew', 'hebrew', 'heb,iw'),
  ('hi', 'Hindi', 'Hindi', 'hind', 'хинди', 'hindi', 'hindi', 'hin'),
  ('ho', 'Hiri Motu', 'Hiri Motu', NULL, 'хиримоту', 'hirimotu', 'hirimotu', 'hmo'),
  ('hr', 'Croatian', 'Kroasia', 'xorvat', 'хорватский', 'croatian', 'croatian', 'hrv'),
  ('ht', 'Haitian Creole', 'Kreol Haiti', 'gaityan', 'гаитянский', 'haitiancreole', 'haitiancreole,haitian', 'hat'),
  ('hu', 'Hungarian', 'Hungaria', 'venger', 'венгерский', 'hungarian', 'hungarian', 'hun'),
  ('hy', 'Armenian', 'Armenia', 'arman', 'армянский', 'armenian', 'armenian', 'arm,hye'),
  ('hz', 'Herero', 'Herero', 'gerero', 'гереро', 'herero', 'herero', 'her'),
  ('ia', 'Interlingua', 'Interlingua', 'interlingva', 'интерлингва', 'interlingua', 'interlingua,interlinguainternationalauxiliarylanguageassociation', 'ina'),
  ('id', 'Indonesian', 'Bahasa Indonesia', 'indonez', 'индонезийский', 'indonesian', 'indonesian', 'ind,in'),
  ('ie', 'Interlingue', 'Interlingue', 'interlingve', 'интерлингве', 'interlingue', 'interlingue', 'ile'),
  ('ig', 'Igbo', 'Igbo', 'igbo', 'игбо', 'igbo', 'igbo', 'ibo'),
  ('ii', 'Sichuan Yi', 'Sichuan Yi', 'sichuan', 'носу', 'sichuanyi', 'sichuanyi', 'iii'),
  ('ik', 'Inupiaq', 'Inupiak', NULL, 'инупиак', 'inupiaq', 'inupiaq', 'ipk'),
  ('inl', 'Indonesian Sign Language', 'Bahasa Isyarat Indonesia', NULL, NULL, 'indonesiansignlanguage', 'indonesiansignlanguage', ''),
  ('io', 'Ido', 'Ido', 'ido', 'идо', 'ido', 'ido', 'ido'),
  ('is', 'Icelandic', 'Islandia', 'island', 'исландский', 'icelandic', 'icelandic', 'ice,isl'),
  ('it', 'Italian', 'Italia', 'italyan', 'итальянский', 'italian', 'italian', 'ita'),
  ('iu', 'Inuktitut', 'Inuktitut', 'inuktitut', 'инуктитут', 'inuktitut', 'inuktitut', 'iku'),
  ('ja', 'Japanese', 'Jepang', 'yapon', 'японский', 'japanese', 'japanese', 'jpn'),
  ('jv', 'Javanese', 'Jawa', 'yavan', 'яванский', 'javanese', 'javanese', 'jav,jw'),
  ('ka', 'Georgian', 'Georgia', 'gruzincha', 'грузинский', 'georgian', 'georgian', 'geo,kat'),
  ('kg', 'Kongo', 'Kongo', NULL, 'конго', 'kongo', 'kongo', 'kon'),
  ('ki', 'Kikuyu', 'Kikuyu', 'kikuyu', 'кикуйю', 'kikuyu', 'kikuyu', 'kik'),
  ('kj', 'Kuanyama', 'Kuanyama', 'kvanyama', 'кунама', 'kuanyama', 'kuanyama', 'kua'),
  ('kk', 'Kazakh', 'Kazakh', 'qozoqcha', 'казахский', 'kazakh', 'kazakh', 'kaz'),
  ('kl', 'Kalaallisut', 'Kalaallisut', 'grenland', 'гренландский', 'kalaallisut', 'kalaallisut', 'kal'),
  ('km', 'Khmer', 'Khmer', 'xmer', 'кхмерский', 'khmer', 'khmer,centralkhmer', 'khm'),
  ('kn', 'Kannada', 'Kannada', 'kannada', 'каннада', 'kannada', 'kannada', 'kan'),
  ('ko', 'Korean', 'Korea', 'koreyscha', 'корейский', 'korean', 'korean', 'kor'),
  ('kr', 'Kanuri', 'Kanuri', 'kanuri', 'канури', 'kanuri', 'kanuri', 'kau'),
  ('ks', 'Kashmiri', 'Kashmir', 'kashmircha', 'кашмири', 'kashmiri', 'kashmiri', 'kas'),
  ('ku', 'Kurdish', 'Kurdi', 'kurdcha', 'курдский', 'kurdish', 'kurdish', 'kur'),
  ('kv', 'Komi', 'Komi', 'komi', 'коми', 'komi', 'komi', 'kom'),
  ('kw', 'Cornish', 'Kornish', 'korn', 'корнский', 'cornish', 'cornish', 'cor'),
  ('ky', 'Kyrgyz', 'Kirgiz', 'qirgʻizcha', 'киргизский', 'kyrgyz', 'kyrgyz,kirghiz', 'kir'),
  ('la', 'Latin', 'Latin', 'lotincha', 'латинский', 'latin', 'latin', 'lat'),
  ('lb', 'Luxembourgish', 'Luksemburg', 'lyuksemburgcha', 'люксембургский', 'luxembourgish', 'luxembourgish', 'ltz'),
  ('lg', 'Ganda', 'Ganda', 'ganda', 'ганда', 'ganda', 'ganda', 'lug'),
  ('li', 'Limburgish', 'Limburgia', 'limburg', 'лимбургский', 'limburgish', 'limburgish,limburgan', 'lim'),
  ('ln', 'Lingala', 'Lingala', 'lingala', 'лингала', 'lingala', 'lingala', 'lin'),
  ('lo', 'Lao', 'Lao', 'laos', 'лаосский', 'lao', 'lao', 'lao'),
  ('lt', 'Lithuanian', 'Lituania', 'litva', 'литовский', 'lithuanian', 'lithuanian', 'lit'),
  ('lu', 'Luba-Katanga', 'Luba-Katanga', 'luba-katanga', 'луба-катанга', 'lubakatanga', 'lubakatanga', 'lub'),
  ('lv', 'Latvian', 'Latvia', 'latishcha', 'латышский', 'latvian', 'latvian', 'lav'),
  ('mad', 'Madurese', 'Madura', 'madur', 'мадурский', 'madurese', 'madurese', ''),
  ('mak', 'Makasar', 'Makasar', 'makasar', 'макассарский', 'makasar', 'makasar', ''),
  ('mg', 'Malagasy', 'Malagasi', 'malagasiy', 'малагасийский', 'malagasy', 'malagasy', 'mlg'),
  ('mh', 'Marshallese', 'Marshall', 'marshall', 'маршалльский', 'marshallese', 'marshallese', 'mah'),
  ('mi', 'Māori', 'Maori', 'maori', 'маори', 'maori', 'maori', 'mao,mri'),
  ('min', 'Minangkabau', 'Minangkabau', 'minangkabau', 'минангкабау', 'minangkabau', 'minangkabau', ''),
  ('mk', 'Macedonian', 'Makedonia', 'makedon', 'македонский', 'macedonian', 'macedonian', 'mac,mkd'),
  ('ml', 'Malayalam', 'Malayalam', 'malayalam', 'малаялам', 'malayalam', 'malayalam', 'mal'),
  ('mn', 'Mongolian', 'Mongolia', 'mongol', 'монгольский', 'mongolian', 'mongolian', 'mon'),
  ('mr', 'Marathi', 'Marathi', 'maratxi', 'маратхи', 'marathi', 'marathi', 'mar'),
  ('ms', 'Malay', 'Melayu', 'malay', 'малайский', 'malay', 'malay', 'may,msa'),
  ('mt', 'Maltese', 'Malta', 'maltiy', 'мальтийский', 'maltese', 'maltese', 'mlt'),
  ('my', 'Burmese', 'Burma', 'birman', 'бирманский', 'burmese', 'burmese', 'bur,mya'),
  ('na', 'Nauru', 'Nauru', 'nauru', 'науру', 'nauru', 'nauru', 'nau'),
  ('nb', 'Norwegian Bokmål', 'Bokmål Norwegia', 'norveg-bokmal', 'норвежский букмол', 'norwegianbokmal', 'norwegianbokmal', 'nob'),
  ('nd', 'North Ndebele', 'Ndebele Utara', 'shimoliy ndebele', 'северный ндебеле', 'northndebele', 'northndebele', 'nde'),
  ('ne', 'Nepali', 'Nepali', 'nepal', 'непальский', 'nepali', 'nepali', 'nep'),
  ('ng', 'Ndonga', 'Ndonga', 'ndonga', 'ндонга', 'ndonga', 'ndonga', 'ndo'),
  ('nia', 'Nias', 'Nias', 'nias', 'ниас', 'nias', 'nias', ''),
  ('nl', 'Dutch', 'Belanda', 'niderland', 'нидерландский', 'dutch', 'dutch', 'dut,nld'),
  ('nn', 'Norwegian Nynorsk', 'Nynorsk Norwegia', 'norveg-nyunorsk', 'нюнорск', 'norwegiannynorsk', 'norwegiannynorsk', 'nno'),
  ('no', 'Norwegian', 'Norwegia', 'norveg', 'норвежский', 'norwegian', 'norwegian', 'nor'),
  ('nr', 'South Ndebele', 'Ndebele Selatan', 'janubiy ndebel', 'южный ндебеле', 'southndebele', 'southndebele', 'nbl'),
  ('nv', 'Navajo', 'Navajo', 'navaxo', 'навахо', 'navajo', 'navajo', 'nav'),
  ('ny', 'Nyanja', 'Nyanja', 'cheva', 'ньянджа', 'nyanja', 'nyanja,chichewa', 'nya'),
  ('oc', 'Occitan', 'Ositania', 'oksitan', 'окситанский', 'occitan', 'occitan,occitanpost1500', 'oci'),
  ('oj', 'Ojibwa', 'Ojibwa', NULL, 'оджибва', 'ojibwa', 'ojibwa', 'oji'),
  ('om', 'Oromo', 'Oromo', 'oromo', 'оромо', 'oromo', 'oromo', 'orm'),
  ('or', 'Odia', 'Oriya', 'oriya', 'ория', 'odia', 'odia,oriya', 'ori'),
  ('os', 'Ossetic', 'Ossetia', 'osetin', 'осетинский', 'ossetic', 'ossetic,ossetian', 'oss'),
  ('pa', 'Punjabi', 'Punjabi', 'panjobcha', 'панджаби', 'punjabi', 'punjabi,panjabi', 'pan'),
  ('pi', 'Pali', 'Pali', NULL, 'пали', 'pali', 'pali', 'pli'),
  ('pl', 'Polish', 'Polski', 'polyakcha', 'польский', 'polish', 'polish', 'pol'),
  ('ps', 'Pashto', 'Pashto', 'pushtu', 'пушту', 'pashto', 'pashto,pushto', 'pus'),
  ('pt', 'Portuguese', 'Portugis', 'portugalcha', 'португальский', 'portuguese', 'portuguese', 'por'),
  ('qu', 'Quechua', 'Quechua', 'kechua', 'кечуа', 'quechua', 'quechua', 'que'),
  ('rm', 'Romansh', 'Reto-Roman', 'romansh', 'романшский', 'romansh', 'romansh', 'roh'),
  ('rn', 'Rundi', 'Rundi', 'rundi', 'рунди', 'rundi', 'rundi', 'run'),
  ('ro', 'Romanian', 'Rumania', 'rumincha', 'румынский', 'romanian', 'romanian', 'rum,ron'),
  ('ru', 'Russian', 'Rusia', 'ruscha', 'русский', 'russian', 'russian', 'rus'),
  ('rw', 'Kinyarwanda', 'Kinyarwanda', 'kinyaruanda', 'киньяруанда', 'kinyarwanda', 'kinyarwanda', 'kin'),
  ('sa', 'Sanskrit', 'Sanskerta', 'sanskrit', 'санскрит', 'sanskrit', 'sanskrit', 'san'),
  ('sas', 'Sasak', 'Sasak', NULL, 'сасакский', 'sasak', 'sasak', ''),
  ('sc', 'Sardinian', 'Sardinia', 'sardin', 'сардинский', 'sardinian', 'sardinian', 'srd'),
  ('sd', 'Sindhi', 'Sindhi', 'sindhi', 'синдхи', 'sindhi', 'sindhi', 'snd'),
  ('se', 'Northern Sami', 'Sami Utara', 'shimoliy saam', 'северносаамский', 'northernsami', 'northernsami', 'sme'),
  ('sg', 'Sango', 'Sango', 'sango', 'санго', 'sango', 'sango', 'sag'),
  ('si', 'Sinhala', 'Sinhala', 'singal', 'сингальский', 'sinhala', 'sinhala', 'sin'),
  ('sk', 'Slovak', 'Slovak', 'slovakcha', 'словацкий', 'slovak', 'slovak', 'slo,slk'),
  ('sl', 'Slovenian', 'Slovenia', 'slovencha', 'словенский', 'slovenian', 'slovenian', 'slv'),
  ('sm', 'Samoan', 'Samoa', 'samoa', 'самоанский', 'samoan', 'samoan', 'smo'),
  ('sn', 'Shona', 'Shona', 'shona', 'шона', 'shona', 'shona', 'sna'),
  ('so', 'Somali', 'Somalia', 'somalicha', 'сомали', 'somali', 'somali', 'som'),
  ('sq', 'Albanian', 'Albania', 'alban', 'албанский', 'albanian', 'albanian', 'alb,sqi'),
  ('sr', 'Serbian', 'Serbia', 'serbcha', 'сербский', 'serbian', 'serbian', 'srp'),
  ('ss', 'Swati', 'Swati', 'svati', 'свази', 'swati', 'swati', 'ssw'),
  ('st', 'Southern Sotho', 'Sotho Selatan', 'janubiy soto', 'южный сото', 'southernsotho', 'southernsotho,sothosouthern', 'sot'),
  ('su', 'Sundanese', 'Sunda', 'sundan', 'сунданский', 'sundanese', 'sundanese', 'sun'),
  ('sv', 'Swedish', 'Swedia', 'shved', 'шведский', 'swedish', 'swedish', 'swe'),
  ('sw', 'Swahili', 'Swahili', 'suaxili', 'суахили', 'swahili', 'swahili', 'swa'),
  ('ta', 'Tamil', 'Tamil', 'tamil', 'тамильский', 'tamil', 'tamil', 'tam'),
  ('te', 'Telugu', 'Telugu', 'telugu', 'телугу', 'telugu', 'telugu', 'tel'),
  ('tet', 'Tetum', 'Tetun', 'tetum', 'тетум', 'tetum', 'tetum', ''),
  ('tg', 'Tajik', 'Tajik', 'tojik', 'таджикский', 'tajik', 'tajik', 'tgk'),
  ('th', 'Thai', 'Thai', 'tay', 'тайский', 'thai', 'thai', 'tha'),
  ('ti', 'Tigrinya', 'Tigrinya', 'tigrinya', 'тигринья', 'tigrinya', 'tigrinya', 'tir'),
  ('tk', 'Turkmen', 'Turkmen', 'turkman', 'туркменский', 'turkmen', 'turkmen', 'tuk'),
  ('tl', 'Tagalog', 'Tagalog', 'Tagalog', 'Тагальский', 'tagalog', 'tagalog', 'tgl'),
  ('tn', 'Tswana', 'Tswana', 'tsvana', 'тсвана', 'tswana', 'tswana', 'tsn'),
  ('to', 'Tongan', 'Tonga', 'tongan', 'тонганский', 'tongan', 'tongan,tongatongaislands', 'ton'),
  ('tr', 'Turkish', 'Turki', 'turk', 'турецкий', 'turkish', 'turkish', 'tur'),
  ('ts', 'Tsonga', 'Tsonga', 'tsonga', 'тсонга', 'tsonga', 'tsonga', 'tso'),
  ('tt', 'Tatar', 'Tatar', 'tatar', 'татарский', 'tatar', 'tatar', 'tat'),
  ('tw', 'Twi', 'Twi', 'Tvi', 'Тви', 'twi', 'twi', 'twi'),
  ('ty', 'Tahitian', 'Tahiti', 'taiti', 'таитянский', 'tahitian', 'tahitian', 'tah'),
  ('ug', 'Uyghur', 'Uyghur', 'uyg‘ur', 'уйгурский', 'uyghur', 'uyghur,uighur', 'uig'),
  ('uk', 'Ukrainian', 'Ukraina', 'ukrain', 'украинский', 'ukrainian', 'ukrainian', 'ukr'),
  ('ur', 'Urdu', 'Urdu', 'urdu', 'урду', 'urdu', 'urdu', 'urd'),
  ('uz', 'Uzbek', 'Uzbek', 'o‘zbek', 'узбекский', 'uzbek', 'uzbek', 'uzb'),
  ('ve', 'Venda', 'Venda', 'venda', 'венда', 'venda', 'venda', 'ven'),
  ('vi', 'Vietnamese', 'Vietnam', 'vyetnam', 'вьетнамский', 'vietnamese', 'vietnamese', 'vie'),
  ('vo', 'Volapük', 'Volapuk', 'volapyuk', 'волапюк', 'volapuk', 'volapuk', 'vol'),
  ('wa', 'Walloon', 'Walloon', 'vallon', 'валлонский', 'walloon', 'walloon', 'wln'),
  ('wo', 'Wolof', 'Wolof', 'volof', 'волоф', 'wolof', 'wolof', 'wol'),
  ('xh', 'Xhosa', 'Xhosa', 'kxosa', 'коса', 'xhosa', 'xhosa', 'xho'),
  ('yi', 'Yiddish', 'Yiddish', 'idish', 'идиш', 'yiddish', 'yiddish', 'yid,ji'),
  ('yo', 'Yoruba', 'Yoruba', 'yoruba', 'йоруба', 'yoruba', 'yoruba', 'yor'),
  ('yue', 'Cantonese', 'Kanton', 'kanton', 'кантонский', 'cantonese', 'cantonese', ''),
  ('za', 'Zhuang', 'Zhuang', 'Chjuan', 'чжуань', 'zhuang', 'zhuang', 'zha'),
  ('zh', 'Chinese', 'Tionghoa', 'xitoy', 'китайский', 'chinese', 'chinese', 'chi,zho'),
  ('zu', 'Zulu', 'Zulu', 'zulu', 'зулу', 'zulu', 'zulu', 'zul');

-- Keep existing IDs, codes, translations and archive state whenever a language
-- is already represented by a legacy row.
CREATE TEMP TABLE existing_language_catalog_match ON COMMIT DROP AS
SELECT source.code, matched.id
FROM language_catalog_release source
CROSS JOIN LATERAL (
  SELECT existing.id
  FROM "Language" existing
  WHERE existing.code = source.code
     OR existing.code = ANY(string_to_array(source."legacyCodes", ','))
     OR existing."normalizedKey" = ANY(string_to_array(source."legacyKeys", ','))
     OR lower(existing.name) = lower(source.name)
  ORDER BY (existing.code = source.code) DESC, (existing."archivedAt" IS NULL) DESC, existing.id
  LIMIT 1
) matched;

UPDATE "Language" existing
SET "nameId" = COALESCE(existing."nameId", source."nameId"),
    "nameUz" = COALESCE(existing."nameUz", source."nameUz"),
    "nameRu" = COALESCE(existing."nameRu", source."nameRu"),
    "i18nStatus" = CASE
      WHEN existing."i18nStatus" = 'PENDING'
       AND COALESCE(existing."nameId", source."nameId") IS NOT NULL
       AND COALESCE(existing."nameUz", source."nameUz") IS NOT NULL
       AND COALESCE(existing."nameRu", source."nameRu") IS NOT NULL
      THEN 'COMPLETE'::"CatalogI18nStatus" ELSE existing."i18nStatus" END
FROM language_catalog_release source
JOIN existing_language_catalog_match matched USING (code)
WHERE existing.id = matched.id;

INSERT INTO "Language" (id, code, name, "nameId", "nameUz", "nameRu", "normalizedKey", "i18nStatus")
SELECT 'catalog_iso_language_' || source.code, source.code, source.name, source."nameId",
       source."nameUz", source."nameRu", source."normalizedKey",
       CASE WHEN source."nameId" IS NOT NULL AND source."nameUz" IS NOT NULL AND source."nameRu" IS NOT NULL
         THEN 'COMPLETE'::"CatalogI18nStatus" ELSE 'PENDING'::"CatalogI18nStatus" END
FROM language_catalog_release source
LEFT JOIN existing_language_catalog_match matched USING (code)
WHERE matched.id IS NULL;

INSERT INTO "LanguageAlias" (id, "languageId", alias, "aliasKey")
SELECT 'catalog_iso_language_alias_' || labels."aliasKey", COALESCE(matched.id, catalog.id), labels.alias, labels."aliasKey"
FROM (VALUES
  ('id', 'Bahasa Indonesia', 'bahasaindonesia'),
  ('en', 'Bahasa Inggris', 'bahasainggris'),
  ('zh', 'Mandarin', 'mandarin'),
  ('ms', 'Bahasa Melayu', 'bahasamelayu'),
  ('ja', '日本語', '日本語'),
  ('ko', '한국어', '한국어'),
  ('uz', 'O‘zbek tili', 'ozbektili'),
  ('es', 'Español', 'espanol'),
  ('pt', 'Português', 'portugues'),
  ('de', 'Deutsch', 'deutsch')
) labels(code, alias, "aliasKey")
LEFT JOIN existing_language_catalog_match matched USING (code)
LEFT JOIN "Language" catalog ON catalog.code = labels.code
ON CONFLICT ("aliasKey") DO NOTHING;

COMMIT;
