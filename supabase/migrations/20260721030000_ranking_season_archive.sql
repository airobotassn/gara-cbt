-- 랭킹 통합 재설계 STAGE 1c — 시즌 아카이브: ranking_season(시즌 메타) + ranking_season_result(시즌 종료 스냅샷).
--  · 개인 누적(업적 박제)·역대 최고 티어는 이 result 테이블에서 파생. reset_season() 이 스냅샷을 쓴다(STAGE1e).
--  · 활성 시즌 1행 seed — 없으면 reset_season() 이 no-op 가드로 종료(활성 시즌 필수).
--  멱등(재실행 안전). schema.sql 의 동명 블록과 DDL 동일.
create table if not exists ranking_season (
  id serial primary key,
  code text unique,
  starts_on date,
  ends_on date,
  status text not null default 'active'
);
alter table ranking_season enable row level security;

create unique index if not exists ranking_season_active_uidx
  on ranking_season ((status)) where status = 'active';

create table if not exists ranking_season_result (
  season_id int not null,
  user_id uuid references auth.users(id) on delete cascade,
  final_tier text,
  final_rank int,
  skill_score numeric,
  activity_score numeric,
  season_total numeric,
  archived_at timestamptz default now(),
  primary key (season_id, user_id)
);
alter table ranking_season_result enable row level security;

create index if not exists ranking_season_result_user_idx
  on ranking_season_result (user_id);

insert into ranking_season (code, starts_on, status)
  values ('2026Q3', current_date, 'active')
  on conflict (code) do nothing;