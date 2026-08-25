-- 회원탈퇴 제대로 만들기 (2026-08-25)
--
-- 여태 있던 것: /terms 맨 아래 버튼이 profiles.deactivated_at 을 찍는 것 하나뿐이었다.
--   랭킹 RPC 들이 그 값을 걸러서 보드에서만 사라지고, 로그인·플레이·결제는 그대로 됐다.
--   보관기간(90일) 뒤 파기도 함수만 있고 크론이 없어 아무도 안 불렀다.
--   실제로 탈퇴 상태로 미니게임을 계속 친 계정이 나왔고(Ran, 2026-08-24), 관리자 화면에는
--   그 사실이 표시되지도 않아 DB 를 직접 봐야 알 수 있었다.
--
-- ⛔ **파기 = 행 삭제가 아니라 익명화다.** 옛 purge 는 auth.users 를 DELETE 했는데,
--    payments·exam_attempts 가 auth.users 에 CASCADE 로 물려 있어서 켜는 순간
--    **결제 원장(전자상거래법 5년 보존)과 발급된 자격증이 같이 사라진다.**
--    /verify/:token 진위확인은 제3자(고용주)가 쓰는 것이라 본인 탈퇴로 없어지면 안 된다.
--    그래서 행은 그대로 두고 **사람을 알아볼 수 있는 값만** 비운다 —
--    개인정보보호법 제21조(목적 달성 시 지체 없이 파기)를 지키면서 CASCADE 를 건드릴 일이 없다.
--    결제 원장에는 이름·이메일 컬럼이 아예 없어서(user_id·주문번호·금액·상태뿐) 프로필만 비우면
--    그 자체로 익명 기록이 된다.
--
-- 남기는 것과 그 이유:
--   · payments / exam_attempts / 자격증 — 법정 보존 + 진위확인. user_id 는 남지만 그 프로필이 비어 있다.
--   · inquiries(1:1 문의) — 소비자 분쟁처리 기록(3년). 본문은 사용자가 쓴 것이라 손대지 않는다.
--   · coin_transfers 의 닉네임 스냅샷 — **상대방의** 거래 기록이다. 지우면 받은 사람이
--     "이 코인 왜 늘었지" 에 영영 못 답한다(그 표를 on delete set null + 스냅샷으로 만든 이유가 이것).
--   · payment_customer_key — PG 에 넘기는 무작위 식별자라 개인정보가 아니고, 환불·대사에 필요하다.

-- ── 1) 익명화 완료 표식 ────────────────────────────────────────
-- deactivated_at 은 그대로 둔다(랭킹 제외가 그 값을 본다). purged_at 은 "이미 파기했다" 는 뜻이고
-- 복구 불가 판정의 단일 출처다 — 지난 날짜를 다시 계산해서 판단하면 보관기간을 바꿀 때 말이 달라진다.
alter table profiles add column if not exists purged_at timestamptz;
create index if not exists profiles_purged_idx
  on profiles (purged_at) where purged_at is not null;

-- ── 2) 복구 ────────────────────────────────────────────────────
-- ⛔ 재로그인만으로 자동 복구하지 않는다(2026-08-25 결정). 탈퇴는 사람이 눌러서 하는 것이니
--    되돌리는 것도 눌러서 해야 한다 — 실수로 로그인했다가 조용히 되살아나면 탈퇴한 적이 없는 것과 같다.
--    (옛 AuthProvider 가 SIGNED_IN 에서 조용히 UPDATE 하려 했는데, 구글 복귀는 새 페이지 로드라
--     리스너가 INITIAL_SESSION 을 먼저 받아 그 UPDATE 가 아예 안 나갔다. 그래서 Ran 이 탈퇴 상태로 남았다.)
--
-- ⚠️ **닉네임 유니크가 이 함수의 유일한 함정이다.** profiles_nickname_key_uniq 는
--    `where nickname_set_at is not null and deactivated_at is null` 인 부분 인덱스라,
--    탈퇴하는 순간 그 닉네임이 남에게 풀린다. 그사이 누가 가져갔으면 deactivated_at 을 null 로
--    되돌리는 순간 23505 로 복구가 통째로 실패한다 → 그때는 **닉네임만 놓아주고 계정은 살린다**
--    (nickname_set_at 을 비우면 App.tsx 의 닉네임 게이트가 새로 받는다).
create or replace function public.restore_account()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  p   record;
begin
  if uid is null then raise exception 'unauthorized' using errcode = '28000'; end if;

  select deactivated_at, purged_at, display_name into p from profiles where id = uid;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  -- 이미 파기된 계정은 되돌릴 것이 없다(여기 닿을 일도 없다 — 구글 연결이 끊겨 로그인 자체가 안 된다).
  if p.purged_at is not null then raise exception 'purged' using errcode = 'P0002'; end if;
  if p.deactivated_at is null then return jsonb_build_object('ok', true, 'nicknameReset', false); end if;

  begin
    update profiles set deactivated_at = null where id = uid;
    return jsonb_build_object('ok', true, 'nicknameReset', false);
  exception when unique_violation then
    -- 탈퇴한 사이 닉네임을 남이 가져갔다. 계정을 살리는 쪽이 먼저다.
    update profiles
       set deactivated_at = null, nickname_set_at = null, nickname_changed_at = null
     where id = uid;
    return jsonb_build_object('ok', true, 'nicknameReset', true);
  end;
end $$;
revoke all on function public.restore_account() from public, anon;
grant execute on function public.restore_account() to authenticated;

