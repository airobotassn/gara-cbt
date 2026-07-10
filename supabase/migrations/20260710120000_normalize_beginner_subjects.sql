-- 비기너 문제은행 과목명 정규화 — 업로드된 과목명이 /guide 정규 검정과목과 어긋나면
-- 풀 현황 집계·실제 출제(examDraw)가 과목명 완전일치로만 잡기 때문에 그 과목이 통째로 누락된다.
--
-- 실제 사례(2026-07-10): 로봇 과목이 "일상 속 로봇 기술과 피지컬 AI 이해"(‘의’ 누락)로 업로드돼
--   정규 "일상 속 로봇 기술과 피지컬 AI의 이해"와 불일치 → 풀 현황·출제에서 39문항 전부 누락.
--   대소문자·공백 정규화로는 안 잡히는 글자(‘의’) 차이라 내용 기준으로 교정한다.
--   '피지컬'은 비기너 3과목 중 이 과목에만 있으므로 안전하게 타깃된다.
--
-- 전제: 비기너 은행 = question_banks.tier='beginner' 단일. 정규 과목은 프론트 getTracks(=/guide)
--   caris.t1.beginner.subj.0~2 와 글자까지 동일(변경 시 이 값도 같이 갱신).
do $$
declare
  v_bank uuid;
  v_robot text := '일상 속 로봇 기술과 피지컬 AI의 이해';
  v_canon text[] := array[
    '생성형 AI의 일상 활용',
    '일상 속 로봇 기술과 피지컬 AI의 이해',
    '인공지능·로봇 윤리 및 디지털 안전 리터러시'
  ];
  n int; c text;
begin
  select id into v_bank from public.question_banks where tier = 'beginner' limit 1;
  if v_bank is null then raise notice '[normalize] beginner 은행 없음 — 건너뜀'; return; end if;

  -- ① 로봇 과목: '피지컬' 포함 & 정규명 아님 → 정규명으로 교정(‘의’ 누락·대소문자·공백 무관)
  update public.questions q set subject = v_robot
  where q.bank_id = v_bank and q.subject like '%피지컬%' and q.subject is distinct from v_robot;
  get diagnostics n = row_count;
  raise notice '[normalize] 로봇 과목 교정: % rows', n;

  -- ② 나머지 과목: 대소문자·공백만 다른 near-miss 도 정규명으로 흡수
  foreach c in array v_canon loop
    update public.questions q set subject = c
    where q.bank_id = v_bank and q.subject is distinct from c
      and lower(regexp_replace(q.subject, '\s', '', 'g')) = lower(regexp_replace(c, '\s', '', 'g'));
  end loop;

  -- ③ 남은 비정규 과목(수동 확인 필요) 진단
  for c, n in
    select q.subject, count(*)::int from public.questions q
    where q.bank_id = v_bank and q.subject <> all(v_canon) group by q.subject
  loop
    raise notice '[normalize] ⚠️ 정규 과목 아님(수동 확인): "%" (% rows)', c, n;
  end loop;
end $$;
