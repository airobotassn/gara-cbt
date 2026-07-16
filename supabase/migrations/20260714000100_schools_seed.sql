-- ============================================================
-- schools 개발용 대표 시드 (Phase 1 · T5)
--   · 한국 주요 대학교(4년제) + 일부 전문대 ~50곳.
--   · id = slug(자체), name = 한글 정식명, kind = university|college,
--     region_code = 학교 소재 시도(ISO 3166-2:KR).
--   · ⚠️ 전체 목록(공공데이터포털 '대학 목록' 전량 import)은 별도 데이터-로드
--     운영 단계(ops)에서 처리한다. 이 파일은 개발/데모용 대표 시드이며
--     멱등(on conflict do nothing)이라 재실행 안전.
-- ============================================================

insert into schools (id, name, kind, region_code) values
  -- 서울 (KR-11)
  ('snu',        '서울대학교',               'university', 'KR-11'),
  ('yonsei',     '연세대학교',               'university', 'KR-11'),
  ('korea',      '고려대학교',               'university', 'KR-11'),
  ('skku',       '성균관대학교',             'university', 'KR-11'),
  ('hanyang',    '한양대학교',               'university', 'KR-11'),
  ('sogang',     '서강대학교',               'university', 'KR-11'),
  ('cau',        '중앙대학교',               'university', 'KR-11'),
  ('khu',        '경희대학교',               'university', 'KR-11'),
  ('hufs',       '한국외국어대학교',         'university', 'KR-11'),
  ('uos',        '서울시립대학교',           'university', 'KR-11'),
  ('ewha',       '이화여자대학교',           'university', 'KR-11'),
  ('sookmyung',  '숙명여자대학교',           'university', 'KR-11'),
  ('konkuk',     '건국대학교',               'university', 'KR-11'),
  ('dongguk',    '동국대학교',               'university', 'KR-11'),
  ('hongik',     '홍익대학교',               'university', 'KR-11'),
  ('sejong-univ','세종대학교',               'university', 'KR-11'),
  ('kookmin',    '국민대학교',               'university', 'KR-11'),
  ('soongsil',   '숭실대학교',               'university', 'KR-11'),
  ('seoultech',  '서울과학기술대학교',       'university', 'KR-11'),
  -- 부산 (KR-26)
  ('pnu',        '부산대학교',               'university', 'KR-26'),
  ('pknu',       '부경대학교',               'university', 'KR-26'),
  ('kmou',       '한국해양대학교',           'university', 'KR-26'),
  ('dsu',        '동아대학교',               'university', 'KR-26'),
  -- 대구 (KR-27)
  ('knu',        '경북대학교',               'university', 'KR-27'),
  ('keimyung',   '계명대학교',               'university', 'KR-27'),
  ('dgist',      '대구경북과학기술원',       'university', 'KR-27'),
  -- 인천 (KR-28)
  ('inha',       '인하대학교',               'university', 'KR-28'),
  ('inu',        '인천대학교',               'university', 'KR-28'),
  -- 광주 (KR-29)
  ('jnu',        '전남대학교',               'university', 'KR-29'),
  ('chosun',     '조선대학교',               'university', 'KR-29'),
  ('gist',       '광주과학기술원',           'university', 'KR-29'),
  -- 대전 (KR-30)
  ('kaist',      '한국과학기술원(KAIST)',    'university', 'KR-30'),
  ('cnu',        '충남대학교',               'university', 'KR-30'),
  ('hannam',     '한남대학교',               'university', 'KR-30'),
  -- 울산 (KR-31)
  ('unist',      '울산과학기술원(UNIST)',    'university', 'KR-31'),
  ('ulsan',      '울산대학교',               'university', 'KR-31'),
  -- 경기 (KR-41)
  ('ajou',       '아주대학교',               'university', 'KR-41'),
  ('gachon',     '가천대학교',               'university', 'KR-41'),
  ('dankook',    '단국대학교',               'university', 'KR-41'),
  ('khu-global', '경희대학교(국제캠퍼스)',   'university', 'KR-41'),
  -- 강원 (KR-42)
  ('kangwon',    '강원대학교',               'university', 'KR-42'),
  ('hallym',     '한림대학교',               'university', 'KR-42'),
  -- 충북 (KR-43)
  ('cbnu',       '충북대학교',               'university', 'KR-43'),
  -- 충남 (KR-44)
  ('soonchunhyang','순천향대학교',           'university', 'KR-44'),
  ('hoseo',      '호서대학교',               'university', 'KR-44'),
  -- 전북 (KR-45)
  ('jbnu',       '전북대학교',               'university', 'KR-45'),
  ('wku',        '원광대학교',               'university', 'KR-45'),
  -- 전남 (KR-46)
  ('scnu',       '순천대학교',               'university', 'KR-46'),
  -- 경북 (KR-47)
  ('postech',    '포항공과대학교(POSTECH)',  'university', 'KR-47'),
  ('ynu',        '영남대학교',               'university', 'KR-47'),
  -- 경남 (KR-48)
  ('gnu',        '경상국립대학교',           'university', 'KR-48'),
  -- 제주 (KR-49)
  ('jejunu',     '제주대학교',               'university', 'KR-49'),
  -- 세종 (KR-50)
  ('kdi',        'KDI국제정책대학원대학교',  'university', 'KR-50'),
  -- 전문대 (college)
  ('dongyang',   '동양미래대학교',           'college',    'KR-11'),
  ('inhatc',     '인하공업전문대학',         'college',    'KR-28'),
  ('yjc',        '영진전문대학교',           'college',    'KR-27'),
  ('kaywon',     '계원예술대학교',           'college',    'KR-41'),
  ('daelim',     '대림대학교',               'college',    'KR-41')
on conflict (id) do nothing;
