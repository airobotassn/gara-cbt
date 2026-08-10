-- 코인 선물(coin_transfers) — 유저끼리 CARI 코인(user_currency.points)을 직접 옮긴다.
--
-- 왜 원장 테이블이 본체인가:
--   즉시 이체라 받는 사람은 아무 동작도 안 했는데 잔액이 늘어난다. 잔액은 결과값일 뿐이라
--   "왜 늘었지"에 답할 수 있는 행이 따로 없으면 사용자에게는 원인 불명의 숫자 변화다.
--   그래서 이체 자체보다 이 테이블이 기능의 본체다(gacha_log·shop_purchase 와 같은 자리).
--
-- 이 마이그레이션이 지키는 것:
--   ① 이체는 두 사람의 행을 잠근다 — **uuid 오름차순 고정**이 아니면 A→B / B→A 동시 실행이 데드락이다
--   ② 멱등은 unique(sender_id, client_nonce) — 즉시 이체라 재시도가 곧 두 번 보내기다
--   ③ 금액 > 0 — 음수를 통과시키면 '선물하기'가 남의 코인 뺏기가 된다
--   ④ 원장은 지우지 않는다 — 다른 테이블과 달리 cascade 가 아니라 set null + 닉네임 스냅샷
--   ⑤ 조회(코드→닉네임)에 쿼터를 건다 — 코드 공간이 100만이라 무제한이면 긁어서 수집할 수 있다
--
-- ⚠️ RLS 정책을 부여하지 않는다 = service role(엣지 함수) 전용. user_currency·payments 와 같은 관례다.

-- ---------- 잔액 음수 방지 ----------
-- user_currency 에는 지금까지 하한 제약이 아예 없었다. 이체가 생기면서 "차감은 됐는데 적립이 안 된"
-- 종류의 코드 버그가 곧 마이너스 잔액이 되므로 DB 가 마지막 방어선을 갖는다.
-- not valid = 기존 행은 검사하지 않고 앞으로의 쓰기만 막는다(운영 중 테이블을 통째로 스캔하지 않기 위해서).
alter table public.user_currency drop constraint if exists user_currency_points_nonneg;
alter table public.user_currency add constraint user_currency_points_nonneg check (points >= 0) not valid;

-- ---------- 원장 ----------
create table if not exists public.coin_transfers (
  id uuid primary key default gen_random_uuid(),

  -- ⚠️ **cascade 가 아니다.** 다른 테이블은 전부 on delete cascade 인데 원장만 set null 이다.
  --    cascade 로 두면 보낸 사람이 탈퇴하는 순간 받은 사람의 이력이 같이 사라져,
  --    "이 코인 어디서 왔지"에 영영 답할 수 없게 된다. 계정은 지워지되 거래 사실은 남아야 한다.
  sender_id    uuid references auth.users(id) on delete set null,
  recipient_id uuid references auth.users(id) on delete set null,
  -- 그래서 닉네임을 발생 시점 값으로 박아둔다. 나중에 조인해서 읽으려 하면 위 set null 이 무의미해진다.
  -- 닉네임은 변경 가능하므로 스냅샷이 현재 이름과 달라질 수 있는데, 이력에서는 그때 이름이 맞다.
  sender_name    text not null default '',
  recipient_name text not null default '',

  amount int not null check (amount > 0),
  client_nonce text not null,

  -- 발생 시점 잔액 — 분쟁·감사용(gacha_log 가 pity_before 를 남기는 것과 같은 이유).
  sender_balance_after    bigint not null,
  recipient_balance_after bigint not null,

  created_at timestamptz not null default now(),
  -- 받는 사람이 허브에서 확인한 시각. null = 아직 모름 → 선물 버튼에 뱃지가 뜬다.
  seen_at timestamptz,

  -- ⚠️ `sender_id <> recipient_id` 로 쓰면 안 된다 — 양쪽 다 탈퇴해 null 이 되는 순간
  --    `null is distinct from null` = false 라 CHECK 이 깨져서 위 ON DELETE SET NULL 자체가 실패한다.
  constraint coin_transfers_not_self
    check (sender_id is null or recipient_id is null or sender_id <> recipient_id),
  -- 멱등의 본체. 코드가 아니라 여기가 "두 번 보내기"를 막는다.
  constraint coin_transfers_nonce_uniq unique (sender_id, client_nonce)
);

