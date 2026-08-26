-- ARENA 레벨 저장 + 레벨업 연출 (2026-08-26)
--
-- 고치는 것: 레벨업이 화면에서 **아무 말 없이** 일어나던 것.
--   ARENA 레벨은 여태 저장되는 값이 아니라 arenaLevelForScore(season_total) 파생값이라,
--   "직전 레벨"을 아는 자리가 코드에도 DB 에도 없었다 → 레벨업 감지 자체가 불가능했다.
--   실제로 사용자가 본 것: 허브에 돌아오면 지난 방문 점수로 먼저 그려진 캐릭터가(hubLook)
--   get-hub 응답이 오는 순간 다음 레벨 그림으로 소리 없이 툭 바뀌는 것.
--
-- 값을 두 곳에 나눠 담는다 — 뜻이 다르기 때문이다.
--   · user_progress.arena_level        = **지금 레벨**(점수 파생 진실값). 트리거가 유지한다.
--   · user_characters.arena_level_seen = **연출을 어디까지 보여줬나**(UI 워터마크).
--
--   ⛔ 워터마크를 user_progress 에 두면 안 된다. character 엣지 함수가 그걸 갱신해야 하는데
--      그 함수엔 cosmetic-only 불변식(user_progress·user_level_skill 무접촉)이 걸려 있다.
--      워터마크는 실력 데이터가 아니라 chosen_at·tutorial_done_at 과 **같은 성질의 UI 플래그**라
--      user_characters 가 제 자리다.
--
-- ⚠️ 레벨이 내려가는 경로는 reset_season() 하나뿐이다(activity_score 만 0으로 민다.
--    skill_score 는 GREATEST 로만 오르고 activity_ledger 는 append-only 라 그 밖엔 안 내려간다).
--    그래서 시즌 리셋 끝에서 워터마크를 **그 시점 레벨로 동기화**한다 — 자세한 이유는 아래 (6).

-- ============================================================================
-- (1) 레벨 공식 — scoring.ts 동기화 페어
-- ============================================================================
-- ⛔ **동기화 페어다.** src/lib/scoring.ts · supabase/functions/_shared/scoring.ts 의
--    arenaLevelForScore() 와 **답이 같아야 한다**(1,000점 균등 밴드 · 1~7 클램프).
--    셋 중 하나만 고치면 화면이 말하는 레벨과 DB 가 저장한 레벨이 갈리고, 그 어긋남은
--    "축하를 못 받았다" 또는 "안 오른 레벨을 축하했다" 로만 드러나 원인을 찾기 어렵다.
--    대조는 tests/db/t-arena-level.mjs 가 두 구현을 전 구간에서 맞춰 본다.
create or replace function public.arena_level_of(p_total numeric) returns int
  language sql immutable as $fn$
  select greatest(1, least(7, (floor(greatest(0, floor(coalesce(p_total, 0))) / 1000) + 1)::int))
$fn$;

-- ============================================================================
-- (2) user_progress.arena_level — 지금 레벨(저장값)
-- ============================================================================
alter table user_progress add column if not exists arena_level int not null default 1;

-- 레벨로 거르거나 정렬하는 조회(랭킹·관리자·통계)가 인덱스를 타게 한다.
create index if not exists user_progress_arena_level_idx on user_progress (arena_level);

-- ⛔ **season_total 을 읽으면 안 된다.** 그건 generated 컬럼이고 Postgres 는 generated 값을
--    BEFORE 트리거가 **끝난 뒤에** 계산한다 → BEFORE 트리거 안의 new.season_total 은 옛 값(또는 null)이다.
--    반드시 원천 두 컬럼(skill_score + activity_score)에서 직접 더한다.
create or replace function public.user_progress_arena_level() returns trigger
  language plpgsql as $fn$
begin
  new.arena_level := arena_level_of(coalesce(new.skill_score, 0) + coalesce(new.activity_score, 0));
  return new;
end
$fn$;

drop trigger if exists user_progress_arena_level_trg on user_progress;
create trigger user_progress_arena_level_trg
  before insert or update on user_progress
  for each row execute function public.user_progress_arena_level();

-- 기존 행 백필.
update user_progress
   set arena_level = arena_level_of(season_total)
 where arena_level is distinct from arena_level_of(season_total);

-- ============================================================================
-- (3) user_characters.arena_level_seen — 연출 워터마크
-- ============================================================================
alter table user_characters add column if not exists arena_level_seen int not null default 1;

