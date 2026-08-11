-- 미니게임 문항을 **CARIS 문제은행 방식**으로 — 2026-08-11.
--
-- 앞선 설계(term_questions 풀 하나를 모든 게임이 통째로 공유)는 "게임마다 문항을 넣고 뺄" 수가 없다.
-- CARIS 는 `question_banks`(은행) → `questions`(문항) → `exams`(시험) → `exam_questions`(그 시험의 세트)
-- 구조라 시험마다 다른 문항을 담는다. 미니게임도 같은 모양으로 간다:
--
--   term_banks(은행)  →  term_questions(문항)  →  minigame_question_sets(게임 × 문항)
--
-- ⚠️ CARIS 와 다른 점 하나: 시험은 세트가 **고정**돼야 하지만(1인1회·공정성) 게임은 매판 섞여도 된다.
--    그래서 '뽑기(draw)' 가 없고, 게임에 담긴 문항 전체를 내려보내 게임이 알아서 섞는다.

-- ── 은행 ──────────────────────────────────────────────────────
-- 문항을 묶는 단위(분야·출처별). CARIS 의 question_banks 와 같은 역할.
create table if not exists public.term_banks (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text not null default '',
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
insert into public.term_banks (id, name, description, sort_order)
values ('00000000-0000-0000-0000-0000000000a1', 'AI·로봇 용어', '미니게임·오늘의 학습 공용 기본 은행', 0)
on conflict (id) do nothing;

-- 문항이 어느 은행 소속인지. 기존 문항은 기본 은행으로 넣는다.
alter table public.term_questions add column if not exists bank_id uuid references public.term_banks(id) on delete set null;
update public.term_questions set bank_id = '00000000-0000-0000-0000-0000000000a1' where bank_id is null;
create index if not exists term_questions_bank_idx on public.term_questions (bank_id, active, sort_order);

-- ── 게임 × 문항 ───────────────────────────────────────────────
-- 어떤 게임이 어떤 문항을 쓰는가. **여기 없는 문항은 그 게임에 안 나온다.**
-- ⚠️ game_id 는 _shared/minigames.ts 의 GAMES 키 + 'daily'(오늘의 학습). CHECK 을 걸지 않는 이유:
--    게임이 늘 때마다 마이그레이션을 또 써야 하고, 오타는 화면이 목록에서 고르게 해서 막는다.
create table if not exists public.minigame_question_sets (
  game_id text not null,
  question_id uuid not null references public.term_questions(id) on delete cascade,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  primary key (game_id, question_id)
);
create index if not exists minigame_qsets_game_idx on public.minigame_question_sets (game_id, sort_order);

-- ⚠️ 세트가 **비어 있으면 그 게임은 은행 전체를 쓴다**(조회 쪽 규칙).
--    이 표를 도입하자마자 모든 게임이 문항 0개가 되면 게임이 통째로 망가진다 — 빈 세트 = "아직 안 고름" 이다.
