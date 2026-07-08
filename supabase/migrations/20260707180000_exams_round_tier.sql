-- 회차별 시험(급수) 등록 — exams 를 (회차 × 급수) 독립 인스턴스로.
-- 한 회차가 어떤 급수를 열었는지 = 그 round_id + tier 의 exams 행 존재.
-- 문항(questions.exam_id)이 이미 exam 단위라, 이렇게 쪼개면 "회차마다 다른 문항"이 스키마 변경 없이 성립.

alter table exams add column if not exists round_id uuid references exam_rounds(id);
alter table exams add column if not exists tier text;  -- getTracks 티어 key: beginner|pro|elite|master|grandmaster|zenith

-- (round_id, tier) 유일. NULLS DISTINCT 기본이라 legacy gara-default(round_id=null, tier=null)는 충돌 안 함.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'exams_round_tier_uk'
  ) then
    alter table exams add constraint exams_round_tier_uk unique (round_id, tier);
  end if;
end $$;

create index if not exists exams_round_idx on exams(round_id);
