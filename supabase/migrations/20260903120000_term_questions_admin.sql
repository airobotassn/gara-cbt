-- 미니게임·DAILY QUIZ 문항을 **레벨테스트/CARIS 문항관리와 같은 방식**으로 — 2026-09-03.
--
-- 지금까지 term_questions 는 표만 있고 아무도 안 읽었다(게임은 public/games/*.html 의 POOL,
-- DAILY QUIZ 는 src/lib/terms.ts). 관리자가 고쳐도 화면에 안 나오는 반쪽 상태였다.
-- 이 마이그레이션은 그 표를 **레벨테스트 문항(test_questions)과 같은 모양**으로 맞춘다:
--
--   code(문항번호) · deleted_at(되돌릴 수 있는 삭제) · 변경이력(term_question_events)
--
-- ⚠️ 이력 표를 새로 만드는 이유: question_events 는 `level int` 를 들고 있는 레벨테스트 전용이고
--    CBT 는 이미 cbt_question_events 로 따로 쓴다. 같은 표에 세 제도를 섞으면 이력 탭이 남의 문항을 보여준다.

-- ── 문항 번호 ────────────────────────────────────────────────
-- 레벨테스트 L1-001, CARIS 와 같은 자리. 관리자가 이력·검색에서 문항을 부르는 이름이다.
alter table public.term_questions add column if not exists code text;

-- 기존 문항에 번호를 붙인다(정렬 순서 = 지금 화면에 보이는 순서 그대로).
with numbered as (
  select id, row_number() over (order by sort_order, created_at) as n
  from public.term_questions
  where code is null
)
update public.term_questions t
   set code = 'T-' || lpad(numbered.n::text, 3, '0')
  from numbered
 where t.id = numbered.id;

create unique index if not exists term_questions_code_uniq
  on public.term_questions (code) where code is not null;

-- ── 되돌릴 수 있는 삭제 ──────────────────────────────────────
-- ⛔ 하드 삭제로 두면 잘못 지운 문항을 되살릴 방법이 없다(레벨테스트는 '문항 이력 > 삭제' 탭에서 복구한다).
alter table public.term_questions add column if not exists deleted_at timestamptz;
create index if not exists term_questions_alive_idx
  on public.term_questions (deleted_at, active, sort_order);

-- ⚠️ 정답 유일 인덱스는 `where active` 라, 삭제할 때 active=false 를 같이 찍어야 같은 용어를 다시 넣을 수 있다
--    (서버 termDelete 가 그렇게 한다). 인덱스 자체는 그대로 둔다.

-- ── 변경 이력 ────────────────────────────────────────────────
-- question_id 는 FK 아님 — 문항이 지워져도 로그는 남는다(code 가 안정 참조).
create table if not exists public.term_question_events (
  id uuid primary key default gen_random_uuid(),
  question_id uuid,
  code text,
  action text not null,          -- create | update | deactivate | activate | delete | restore | import
  actor text,
  detail jsonb,
  created_at timestamptz not null default now()
);
create index if not exists term_question_events_created_idx on public.term_question_events (created_at desc);
create index if not exists term_question_events_code_idx on public.term_question_events (code);
alter table public.term_question_events enable row level security;
-- RLS 정책 없음 = service role 전용(관리자 함수만 읽고 쓴다). 레벨테스트 question_events 와 같은 규칙.
