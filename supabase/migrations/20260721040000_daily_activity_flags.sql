-- 랭킹 통합 재설계 STAGE 1d — daily_activity 활동 플래그(출석/학습/미니게임/레벨테스트) — 활동잔디 색·풀콤 소스.
--  멱등(재실행 안전). schema.sql 의 동명 블록과 DDL 동일.
alter table daily_activity add column if not exists did_attendance bool not null default false;
alter table daily_activity add column if not exists did_learn bool not null default false;
alter table daily_activity add column if not exists did_minigame bool not null default false;
alter table daily_activity add column if not exists did_leveltest bool not null default false;
