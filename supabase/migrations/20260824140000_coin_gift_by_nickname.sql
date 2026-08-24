-- 코인 선물 — 상대를 **친구코드가 아니라 닉네임**으로 지목한다(2026-08-24).
--
-- 왜 바꾸나: 코드를 주고받아야만 보낼 수 있어서, 랭킹·채팅에서 본 사람에게 보낼 길이 없었다.
--   닉네임은 이미 유일하다(`profiles_nickname_key_uniq` — 소문자·공백제거 정규화 키, 탈퇴자·미확정 제외)
--   므로 지목 수단으로 성립한다. 이 마이그레이션은 그 인덱스와 **같은 표현식**으로 찾는다 —
--   다르게 쓰면 인덱스를 못 타는 것보다 나쁘게, 유니크가 보장하는 '한 명'이 두 명이 될 수 있다.
--
-- ⛔ 대신 **오타 방어선이 무너진다**. 옛 구조에서 오타를 막던 유일한 장치는 "코드 8자를 치면
--    내가 모르는 값(상대 닉네임)이 뜬다" 였다. 닉네임을 치면 확인 칸에 방금 친 값이 그대로
--    되돌아오므로 확인 기능이 0이 된다. 게다가 랜덤 코드는 한 글자 틀리면 거의 확실히 '없는 코드'
--    지만, 닉네임은 사람이 고른 값이라 `민수` / `민수1` 처럼 **한 글자 차이로 실존하는 사람**이
--    있을 확률이 훨씬 높다 — 즉시 이체 + 회수 불가라 그대로 두면 돈이 조용히 남에게 간다.
--    그래서 `coin_gift_lookup` 이 이름만 주지 않고 **상대 카드**(아바타·시즌점수·국가·지역)를 준다.
--    사용자가 안 친 정보라야 확인 절차가 된다.
--
-- ⚠️ 파라미터 이름을 `p_code` → `p_nick` 으로 바꾼다. CREATE OR REPLACE 로는 인자 이름을 못 바꾸므로
--    먼저 DROP 한다. 이름을 그대로 두고 의미만 바꾸면 다음 사람이 코드를 넣어보고 헤맨다.
--    ⚠️ 대가: **옛 파일(20260807120000)을 이 파일 뒤에 다시 얹으면 죽는다**
--       ("cannot change name of input parameter"). 마이그레이션은 순서대로 한 번씩만 적용되므로
--       실제로는 일어나지 않는 조합이고, 새 DB 는 옛 파일 → 이 파일 순서로 정상 통과한다.
--       `t-coin-gift.mjs` 의 '재실행 안전' 검증도 그래서 최신 파일만 다시 돌린다.
-- ⚠️ 잠금 순서·멱등·쿨다운·잔액의 **순서는 손대지 않는다**(20260807120000 의 주석이 이유를 적어뒀다).
--    바뀐 것은 (2) '수신자를 어떻게 찾는가' 한 단계뿐이다.

drop function if exists public.coin_gift_lookup(uuid, text);
drop function if exists public.coin_gift(uuid, text, int, text);

