// 합친 상위 구역의 한국어 이름표.
// NE 는 상위 구역(region)에 이름을 **한 벌만** 주기 때문에, 합치고 나면 한국어가 사라진다
// (이탈리아가 'Lombardia' 로 뜨던 문제). 한국어만 여기서 채우고 나머지 언어는 원문을 쓴다.
export const AGG_KO = {
  IT: {
    Abruzzo: '아브루초', Apulia: '풀리아', Basilicata: '바실리카타', Calabria: '칼라브리아',
    Campania: '캄파니아', 'Emilia-Romagna': '에밀리아로마냐', 'Friuli-Venezia Giulia': '프리울리베네치아줄리아',
    Lazio: '라치오', Liguria: '리구리아', Lombardia: '롬바르디아', Marche: '마르케', Molise: '몰리세',
    Piemonte: '피에몬테', Sardegna: '사르데냐', Sicily: '시칠리아', Toscana: '토스카나',
    'Trentino-Alto Adige': '트렌티노알토아디제', Umbria: '움브리아', "Valle d'Aosta": '발레다오스타', Veneto: '베네토',
  },
  FR: {
    'Auvergne-Rhône-Alpes': '오베르뉴론알프', 'Bourgogne-Franche-Comté': '부르고뉴프랑슈콩테',
    Bretagne: '브르타뉴', 'Centre-Val de Loire': '상트르발드루아르', Corse: '코르시카',
    'Grand Est': '그랑테스트', Guadeloupe: '과들루프', 'Guyane française': '프랑스령 기아나',
    'Hauts-de-France': '오드프랑스', Martinique: '마르티니크', Mayotte: '마요트', Normandie: '노르망디',
    'Nouvelle-Aquitaine': '누벨아키텐', Occitanie: '옥시타니', 'Pays de la Loire': '페이드라루아르',
    "Provence-Alpes-Côte-d'Azur": '프로방스알프코트다쥐르', 'Réunion': '레위니옹', 'Île-de-France': '일드프랑스',
  },
  ES: {
    'Andalucía': '안달루시아', 'Aragón': '아라곤', Asturias: '아스투리아스', 'Canary Is.': '카나리아 제도',
    Cantabria: '칸타브리아', 'Castilla y León': '카스티야레온', 'Castilla-La Mancha': '카스티야라만차',
    'Cataluña': '카탈루냐', Ceuta: '세우타', Extremadura: '엑스트레마두라', 'Foral de Navarra': '나바라',
    Galicia: '갈리시아', 'Islas Baleares': '발레아레스 제도', 'La Rioja': '라리오하', Madrid: '마드리드',
    Melilla: '멜리야', Murcia: '무르시아', 'País Vasco': '바스크', Valenciana: '발렌시아',
  },
  GB: {
    // ⚠️ 잉글랜드 권역과 스코틀랜드 권역이 영문으로 겹친다(East/Eastern, North East/North Eastern,
    //    South West/South Western). 한국어에서 구분되게 나라 이름을 넣는다.
    East: '동잉글랜드', 'East Midlands': '이스트미들랜즈', 'East Wales': '동웨일스',
    Eastern: '동스코틀랜드', 'Greater London': '런던', 'Highlands and Islands': '하일랜드 제도',
    'North East': '노스이스트', 'North Eastern': '북동스코틀랜드', 'North West': '노스웨스트',
    'Northern Ireland': '북아일랜드', 'South East': '사우스이스트', 'South West': '사우스웨스트',
    'South Western': '남서스코틀랜드', 'West Midlands': '웨스트미들랜즈',
    'West Wales and the Valleys': '서웨일스', 'Yorkshire and the Humber': '요크셔험버',
  },
  PH: {
    'Autonomous Region in Muslim Mindanao (ARMM)': '무슬림 민다나오 자치구', 'Bicol (Region V)': '비콜',
    'CALABARZON (Region IV-A)': '칼라바르손', 'Cagayan Valley (Region II)': '카가얀밸리',
    'Central Luzon (Region III)': '중부 루손', 'Central Visayas (Region VII)': '중부 비사야',
    'Cordillera Administrative Region (CAR)': '코르디예라', 'Davao (Region XI)': '다바오',
    'Dinagat Islands (Region XIII)': '카라가', 'Eastern Visayas (Region VIII)': '동부 비사야',
    'Ilocos (Region I)': '일로코스', 'MIMAROPA (Region IV-B)': '미마로파', 'National Capital Region': '메트로 마닐라',
    'Northern Mindanao (Region X)': '북부 민다나오', 'SOCCSKSARGEN (Region XII)': '속스크사르헨',
    'Western Visayas (Region VI)': '서부 비사야', 'Zamboanga Peninsula (Region IX)': '삼보앙가 반도',
  },
  SI: {
    Gorenjska: '고렌스카', 'Goriška': '고리슈카', 'Jugovzhodna Slovenija': '남동슬로베니아',
    'Koroška': '코로슈카', 'Notranjsko-kraška': '노트라니스카', 'Obalno-kraška': '연안카르스트',
    Osrednjeslovenska: '중앙슬로베니아', Podravska: '포드라브스카', Pomurska: '포무르스카',
    Savinjska: '사빈스카', Spodnjeposavska: '하포사브스카', Zasavska: '자사브스카',
  },
  LV: { Kurzeme: '쿠르제메', Latgale: '라트갈레', Riga: '리가', Vidzeme: '비드제메', Zemgale: '젬갈레' },
  MT: { Gozo: '고조', 'Malta Majjistral': '몰타 북서부', 'Malta Xlokk': '몰타 남동부' },
  GN: {
    Boke: '보케', Conakry: '코나크리', Faranah: '파라나', Kankan: '칸칸',
    Kindia: '킨디아', 'Labé': '라베', Mamou: '마무', 'Nzérékoré': '은제레코레',
  },
  XK: {
    Gnjilane: '그닐라네', 'Kosovska Mitrovica': '코소브스카미트로비차', 'Peć': '페치',
    Pristina: '프리슈티나', Prizren: '프리즈렌', 'Uroševac': '우로셰바츠', 'Đakovica': '자코비차',
  },
  LK: {
    'Basnāhira paḷāta': '서부주', 'Dakuṇu paḷāta': '남부주', 'Madhyama paḷāta': '중부주',
    'Næ̆gĕnahira paḷāta': '동부주', 'Sabaragamuva paḷāta': '사바라가무와주', 'Uturu paḷāta': '북부주',
    'Uturumæ̆da paḷāta': '북중부주', 'Vayamba paḷāta': '북서부주', 'Ūva paḷāta': '우바주',
  },
  BF: {
    'Boucle du Mouhoun': '부클레뒤무운', Cascades: '카스카드', Centre: '상트르', 'Centre-Est': '상트르에스트',
    'Centre-Nord': '상트르노르', 'Centre-Ouest': '상트르우에스트', 'Centre-Sud': '상트르쉬드', Est: '에스트',
    'Hauts-Bassins': '오바생', Nord: '노르', 'Plateau-Central': '플라토상트랄', Sahel: '사헬', 'Sud-Ouest': '쉬드우에스트',
  },
}