-- 관리자용 복구(회원 상세의 '복구' 버튼). 남의 계정을 되돌리는 것이라 uid 를 받는다.
-- ⚠️ authenticated 에 주지 않는다 — 서비스 롤(admin 엣지 함수)만 부른다.
create or replace function public.admin_restore_account(p_uid uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare p record;
begin
  select deactivated_at, purged_at into p from profiles where id = p_uid;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if p.purged_at is not null then raise exception 'purged' using errcode = 'P0002'; end if;
  if p.deactivated_at is null then return jsonb_build_object('ok', true, 'nicknameReset', false); end if;
  begin
    update profiles set deactivated_at = null where id = p_uid;
    return jsonb_build_object('ok', true, 'nicknameReset', false);
  exception when unique_violation then
    update profiles
       set deactivated_at = null, nickname_set_at = null, nickname_changed_at = null
     where id = p_uid;
    return jsonb_build_object('ok', true, 'nicknameReset', true);
  end;
end $$;
revoke all on function public.admin_restore_account(uuid) from public, anon, authenticated;

-- ── 3) 보관기간 지난 계정 익명화 ───────────────────────────────
-- 옛 purge_deactivated_accounts(삭제형)를 대체한다. 이름을 바꾼 이유는 하는 일이 달라졌기 때문이다 —
-- 같은 이름으로 두면 다음 사람이 "purge 니까 지우겠지" 하고 읽는다.
create or replace function public.anonymize_deactivated_accounts(retention_days int default 90)
returns int language plpgsql security definer set search_path = public, auth as $$
declare
  n       int;
  victims uuid[];
begin
  -- ⚠️ 대상을 먼저 확정해서 배열로 든다. 단계마다 같은 where 절을 다시 쓰면 (a) 가 purged_at 을
  --    찍는 순간 (b)·(c) 의 대상이 0건이 되어 **인증 쪽이 통째로 안 지워진다**.
  select array_agg(id) into victims from profiles
   where deactivated_at is not null
     and purged_at is null
     and deactivated_at < now() - make_interval(days => retention_days);
  if victims is null then return 0; end if;

  -- (a) 프로필에서 사람을 알아볼 수 있는 값 전부.
  --     deactivated_at 은 남긴다 — 랭킹 제외가 그 값을 보고, 언제 탈퇴했는지는 분쟁 대응에 필요하다.
  update profiles p
     set display_name        = null,
         avatar_url          = null,
         country_code        = null,
         region_code         = null,
         school_id           = null,
         age_band            = null,
         nickname_set_at     = null,
         nickname_changed_at = null,
         region_locked_at    = null,
         region_changed_at   = null,
         referral_code       = null,  -- 남이 이 코드를 다시 쓸 수 있게 풀어준다
         referred_by         = null,  -- 누구 소개로 왔는지 = 관계 정보
         suspended_reason    = null,
         purged_at           = now()
   where p.id = any(victims);
  get diagnostics n = row_count;

  -- (b) 인증 쪽. auth.users 행을 지우지 않는 이유는 이 파일 머리 참고(CASCADE).
  --     이메일은 unique 라 비울 수 없어 되돌릴 수 없는 값으로 덮는다.
  --     raw_user_meta_data 에 구글 실명·프로필 사진·이메일이 들어 있다 → 통째로 비운다.
  --     raw_app_meta_data 는 provider 이름뿐이라 GoTrue 가 쓰도록 남긴다.
  update auth.users u
     set email              = 'deleted-' || u.id || '@invalid',
         email_change       = '',
         phone              = null,
         raw_user_meta_data = '{}'::jsonb
   where u.id = any(victims);

  -- (c) 구글 연결 끊기 — 이게 실질적인 '파기' 다. 같은 구글 계정으로 다시 로그인하면
  --     이 uid 와 이어지지 않고 **새 계정**이 만들어진다(옛 기록에 닿을 길이 사라진다).
  delete from auth.identities i where i.user_id = any(victims);
  -- 살아 있는 세션도 끊는다 — 안 끊으면 이미 로그인해 둔 브라우저가 파기 후에도 돌아다닌다.
  delete from auth.sessions s where s.user_id = any(victims);

  return n;
end $$;
revoke all on function public.anonymize_deactivated_accounts(int) from public, anon, authenticated;

-- 삭제형은 위험해서 없앤다(켜는 순간 결제 원장이 날아간다). 되살리려면 이 파일 머리를 다시 읽을 것.
drop function if exists public.purge_deactivated_accounts(int);

-- ── 4) 크론 ────────────────────────────────────────────────────
-- 매일 KST 03:30(UTC 18:30). **함수만 있고 부르는 사람이 없던 것이 여태 문제였다** —
-- 옛 purge 는 2026-07 부터 존재했지만 한 번도 실행된 적이 없어서 화면의 "90일 후 파기" 가 거짓말이었다.
-- (arena-buckets 와 같은 형태로 감싼다 — pg_cron 이 없는 환경에서 마이그레이션이 통째로 죽지 않게.)
do $do$
begin
  create extension if not exists pg_cron;
  perform cron.unschedule('purge-deactivated') from cron.job where jobname = 'purge-deactivated';
  perform cron.schedule('purge-deactivated', '30 18 * * *', 'select public.anonymize_deactivated_accounts()');
exception when others then
  raise notice 'pg_cron 미설정 — anonymize_deactivated_accounts() 를 수동/외부 스케줄러로 돌릴 것 (%)', sqlerrm;
end;
$do$;
