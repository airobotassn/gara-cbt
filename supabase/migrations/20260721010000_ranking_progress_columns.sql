-- 랭킹 통합 재설계 STAGE 1a — user_progress 실력/활동 점수 분리 컬럼.
--  · skill_score = 기존 응시 기반 실력 트랙, activity_score = 출석/학습/미니게임 등 활동 적립(activity_ledger 트리거 전용).
--  · season_total = 두 트랙 합(generated, 통합 랭킹 정렬 단일출처). tier 컬럼은 두지 않음(read-시점 파생).
--  · 기존 points(옛 랭킹점수) 는 유지(drop 금지) — 하위호환 + 아래 백필 소스.
--  멱등(재실행 안전). schema.sql 의 동명 블록과 DDL 동일.
alter table user_progress add column if not exists skill_score numeric not null default 0;
alter table user_progress add column if not exists activity_score numeric not null default 0;
alter table user_progress add column if not exists season_total numeric generated always as (skill_score + activity_score) stored;
alter table user_progress add column if not exists season_id int;
create index if not exists user_progress_season_total_idx on user_progress (season_total desc, updated_at asc);

-- 인라인 백필(단일 statement): 기존 points(0~10000, 예전 랭킹점수)를 skill_score 초기값으로 복사 — 순서 보존·동점 방지.
--   points=0(미응시자) 는 스킵 — skill_score 는 이미 default 0.
update user_progress set skill_score = points where skill_score = 0 and points > 0;
