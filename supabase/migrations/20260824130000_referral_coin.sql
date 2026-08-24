-- 친구 초대 보상 = 코인 50, 초대한 사람과 코드를 쓴 사람 **양쪽 다** (2026-08-24 결정).
--
-- 무엇이 바뀌나
--   · 옛 보상은 **초대자에게만 시즌 점수 +5**(activity_ledger kind='referral') 였다. 지갑이 통째로
--     바뀐다 — 랭킹 점수가 아니라 상점 코인이다. 옛 원장 행은 건드리지 않는다(이미 받은 점수를
--     빼앗는 게 아니라, 앞으로 안 주는 것이다).
--   · 상한 없음(지시) — 초대할수록 초대자는 계속 50코인을 받는다. 피초대자 쪽은 계정당 1회다
--     (referred_by 는 비어있을 때만 박힌다) — 그게 이 기능의 유일한 자연 상한이다.
--
-- ⛔ 귀속과 지급을 한 트랜잭션으로 묶는 게 이 함수의 존재 이유다.
--    예전엔 edge fn 이 `profiles.referred_by` 를 먼저 박고 보상을 **그 다음에** 따로 넣었다.
--    보상이 실패하면 귀속은 이미 끝나 있어서, 그 사람은 **영영 다시 등록할 수 없고 코인도 못 받는다**
--    (되돌릴 방법이 없다 — referred_by 는 1회용이다). 점수일 때는 하루 캡에 걸려 못 받는 게 정상 경로라
--    그냥 넘겼지만, 코인은 상한이 없어 "못 받는 경우 = 사고" 뿐이다.
create or replace function public.redeem_referral(p_uid uuid, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  -- 양쪽에 같은 금액. 화면 표시용 사본 = `src/pages/Hub.tsx` 의 REFERRAL_COIN — 고치면 같이 고칠 것.
  c_coin constant int := 50;
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
