-- 시험 일정/회차(exam_rounds) — 정기(regular)·상시(rolling) 시험 일정.
-- 공개 페이지(Guide 히어로·ExamSchedule)가 직접 read, 관리자(admin 함수)가 CRUD.
-- 날짜는 실제 date/timestamptz 로 저장(관리자는 날짜선택기 입력) → 화면은 언어별 자동 포맷.
-- 회차명(title)·부가설명(note)은 6개국어 JSONB(한국어 입력 → 저장 시 자동번역).

create table if not exists public.exam_rounds (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'regular' check (kind in ('regular', 'rolling')),
  title_i18n jsonb not null default '{}'::jsonb,   -- 회차명/상시명
  exam_date date,                                   -- 정기 시험일(상시는 null)
  apply_start_at timestamptz,                       -- 접수 시작
  apply_end_at timestamptz,                         -- 접수 마감
  note_i18n jsonb not null default '{}'::jsonb,     -- 부가 설명(상시 desc 등, 선택)
  published boolean not null default true,
  sort integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 공개 read: 발행된 것만. 쓰기 정책 없음 = service role(admin 함수) 전용.
alter table public.exam_rounds enable row level security;
drop policy if exists exam_rounds_public_read on public.exam_rounds;
create policy exam_rounds_public_read on public.exam_rounds
  for select using (published = true);

-- 시드(테이블이 비어있을 때만) — 기존 하드코딩 일정 그대로.
-- 접수기간은 기준일(2026-07-03) 기준으로 제3회=접수중, 나머지=예정이 되도록 설정.
insert into public.exam_rounds (kind, title_i18n, exam_date, apply_start_at, apply_end_at, note_i18n, sort)
select * from (values
  (
    'regular',
    '{"ko":"제 3회 정기시험","en":"3rd Regular Exam","ja":"第3回 定期試験","zh":"第3届定期考试","hi":"तीसरी नियमित परीक्षा","vi":"Kỳ thi định kỳ lần 3"}'::jsonb,
    '2026-09-19'::date,
    '2026-07-01T00:00:00+09:00'::timestamptz,
    '2026-08-31T23:59:59+09:00'::timestamptz,
    '{}'::jsonb,
    10
  ),
  (
    'regular',
    '{"ko":"제 4회 정기시험","en":"4th Regular Exam","ja":"第4回 定期試験","zh":"第4届定期考试","hi":"चौथी नियमित परीक्षा","vi":"Kỳ thi định kỳ lần 4"}'::jsonb,
    '2026-12-19'::date,
    '2026-10-01T00:00:00+09:00'::timestamptz,
    '2026-11-30T23:59:59+09:00'::timestamptz,
    '{}'::jsonb,
    20
  ),
  (
    'regular',
    '{"ko":"제 1회 정기시험 (2027)","en":"1st Regular Exam (2027)","ja":"第1回 定期試験 (2027)","zh":"第1届定期考试 (2027)","hi":"पहली नियमित परीक्षा (2027)","vi":"Kỳ thi định kỳ lần 1 (2027)"}'::jsonb,
    '2027-03-20'::date,
    '2027-01-05T00:00:00+09:00'::timestamptz,
    '2027-02-28T23:59:59+09:00'::timestamptz,
    '{}'::jsonb,
    30
  ),
  (
    'rolling',
    '{"ko":"CARIS Pro 상시 검정 (CBT)","en":"CARIS Pro Rolling Exam (CBT)","ja":"CARIS Pro 常時検定 (CBT)","zh":"CARIS Pro 常规检定 (CBT)","hi":"CARIS Pro रोलिंग परीक्षा (CBT)","vi":"Kỳ thi thường trực CARIS Pro (CBT)"}'::jsonb,
    null::date,
    null::timestamptz,
    null::timestamptz,
    '{"ko":"원하는 날짜를 예약해 온라인(CBT)으로 응시하는 상시 검정입니다.","en":"A rolling exam you take online (CBT) on a date you book.","ja":"ご希望の日付を予約してオンライン（CBT）で受験する常時検定です。","zh":"预约所需日期，通过在线(CBT)应试的常规检定。","hi":"अपनी पसंद की तारीख बुक कर ऑनलाइन (CBT) दी जाने वाली सतत परीक्षा।","vi":"Kỳ thi thường trực bạn dự online (CBT) vào ngày đã đặt."}'::jsonb,
    10
  )
) as v(kind, title_i18n, exam_date, apply_start_at, apply_end_at, note_i18n, sort)
where not exists (select 1 from public.exam_rounds);
