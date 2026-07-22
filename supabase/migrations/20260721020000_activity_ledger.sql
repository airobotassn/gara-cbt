-- 랭킹 통합 재설계 STAGE 1b — activity_ledger: 활동 점수 append-only 원장 + user_progress.activity_score 원자 증분 트리거.
--  · 하루-cap 소스(attendance/daily_learn) 멱등키: 부분 unique(user_id, kind, day). minigame 은 게임별 1행/일 unique(user_id, day, source_ref).
--  · 트리거(AFTER INSERT OR UPDATE, SECURITY DEFINER): activity_score += (new.delta − old.delta) 원자 차분 증분(하루-최고 upsert 개선분 반영, complete_daily 원자 패턴, 경합 없음).
--  · user_currency(cosmetic 재화)와 무조인(별개 레이어) — 이 원장은 activity_score 만 갱신한다.
--  멱등(재실행 안전). schema.sql 의 동명 블록과 DDL 동일.
create table if not exists activity_ledger (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  season_id int not null,
  kind text not null check (kind in ('attendance','daily_learn','minigame')),
  delta numeric not null check (delta >= 0),
  day date not null,
  source_ref text,
  created_at timestamptz default now(),
  check (kind <> 'minigame' or source_ref is not null)
);
alter table activity_ledger enable row level security;

create unique index if not exists activity_ledger_daycap_idx
  on activity_ledger (user_id, kind, day) where kind in ('attendance','daily_learn');
create unique index if not exists activity_ledger_minigame_idx
  on activity_ledger (user_id, day, source_ref);

create or replace function activity_ledger_apply() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  v_diff numeric := new.delta - coalesce(old.delta, 0);
begin
  if v_diff = 0 then
    return new;
  end if;
  insert into user_progress (user_id, activity_score, updated_at)
    values (new.user_id, v_diff, now())
    on conflict (user_id) do update
      set activity_score = user_progress.activity_score + v_diff, updated_at = now();
  return new;
end
$$;

drop trigger if exists activity_ledger_apply_trg on activity_ledger;
create trigger activity_ledger_apply_trg
  after insert or update on activity_ledger
  for each row execute function activity_ledger_apply();

revoke execute on function activity_ledger_apply() from public, anon, authenticated;