-- 문제은행 ↔ 등록시험 2층 재설계 (정공법 — 겸용 제거, 문항 소유를 은행으로 이전).
-- 실사용자 없음 전제: 데모 응시/구 단일시험(gara-default)은 정리한다.

-- 1) 급수별 문제은행
create table if not exists question_banks (
  id uuid primary key default gen_random_uuid(),
  tier text not null unique,   -- beginner|pro|elite|master|grandmaster|zenith (getTracks 티어 key)
  title text not null,
  active boolean not null default true,
  created_at timestamptz default now()
);
insert into question_banks (tier, title) values
  ('beginner','Beginner 문제은행'),
  ('pro','Pro 문제은행'),
  ('elite','Elite 문제은행'),
  ('master','Master 문제은행'),
  ('grandmaster','Grand Master 문제은행'),
  ('zenith','Zenith 문제은행')
on conflict (tier) do nothing;

-- 2) questions 소유 이전: exam_id → bank_id
--    (기존 문항은 pro 은행으로 승계. exam_id FK(on delete cascade)를 먼저 떼야
--     아래 gara-default 삭제 시 문항이 cascade로 날아가지 않는다.)
alter table questions add column if not exists bank_id uuid references question_banks(id);
update questions set bank_id = (select id from question_banks where tier = 'pro') where bank_id is null;
alter table questions alter column bank_id set not null;
alter table questions drop constraint if exists questions_exam_id_number_key; -- unique(exam_id,number)
alter table questions add constraint questions_bank_number_uk unique (bank_id, number);
alter table questions drop column if exists exam_id;
create index if not exists questions_bank_idx on questions(bank_id) where active;

-- 3) 문항 이력 로그(cbt_question_events)도 exam_id → bank_id
alter table cbt_question_events add column if not exists bank_id uuid;
alter table cbt_question_events drop column if exists exam_id;

-- 4) exams 정리 — 은행겸용(round_id null: gara-default 등)과 그 데모 응시 제거.
--    이제 exams = 등록시험(회차×급수)만 남는다.
delete from attempt_answers where attempt_id in (
  select id from exam_attempts where exam_id in (select id from exams where round_id is null)
);
delete from exam_attempts where exam_id in (select id from exams where round_id is null);
delete from exams where round_id is null;

-- 5) 등록시험 ↔ 은행문항 (뽑은 세트, N:M)
create table if not exists exam_questions (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references exams(id) on delete cascade,       -- 등록시험
  question_id uuid not null references questions(id) on delete cascade, -- 은행 문항
  number int not null,                                                 -- 출제 표시 순서 1..N
  created_at timestamptz default now(),
  unique (exam_id, question_id),
  unique (exam_id, number)
);
create index if not exists exam_questions_exam_idx on exam_questions(exam_id);
alter table exam_questions enable row level security; -- service-role 전용(정책 없음)