-- ⚠️ 기존 회원은 **지금 레벨로** 채운다. default 1 로 두면 이미 Lv.5 인 사람이 다음에 허브를 열 때
--    "1 → 5, 4레벨 상승" 축하를 받는다 — 방금 오른 적이 없는데 오른 것처럼 거짓말을 한다.
update user_characters uc
   set arena_level_seen = up.arena_level
  from user_progress up
 where up.user_id = uc.user_id
   and uc.arena_level_seen is distinct from up.arena_level;

-- ============================================================================
-- (4) hub_choose_character — 첫 행이 생길 때 워터마크를 현재 레벨로 맞춘다
-- ============================================================================
-- 20260824120000 의 것과 **(1) 의 insert 한 줄만 다르다**(arena_level_seen 초기값).
-- ⚠️ 안 맞추면 이렇다: 레벨테스트만 보고 허브엔 한 번도 안 온 사람(이미 Lv.3)이 캐릭터를
--    고르는 순간 워터마크가 1로 시작해 "1 → 3" 축하가 뜬다. 첫 진입 시점의 레벨은 이미 본 것으로 친다.
create or replace function hub_choose_character(p_uid uuid, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_chosen timestamptz;
  v_active boolean;
  v_first  boolean;
begin
  if p_uid is null then
    raise exception 'unauthorized';
  end if;

  -- (0) 실재하는 캐릭터인가. 판매 여부도 같이 읽는다(첫 선택 무료 자격 판정에 쓴다).
  --     여기서 active 로 **걸러내면 안 된다** — 진열에서 내린 캐릭터도 이미 가진 사람은
  --     계속 입어야 한다. 그래서 값만 읽고 판정은 첫 선택 분기 안에서 한다.
  select active into v_active
    from shop_catalog where part_key = p_key and kind = 'character';
  if v_active is null then
    raise exception 'invalid_character';
  end if;

  -- (1) 장착 행 보장 + 잠금. 이 잠금이 아래 '첫 선택인가' 판정의 유일한 근거다.
  --     ⚠️ 행을 새로 만들 때 워터마크를 **지금 레벨**로 시작한다(위 (4) 주석 참고).
  insert into user_characters (user_id, arena_level_seen)
    values (p_uid, coalesce((select arena_level from user_progress where user_id = p_uid), 1))
    on conflict (user_id) do nothing;
  select chosen_at into v_chosen from user_characters where user_id = p_uid for update;
  v_first := v_chosen is null;

  if v_first then
    -- (2a) 첫 선택 — **판매 중인 캐릭터라면 값과 무관하게** 한 종을 공짜로 준다.
    --      진열에서 내린 것은 준다는 말을 한 적이 없으므로 거절한다(선택 화면도 안 보여준다 —
    --      get-hub 가 active 만 내려준다).
    if not v_active then
      raise exception 'not_owned';
    end if;
    insert into user_cosmetics (user_id, part_key, source)
      values (p_uid, p_key, 'starter')
      on conflict (user_id, part_key) do nothing;
  else
    -- (2b) 갈아입기 — 소유한 것만. 상점을 거치지 않고 장착하는 경로를 여기서 끊는다.
    if not exists (select 1 from user_cosmetics where user_id = p_uid and part_key = p_key) then
      raise exception 'not_owned';
    end if;
  end if;

  -- (3) 장착. chosen_at 은 **처음 값을 지킨다**(coalesce) — 갈아입을 때마다 밀면
  --     "첫 선택을 언제 했나"가 사라지고 첫 선택 무료가 다시 열린다.
  update user_characters
     set base_key   = p_key,
         chosen_at  = coalesce(chosen_at, now()),
         updated_at = now()
   where user_id = p_uid;

  return jsonb_build_object('base_key', p_key, 'first', v_first);
end;
$fn$;
revoke all on function hub_choose_character(uuid, text) from public, anon, authenticated;
grant execute on function hub_choose_character(uuid, text) to service_role;

-- ============================================================================
-- (5) hub_level_seen — 연출을 다 보여준 뒤 워터마크를 올린다
-- ============================================================================
-- ⚠️ **지금 레벨을 넘겨서 올릴 수 없다**(least). 클라가 보낸 값을 그대로 믿으면 아직 오르지도 않은
--    레벨을 '봤다'고 찍어서 진짜 레벨업 때 축하가 통째로 사라진다 — 되돌릴 방법이 없는 종류의 손실이다.
-- ⚠️ **내려가지도 않는다**(greatest). 늦게 도착한 옛 요청이 워터마크를 되돌려 같은 축하가 두 번 뜨는 걸 막는다.
create or replace function public.hub_level_seen(p_uid uuid, p_level int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_now  int;
  v_seen int;
begin
  if p_uid is null then
    raise exception 'unauthorized';
  end if;

  select coalesce(arena_level, 1) into v_now from user_progress where user_id = p_uid;
  v_now := coalesce(v_now, 1);

  -- ⚠️ 행이 없으면 **지금 레벨로** 심는다(1이 아니다) — hub_choose_character 와 같은 규칙이다.
  --    1로 심으면 이 함수가 캐릭터 선택보다 먼저 불린 계정에서 워터마크가 1에 눌러앉고,
  --    나중에 캐릭터를 고를 때 hub_choose_character 의 insert 는 on conflict do nothing 이라
  --    그 1이 그대로 남아 "1 → 지금 레벨" 가짜 축하가 뜬다.
  insert into user_characters (user_id, arena_level_seen) values (p_uid, v_now)
    on conflict (user_id) do nothing;

  update user_characters
     set arena_level_seen = greatest(arena_level_seen, least(coalesce(p_level, 1), v_now)),
         updated_at = now()
   where user_id = p_uid
  returning arena_level_seen into v_seen;

  return jsonb_build_object('seen', coalesce(v_seen, 1), 'level', v_now);
end;
$fn$;
revoke all on function public.hub_level_seen(uuid, int) from public, anon, authenticated;
grant execute on function public.hub_level_seen(uuid, int) to service_role;

-- ============================================================================
-- (6) reset_season() — 시즌 리셋 끝에서 워터마크를 그 시점 레벨로 동기화
-- ============================================================================
-- 20260721050000 의 것과 **update user_characters 한 문장만 다르다**.
--
-- ⛔ 이 한 문장이 없으면 시즌 리셋이 레벨업 연출을 둘 중 하나로 망가뜨린다.
--    · 활동으로 점수를 쌓던 사람: Lv.5 → Lv.1 로 떨어지는데 워터마크는 5로 남는다
--      → 다시 Lv.2·3·4 를 밟아도 level > seen 이 거짓이라 **축하가 영영 안 뜬다.**
--    · 그렇다고 워터마크를 일괄 1로 밀면 반대로 터진다 — skill_score 는 리셋에서 안 깎이므로
--      Lv.7 인 사람은 레벨이 그대로인데 워터마크만 1이 되어 **"1 → 7, 6레벨 상승"** 이 뜬다.
--    그래서 '1로 밀기'가 아니라 '**그 시점 레벨로 맞추기**'다. 떨어진 사람은 다시 오를 때
--    한 계단씩 축하받고, 안 떨어진 사람은 아무 일도 안 일어난다.
-- ⚠️ activity_score = 0 **뒤에** 와야 한다. 그 UPDATE 가 트리거를 태워 arena_level 을 새로 계산하므로,
--    앞에 두면 리셋 전 레벨로 맞춰진다.
create or replace function public.reset_season() returns jsonb
  language plpgsql security definer set search_path = public as $fn$
declare
  v_season_id int;
  v_next_code text;
  v_next_id int;
begin
  perform pg_advisory_xact_lock(923874165);

  select id into v_season_id from ranking_season where status = 'active' order by id desc limit 1;
  if v_season_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_active_season');
  end if;

  insert into ranking_season_result (season_id, user_id, final_tier, final_rank, skill_score, activity_score, season_total, archived_at)
  select
    v_season_id,
    up.user_id,
    ranking_tier((cume_dist() over (order by up.season_total desc))::numeric),
    row_number() over (order by up.season_total desc, up.updated_at asc),
    up.skill_score, up.activity_score, up.season_total, now()
  from user_progress up
  join profiles pr on pr.id = up.user_id and pr.deactivated_at is null
  on conflict (season_id, user_id) do nothing;

  update user_progress set activity_score = 0, updated_at = now();

  -- 레벨업 연출 워터마크 재동기화(2026-08-26). 위 UPDATE 가 트리거를 태운 **뒤**라 arena_level 은 이미 새 값이다.
  update user_characters uc
     set arena_level_seen = up.arena_level
    from user_progress up
   where up.user_id = uc.user_id
     and uc.arena_level_seen is distinct from up.arena_level;

  update ranking_season set status = 'archived', ends_on = current_date where id = v_season_id;
  v_next_code := to_char(current_date, 'YYYY') || '-S' || v_season_id::text;
  insert into ranking_season (code, starts_on, status)
    values (v_next_code, current_date, 'active')
    on conflict (code) do nothing
    returning id into v_next_id;
  if v_next_id is null then
    select id into v_next_id from ranking_season where code = v_next_code;
  end if;

  return jsonb_build_object('ok', true, 'archived_season_id', v_season_id, 'next_season_id', v_next_id);
end
$fn$;

revoke all on function public.reset_season() from public, anon, authenticated;
grant execute on function public.reset_season() to service_role;
