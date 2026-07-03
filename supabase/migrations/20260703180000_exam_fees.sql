-- 응시료(exam_fees) — 급수/합격컷/과목은 코드 고정, "응시료 금액"만 관리자 편집 대상.
-- 키-값 5개: Pro 단일 응시료 + Master 급수별(4~1급). 통화는 원(정수). i18n 불필요(숫자).
-- 공개 read(누구나) — 원서접수(ExamApply) 결제요약이 직접 read. 쓰기는 admin 함수(service role) 전용.

create table if not exists public.exam_fees (
  key text primary key,          -- 'pro' | 'master_g4' | 'master_g3' | 'master_g2' | 'master_g1'
  amount integer not null default 0,  -- 원
  updated_at timestamptz not null default now()
);

alter table public.exam_fees enable row level security;
drop policy if exists exam_fees_public_read on public.exam_fees;
create policy exam_fees_public_read on public.exam_fees
  for select using (true);

-- 시드 — 기존 caris.ts 하드코딩 값 그대로(임시값, 정책 확정 후 관리자가 조정).
insert into public.exam_fees (key, amount) values
  ('pro', 30000),
  ('master_g4', 80000),
  ('master_g3', 100000),
  ('master_g2', 120000),
  ('master_g1', 150000)
on conflict (key) do nothing;