/**
 * 같은 이름이 겹칠 때 붙일 구분 접미사.
 * 수도 '시'와 같은 이름의 '주'가 나란히 있는 경우가 대부분이다(모스크바시/모스크바주, 키예프,
 * 민스크, 알마티, 자그레브…). 서울시와 경기도 같은 관계라 데이터는 맞고 표기만 겹친다.
 */
export const TYPE_SUFFIX = {
  city: { ko: '시', en: ' City', ja: '市', zh: '市', hi: ' शहर', vi: ' (TP)' },
  area: { ko: '주', en: ' Region', ja: '州', zh: '州', hi: ' क्षेत्र', vi: ' (Tỉnh)' },
}
/** 도시형 타입 판별 — 나머지는 전부 광역(area)으로 본다. */
export const isCityType = (t) => /city|municipal|capital|captial|urban/i.test(t || '')

/**
 * 도시의 ADM1NAME 이 우리 지역명과 다르게 적힌 것들 — 정규화·부분일치로도 안 붙는 경우만.
 * 수도를 못 찾으면 인구순만 남는데, 수도는 대개 인구도 1위라 큰 문제는 아니다(보정용).
 */
export const CITY_ADM1_ALIAS = {
  'PH|Metropolitan Manila': 'National Capital Region',
  'FI|Southern Finland': 'Uusimaa',
  'NP|Bhaktapur': 'Central',
}

/**
 * 이름·타입이 둘 다 겹쳐 자동 구분이 안 되는 것들 — `ISO|영문명|타입` 으로 직접 지정한다.
 * 접미사 규칙(도시/광역)으로는 못 가른다: 알타이는 공화국과 변경주라 둘 다 광역이고,
 * 음바라라는 군과 구라 역시 둘 다 광역이다.
 */
export const KO_FIX_TYPED = {
  'RU|Altai Republic|Republic': '알타이 공화국',
  'RU|Altai Republic|Territory': '알타이 변경주',
  'UG|Mbarara|County': '음바라라 군',
  'UG|Mbarara|District': '음바라라 구',
}

/** NE 의 한국어 이름이 아예 틀린 것들 — 손으로 잡는다. */
export const KO_FIX = {
  // 중국: 陝西(Shaanxi)와 山西(Shanxi)가 한국어로 둘 다 '산시성'이 된다. 관용 표기로 가른다.
  'CN|Shaanxi': '섬서성',
  'CN|Shanxi': '산시성',
  // UAE: NE 가 두 토후국에 엉뚱하게 '뉴트럴 존'을 넣어 뒀다.
  'AE|Fujairah': '푸자이라',
  'AE|Sayh Mudayrah': '사이흐 무다이라',
}
