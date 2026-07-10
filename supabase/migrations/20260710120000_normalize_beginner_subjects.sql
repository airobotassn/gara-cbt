-- 비기너 문제은행 과목명 정규화 — 업로드 과목명이 /guide 정규 검정과목과 대소문자·공백만 다르면
-- (예: "…피지컬 ai의 이해" ↔ 정규 "…피지컬 AI의 이해") 풀 현황 집계·실제 출제(examDraw)가
-- 과목명 완전일치로만 잡기 때문에 그 과목이 통째로 누락된다. 아래는 대소문자·공백 차이를 흡수해
-- 정규 3과목으로 교정한다. 완전 다른 표현(near-miss 아님)은 건드리지 않으므로 안전·idempotent.
--
-- 전제: 비기너 은행은 question_banks.tier = 'beginner' 단일. 정규 과목은 프론트 getTracks(=/guide)
--   caris.t1.beginner.subj.0~2 와 글자까지 동일해야 함(변경 시 이 목록도 같이 갱신).
do $$
declare
  v_bank uuid;
  v_canon text[] := array[
    '생성형 AI의 일상 활용',
    '일상 속 로봇 기술과 피지컬 AI의 이해',
    '인공지능·로봇 윤리 및 디지털 안전 리터러시'
  ];
  c text;
  n int;
begin
  select id into v_bank from public.question_banks where tier = 'beginner' limit 1;
  if v_bank is null then
    raise notice '[normalize] beginner 은행 없음 — 건너뜀';
    return;
  end if;

  foreach c in array v_canon loop
    -- 대소문자·모든 공백 제거 후 같은데, 원문이 정규명과 정확히 같지는 않은 행만 교정
    update public.questions q
    set subject = c
    where q.bank_id = v_bank
      and q.subject is distinct from c
      and lower(regexp_replace(q.subject, '\s', '', 'g')) = lower(regexp_replace(c, '\s', '', 'g'));
    get diagnostics n = row_count;
    if n > 0 then
      raise notice '[normalize] % → "%" (% rows)', 'near-miss', c, n;
    end if;
  end loop;

  -- 남은 비정규 과목(대소문자·공백 정규화로도 안 맞는 완전 다른 표현) 진단 출력 — 있으면 수동 확인 필요
  for c, n in
    select q.subject, count(*)::int
    from public.questions q
    where q.bank_id = v_bank and q.subject <> all(v_canon)
    group by q.subject
  loop
    raise notice '[normalize] ⚠️ 정규 과목 아님(수동 확인): "%" (% rows)', c, n;
  end loop;
end $$;
