-- 친구 초대(2026-08-04 허브 시안) — 계정별 초대코드 발급.
--  · 코드는 서버 권위다(클라가 만들지 않는다). profiles.referral_code 에 1회 발급 후 고정.
--  · 형식 'CARI' + 4자 = 혼동문자(0/O/1/I) 뺀 32자 알파벳 → 32^4 ≈ 105만 조합. 충돌 시 재시도.
--  · ensure_referral_code(uid): 있으면 그대로 반환, 없으면 발급. get-hub 가 하이드레이트 때 호출한다.
--    SECURITY DEFINER + service_role 전용(클라 직접 호출 금지 — 남의 uid 로 발급을 유발할 수 있으므로).
--  ⚠️ 여기까지가 "코드 발급·표시"다. **초대 성립(가입 귀속 → activity_ledger.referral 적립)은 아직 없다** —
--     피초대자가 코드를 입력하는 경로와 부계정 방지가 정해지면 그때 붙인다.
--  멱등(재실행 안전). schema.sql 의 동명 블록과 DDL 동일.

alter table profiles add column if not exists referral_code text;
create unique index if not exists profiles_referral_code_idx
  on profiles (referral_code) where referral_code is not null;

create or replace function public.ensure_referral_code(p_uid uuid) returns text
  language plpgsql security definer set search_path = public as $$
declare
  v_code text;
  v_alpha text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  i int;
begin
  select referral_code into v_code from profiles where id = p_uid;
  if v_code is not null then
    return v_code;
  end if;

  for _try in 1..12 loop
    v_code := 'CARI';
    for i in 1..4 loop
      v_code := v_code || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1);
    end loop;
    begin
      update profiles set referral_code = v_code where id = p_uid and referral_code is null;
      if found then
        return v_code;
      end if;
      select referral_code into v_code from profiles where id = p_uid;
      if v_code is not null then
        return v_code;
      end if;
    exception when unique_violation then
      null;
    end;
  end loop;
  return null;
end
$$;

revoke execute on function public.ensure_referral_code(uuid) from public, anon, authenticated;
grant execute on function public.ensure_referral_code(uuid) to service_role;
