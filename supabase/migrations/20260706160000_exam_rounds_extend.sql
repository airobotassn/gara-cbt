-- exam_rounds 확장 — 일정 페이지를 알차게: 2026 제1·2회(7·8월) + 2027 제2·3·4회(분기별) 추가.
--  · 기존 시드(제3회 2026 · 제4회 2026 · 제1회 2027 · 상시 CBT)의 앞뒤를 채움.
--    - 2026 제1·2회는 제3회(9월)보다 앞이라 sort 4·6(정렬 최상단), 접수기간은 오늘 기준 접수중.
--    - 2027 제2·3·4회는 분기별 셋째 토요일, sort 40~60.
--  · 시험일은 실제 date, 접수기간은 timestamptz(KST). 회차명은 6개국어 JSONB.
--  · 중복 방지: '제 1회 정기시험'이 이미 있으면 전체 스킵(여러 번 실행 안전).
insert into public.exam_rounds (kind, title_i18n, exam_date, apply_start_at, apply_end_at, note_i18n, sort)
select * from (values
  (
    'regular'::text,
    '{"ko":"제 1회 정기시험","en":"1st Regular Exam","ja":"第1回 定期試験","zh":"第1届定期考试","hi":"पहली नियमित परीक्षा","vi":"Kỳ thi định kỳ lần 1"}'::jsonb,
    '2026-07-18'::date,
    '2026-06-01T00:00:00+09:00'::timestamptz,
    '2026-07-13T23:59:59+09:00'::timestamptz,
    '{}'::jsonb,
    4
  ),
  (
    'regular',
    '{"ko":"제 2회 정기시험","en":"2nd Regular Exam","ja":"第2回 定期試験","zh":"第2届定期考试","hi":"दूसरी नियमित परीक्षा","vi":"Kỳ thi định kỳ lần 2"}'::jsonb,
    '2026-08-15'::date,
    '2026-06-15T00:00:00+09:00'::timestamptz,
    '2026-08-08T23:59:59+09:00'::timestamptz,
    '{}'::jsonb,
    6
  ),
  (
    'regular',
    '{"ko":"제 2회 정기시험 (2027)","en":"2nd Regular Exam (2027)","ja":"第2回 定期試験 (2027)","zh":"第2届定期考试 (2027)","hi":"दूसरी नियमित परीक्षा (2027)","vi":"Kỳ thi định kỳ lần 2 (2027)"}'::jsonb,
    '2027-06-19'::date,
    '2027-04-01T00:00:00+09:00'::timestamptz,
    '2027-05-29T23:59:59+09:00'::timestamptz,
    '{}'::jsonb,
    40
  ),
  (
    'regular',
    '{"ko":"제 3회 정기시험 (2027)","en":"3rd Regular Exam (2027)","ja":"第3回 定期試験 (2027)","zh":"第3届定期考试 (2027)","hi":"तीसरी नियमित परीक्षा (2027)","vi":"Kỳ thi định kỳ lần 3 (2027)"}'::jsonb,
    '2027-09-18'::date,
    '2027-07-01T00:00:00+09:00'::timestamptz,
    '2027-08-28T23:59:59+09:00'::timestamptz,
    '{}'::jsonb,
    50
  ),
  (
    'regular',
    '{"ko":"제 4회 정기시험 (2027)","en":"4th Regular Exam (2027)","ja":"第4回 定期試験 (2027)","zh":"第4届定期考试 (2027)","hi":"चौथी नियमित परीक्षा (2027)","vi":"Kỳ thi định kỳ lần 4 (2027)"}'::jsonb,
    '2027-12-18'::date,
    '2027-10-01T00:00:00+09:00'::timestamptz,
    '2027-11-27T23:59:59+09:00'::timestamptz,
    '{}'::jsonb,
    60
  )
) as v(kind, title_i18n, exam_date, apply_start_at, apply_end_at, note_i18n, sort)
where not exists (
  select 1 from public.exam_rounds where title_i18n->>'ko' = '제 1회 정기시험'
);
