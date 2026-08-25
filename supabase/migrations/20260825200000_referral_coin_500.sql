-- 친구 초대 보상 코인 50 → 500 (2026-08-25 지시). 규칙은 그대로다 — 초대한 쪽·코드를 쓴 쪽 양쪽 다,
-- 초대자 쪽 상한 없음, 코드를 쓰는 쪽은 계정당 1회.
--
-- ⚠️ 이미 지급된 옛 50코인은 건드리지 않는다(소급 지급도, 회수도 없다). 앞으로 나가는 금액만 바뀐다.
-- ⚠️ 화면 표시용 사본 = `src/pages/Hub.tsx` 의 REFERRAL_COIN — 같이 바꿨다.
-- ⚠️ 부계정 파밍의 대가가 10배가 됐다(20개면 10,000코인 = 배경 스킨 33개). 문제가 되면 상한을
--    얹을 것 — `profiles.referred_by` 를 세면 몇 명을 초대했는지 나온다.
--
-- 함수 본문은 20260824130000_referral_coin.sql 그대로고 c_coin 값 하나만 다르다.
create or replace function public.redeem_referral(p_uid uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- 양쪽에 같은 금액. 화면 표시용 사본 = `src/pages/Hub.tsx` 의 REFERRAL_COIN — 고치면 같이 고칠 것.
  c_coin constant int := 500;
  v_inviter uuid;
  v_name    text;
  v_lo      uuid;
  v_hi      uuid;
  v_balance bigint;
begin
  if p_uid is null or coalesce(p_code, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- (1) 이미 등록했으면 여기서 끝. 되돌릴 수 없다.
  perform 1 from profiles where id = p_uid and referred_by is not null;
  if found then
    return jsonb_build_object('ok', false, 'error', 'already');
  end if;

  -- (2) 코드 → 초대자. 없는 코드와 자기 코드는 구분해서 알려준다(모달은 다시 열 수 있으니까).
  select id, display_name into v_inviter, v_name from profiles where referral_code = p_code;
  if v_inviter is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_inviter = p_uid then
    return jsonb_build_object('ok', false, 'error', 'self');
  end if;

  -- (3) 귀속 — 비어있는 행만 갱신한다. 두 번 눌려도 한 번만 성립한다.
  update profiles set referred_by = v_inviter where id = p_uid and referred_by is null;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'already');
  end if;

  -- (4) 지급 — 여기서 처음으로 **두 사람의 지갑**을 건드린다. 그래서 coin_gift 와 같은 규칙이
  --     그대로 적용된다: uuid 오름차순으로 잠근다. A 가 B 코드를, B 가 A 코드를 동시에 등록하면
  --     순서가 엇갈려 데드락이 난다(맞물린 초대를 막는 제약이 없다 — 서로 초대는 가능하다).
  v_lo := least(p_uid, v_inviter);
  v_hi := greatest(p_uid, v_inviter);
  insert into user_currency (user_id, points) values (v_lo, c_coin)
    on conflict (user_id) do update
      set points = user_currency.points + c_coin, updated_at = now();
  insert into user_currency (user_id, points) values (v_hi, c_coin)
    on conflict (user_id) do update
      set points = user_currency.points + c_coin, updated_at = now();

  select points into v_balance from user_currency where user_id = p_uid;

  return jsonb_build_object(
    'ok', true,
    'coin', c_coin,
    'balance', v_balance,
    'inviterId', v_inviter,
    'inviterName', v_name
  );
end
$$;

-- 실행권한: public/anon/authenticated 회수 → service_role(Edge Function) 만.
--   ⚠️ 열어두면 로그인한 사람이 p_uid 에 남의 id 를 넣어 남의 귀속을 대신 박을 수 있다.
revoke all on function public.redeem_referral(uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_referral(uuid, text) to service_role;