alter table public.coin_transfers enable row level security;
-- 정책 없음 = service role 전용. 금액·상대 계정이 들어 있어 클라 직접 SELECT 금지.

create index if not exists coin_transfers_recipient_idx on public.coin_transfers (recipient_id, created_at desc);
create index if not exists coin_transfers_sender_idx    on public.coin_transfers (sender_id, created_at desc);
-- 허브 진입마다 부르는 '미확인 선물' 조회 전용 — 확인한 건은 인덱스에서 빠져 계속 작게 유지된다.
create index if not exists coin_transfers_unseen_idx on public.coin_transfers (recipient_id, created_at desc)
  where seen_at is null;

-- ---------- 조회 쿼터 ----------
-- 코드→닉네임 조회는 오타 방지에 필요하지만, 동시에 "이 코드가 실존하냐"를 확인해주는 오라클이다.
-- CARI+4자 = 32^4 ≈ 100만 조합이라 무제한이면 유효 코드와 닉네임을 통째로 수집할 수 있다.
-- 사람은 한 번에 코드 하나를 치므로 10분 30회면 넘칠 일이 없고, 스크래퍼에겐 사실상 불가능한 속도가 된다.
create table if not exists public.coin_gift_lookup_quota (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz not null default now(),
  n int not null default 0
);
alter table public.coin_gift_lookup_quota enable row level security;

-- ---------- 조회 ----------
create or replace function public.coin_gift_lookup(p_uid uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_window_min constant int := 10;
  c_max        constant int := 30;

  v_code text;
  v_n    int;
  v_id   uuid;
  v_name text;
begin
  -- 형식이 틀린 건 DB 를 안 보고 튕긴다 → 쿼터도 소모하지 않는다(오타로 한도가 닳으면 안 된다).
  v_code := upper(trim(coalesce(p_code, '')));
  if v_code !~ '^CARI[0-9A-Z]{4}$' then
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

  -- 탈퇴 계정은 받을 수 없다. 익명 계정은 애초에 referral_code 가 발급되지 않아(get-hub 가 익명을 먼저 컷)
  -- 여기서 따로 막을 필요가 없다 — 코드가 없으면 조회 자체가 성립하지 않는다.
  select id, coalesce(nullif(trim(display_name), ''), 'CARI')
    into v_id, v_name
    from profiles
   where referral_code = v_code and deactivated_at is null;

  if v_id is null      then return jsonb_build_object('error', 'not_found'); end if;
  if v_id = p_uid      then return jsonb_build_object('error', 'self'); end if;
  return jsonb_build_object('name', v_name);
end;
$$;

-- ---------- 이체 ----------
create or replace function public.coin_gift(p_uid uuid, p_code text, p_amount int, p_nonce text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- 스팸 가드. 금액 한도는 두지 않기로 했으므로(잔액이 곧 한도) 이건 돈이 아니라
  -- **받는 사람의 알림**을 지키는 장치다 — 1코인씩 연타하면 상대 선물함이 도배된다.
  c_cooldown_sec constant int := 10;

  v_row       coin_transfers%rowtype;
  v_code      text;
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

  -- (2) 코드 → 수신자.
  v_code := upper(trim(coalesce(p_code, '')));
  if v_code !~ '^CARI[0-9A-Z]{4}$' then raise exception 'recipient_not_found'; end if;
  select id, coalesce(nullif(trim(display_name), ''), 'CARI')
    into v_recipient, v_recipient_name
    from profiles where referral_code = v_code and deactivated_at is null;
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
$$;

-- 함수는 service role(엣지 함수)만 부른다 — p_uid 를 인자로 받으므로 클라가 직접 부를 수 있으면
-- 남의 uid 를 넣어 그 사람 지갑에서 돈을 빼낼 수 있다(ensure_referral_code 와 같은 처리).
revoke execute on function public.coin_gift_lookup(uuid, text)        from public, anon, authenticated;
revoke execute on function public.coin_gift(uuid, text, int, text)    from public, anon, authenticated;
grant  execute on function public.coin_gift_lookup(uuid, text)        to service_role;
grant  execute on function public.coin_gift(uuid, text, int, text)    to service_role;