-- ---------- 조회 (닉네임 → 상대 카드) ----------
-- ⚠️ 쿼터를 30 → 60 회로 올린다. 옛 구조는 코드 길이가 8 로 고정이라 프론트가 **정확히 한 번** 조회했지만,
--    닉네임은 길이가 제각각이라 타이핑 중 디바운스가 몇 번 끊겨 같은 의도에 2~4회가 나간다.
--    60/10분은 여전히 스크래퍼 속도가 아니고, 애초에 닉네임은 랭킹·채팅에 공개된 값이라
--    옛 '유효 코드 수집' 위험과 성질이 다르다(코드는 비공개 값이었다).
create or replace function public.coin_gift_lookup(p_uid uuid, p_nick text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  c_window_min constant int := 10;
  c_max        constant int := 60;
  c_min_len    constant int := 2;   -- set-nickname 과 같은 길이 규칙(2~12)
  c_max_len    constant int := 12;

  v_key    text;
  v_n      int;
  v_id     uuid;
  v_name   text;
  v_avatar text;
  v_country text;
  v_region  text;
  v_season  bigint;
begin
  -- 길이가 규칙 밖인 건 DB 를 안 보고 튕긴다 → 쿼터도 소모하지 않는다(치는 도중에 한도가 닳으면 안 된다).
  v_key := lower(regexp_replace(trim(coalesce(p_nick, '')), '\s+', '', 'g'));
  if char_length(v_key) < c_min_len or char_length(v_key) > c_max_len then
    return jsonb_build_object('error', 'not_found');
  end if;

  insert into coin_gift_lookup_quota (user_id) values (p_uid) on conflict (user_id) do nothing;
  -- SET 우변의 window_start 는 **갱신 전 값**이라 한 문장 안에서 창 만료 판정과 리셋이 같이 된다.
  update coin_gift_lookup_quota
     set window_start = case when window_start < now() - make_interval(mins => c_window_min) then now() else window_start end,
         n            = case when window_start < now() - make_interval(mins => c_window_min) then 1    else n + 1 end
   where user_id = p_uid
  returning n into v_n;
  if v_n > c_max then
    return jsonb_build_object('error', 'too_many');
  end if;

  -- ⚠️ where 절이 유니크 인덱스(`profiles_nickname_key_uniq`)의 조건과 같아야 한다 —
  --    `nickname_set_at is not null` 을 빼면 닉네임을 확정하지 않은 계정(가입 트리거가 넣은 구글
  --    실명이 그대로 들어 있는 상태)까지 걸려서, 실명으로 남을 지목할 수 있게 된다.
  select id, coalesce(nullif(trim(display_name), ''), 'CARI'), avatar_url, country_code, region_code
    into v_id, v_name, v_avatar, v_country, v_region
    from profiles
   where lower(regexp_replace(display_name, '\s+', '', 'g')) = v_key
     and nickname_set_at is not null
     and deactivated_at is null;

  if v_id is null then return jsonb_build_object('error', 'not_found'); end if;
  if v_id = p_uid then return jsonb_build_object('error', 'self'); end if;

  -- 시즌 총점은 화면이 ARENA 레벨로 바꿔 보여준다 — 레벨 공식(`arenaLevelForScore`)의 단일 출처가
  -- 프론트 scoring.ts 라 여기서 레벨을 계산하지 않는다(SQL 에 한 벌 더 두면 두 화면이 어긋난다).
  --   ⚠️ 이건 **읽기 전용**이다. cosmetic-only 불변식은 "선물이 실력·순위 데이터를 바꾸지 않는다"는
  --      뜻이고(그래서 한도 없이 보내도 순위가 안 흔들린다), 카드에 쓸 값을 읽는 건 그 약속과 무관하다.
  --      쓰기는 여전히 한 줄도 없다.
  select season_total into v_season from user_progress where user_id = v_id;

  return jsonb_build_object(
    'name', v_name,
    'avatar', v_avatar,
    'country_code', v_country,
    'region_code', v_region,
    'season_total', coalesce(v_season, 0)
  );
end;
$fn$;

-- ---------- 이체 ----------
create or replace function public.coin_gift(p_uid uuid, p_nick text, p_amount int, p_nonce text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  -- 스팸 가드. 금액 한도는 두지 않기로 했으므로(잔액이 곧 한도) 이건 돈이 아니라
  -- **받는 사람의 알림**을 지키는 장치다 — 1코인씩 연타하면 상대 선물함이 도배된다.
  c_cooldown_sec constant int := 10;
  c_min_len constant int := 2;
  c_max_len constant int := 12;

  v_row       coin_transfers%rowtype;
  v_key       text;
  v_recipient uuid;
  v_recipient_name text;
  v_sender_name    text;
  v_lo uuid;
  v_hi uuid;
  v_points bigint;
  v_sender_after    bigint;
  v_recipient_after bigint;
begin
  -- (0) 멱등 — 이 nonce 로 이미 보냈으면 그때 결과를 그대로 돌려주고 **이체하지 않는다**.
  --     즉시 이체라 회수가 불가능해서, 재시도가 두 번 보내기가 되면 되돌릴 방법이 없다.
  select * into v_row from coin_transfers where sender_id = p_uid and client_nonce = p_nonce;
  if found then
    return jsonb_build_object(
      'duplicate', true, 'amount', v_row.amount,
      'recipient_name', v_row.recipient_name, 'points_after', v_row.sender_balance_after
    );
  end if;

  -- (1) 금액. 0 이하는 CHECK 도 막지만 여기서 사람 말로 튕긴다.
  --     특히 음수 — 통과하면 `points - (-100)` 이 되어 선물하기가 뺏기가 된다.
  if p_amount is null or p_amount <= 0 then raise exception 'invalid_amount'; end if;

  -- (2) 닉네임 → 수신자. ⛔ **조회(coin_gift_lookup)와 같은 규칙으로 찾아야 한다.**
  --     한쪽만 고치면 화면에 뜬 사람과 실제로 받는 사람이 갈린다 — 되돌릴 수 없는 이체에서 그건 사고다.
  v_key := lower(regexp_replace(trim(coalesce(p_nick, '')), '\s+', '', 'g'));
  if char_length(v_key) < c_min_len or char_length(v_key) > c_max_len then
    raise exception 'recipient_not_found';
  end if;
  select id, coalesce(nullif(trim(display_name), ''), 'CARI')
    into v_recipient, v_recipient_name
    from profiles
   where lower(regexp_replace(display_name, '\s+', '', 'g')) = v_key
     and nickname_set_at is not null
     and deactivated_at is null;
  if v_recipient is null    then raise exception 'recipient_not_found'; end if;
  if v_recipient = p_uid    then raise exception 'self_transfer'; end if;

  select coalesce(nullif(trim(display_name), ''), 'CARI') into v_sender_name
    from profiles where id = p_uid;

  -- (3) ⛔ **두 행을 uuid 오름차순으로 잠근다.** 이 순서가 이 함수에서 제일 중요한 한 줄이다.
  --     "내 행 먼저, 상대 행 나중" 으로 짜면 A→B 와 B→A 가 동시에 들어올 때 서로 상대 행을 기다려
  --     데드락이 난다(Postgres 가 한쪽을 죽여서 사용자에게는 원인 불명의 실패로 보인다).
  --     보내는 쪽이 누구든 항상 같은 순서로 잠그면 그 교착이 성립할 수 없다.
  --     행이 없으면 for update 가 아무것도 잠그지 않으므로 먼저 만들어둔다 — 이 insert 도 같은 순서로.
  v_lo := least(p_uid, v_recipient);
  v_hi := greatest(p_uid, v_recipient);
  insert into user_currency (user_id) values (v_lo) on conflict (user_id) do nothing;
  insert into user_currency (user_id) values (v_hi) on conflict (user_id) do nothing;
  perform 1 from user_currency where user_id = v_lo for update;
  perform 1 from user_currency where user_id = v_hi for update;

  -- (4) ⛔ **멱등 재확인 — 쿨다운보다 반드시 먼저.**
  --     (0) 의 검사는 잠금 전이라, 같은 nonce 요청 둘이 나란히 통과할 수 있다. 그 상태로 아래
  --     쿨다운을 먼저 만나면 **재시도가 too_fast 로 거절된다** — 돈은 이미 나갔는데 화면은
  --     "너무 자주 보냈어요"를 띄우는, 사용자가 다시 보내게 만드는 최악의 조합이다
  --     (2026-08-07 동시성 테스트에서 8발 중 4발이 실제로 그렇게 거절됐다).
  --     여기는 잠금을 쥔 뒤라 새 스냅샷이 커밋된 원장을 본다 → 원래 결과를 그대로 돌려준다.
  select * into v_row from coin_transfers where sender_id = p_uid and client_nonce = p_nonce;
  if found then
    return jsonb_build_object(
      'duplicate', true, 'amount', v_row.amount,
      'recipient_name', v_row.recipient_name, 'points_after', v_row.sender_balance_after
    );
  end if;

  -- (5) 스팸 가드 — 같은 사람에게 연속 전송만 막는다(다른 사람에게는 제한 없음).
  --     ⚠️ **반드시 잠금 뒤에 온다.** 잠금 앞에 두면 같은 발신자의 동시 요청 둘이 나란히
  --     "직전 전송 없음"을 보고 **둘 다 통과한다**(2026-08-07 동시성 테스트에서 실제로 재현됐다).
  --     잠금 뒤면 둘째 요청이 발신자 행에서 첫째를 기다렸다가, READ COMMITTED 라 이 SELECT 가
  --     새 스냅샷을 잡아 **커밋된 첫째 원장 행을 본다** → too_fast 로 정상 차단된다.
  if exists (
    select 1 from coin_transfers
     where sender_id = p_uid and recipient_id = v_recipient
       and created_at > now() - make_interval(secs => c_cooldown_sec)
  ) then
    raise exception 'too_fast';
  end if;

  -- (6) 잔액은 **잠근 뒤에** 읽는다. 잠그기 전에 읽으면 두 창에서 동시에 보낼 때 둘 다 통과한다.
  select points into v_points from user_currency where user_id = p_uid;
  if coalesce(v_points, 0) < p_amount then raise exception 'insufficient_points'; end if;

  -- (7) 이동. 차감·적립·원장이 한 트랜잭션이라 "빠졌는데 안 들어간" 중간 상태가 존재하지 않는다.
  update user_currency set points = points - p_amount, updated_at = now()
   where user_id = p_uid returning points into v_sender_after;
  update user_currency set points = points + p_amount, updated_at = now()
   where user_id = v_recipient returning points into v_recipient_after;

  -- (8) 원장.
  insert into coin_transfers (
    sender_id, recipient_id, sender_name, recipient_name,
    amount, client_nonce, sender_balance_after, recipient_balance_after
  ) values (
    p_uid, v_recipient, v_sender_name, v_recipient_name,
    p_amount, p_nonce, v_sender_after, v_recipient_after
  );

  return jsonb_build_object(
    'duplicate', false, 'amount', p_amount,
    'recipient_name', v_recipient_name, 'points_after', v_sender_after
  );

exception
  when unique_violation then
    -- 같은 nonce 두 요청이 **진짜 동시에** 들어온 경우다((0) 검사를 둘 다 통과한다).
    -- 이 블록에 들어온 시점에 위에서 한 이체는 통째로 롤백돼 있고, 유니크 위반은 상대 트랜잭션이
    -- 커밋된 뒤에야 터지므로 그 행은 지금 읽을 수 있다. 먼저 성공한 쪽 결과를 돌려주면
    -- 밖에서 보기에 "한 번 보냈다"와 완전히 같아진다.
    select * into v_row from coin_transfers where sender_id = p_uid and client_nonce = p_nonce;
    if found then
      return jsonb_build_object(
        'duplicate', true, 'amount', v_row.amount,
        'recipient_name', v_row.recipient_name, 'points_after', v_row.sender_balance_after
      );
    end if;
    raise;
end;
$fn$;

revoke all on function public.coin_gift_lookup(uuid, text) from public, anon, authenticated;
revoke all on function public.coin_gift(uuid, text, int, text) from public, anon, authenticated;
grant execute on function public.coin_gift_lookup(uuid, text) to service_role;
grant execute on function public.coin_gift(uuid, text, int, text) to service_role;
