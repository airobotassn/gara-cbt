-- 채팅 제재 사다리 (2026-09-10 지시)
--
-- 옛 상태: `profiles.suspended_until`·`suspended_reason` 칸과 `suspendUser` 액션이 2026-08-11 재편 때
--   만들어졌는데 **양쪽이 다 끊겨 있었다** — 거는 버튼이 화면에 없었고(src 전체 호출 0건),
--   읽는 곳도 0곳이었다(정지를 걸어도 아무것도 안 막혔다). 그래서 실사용 0건.
--
-- 지금: 관리자가 신고 큐에서 [제재] 를 한 번 누르면 **기간은 사다리가 정한다**(게임사 방식).
--   1차 1일 · 2차 3일 · 3차 7일 · 4차 30일 · 5차 90일 · 6차 영구.
--   90일 무위반이면 한 칸씩 내려간다.
--
-- ⛔ **사다리의 단일 출처는 이 파일의 `chat_sanction_days()` 하나다.** 화면이 "다음 위반 시 30일" 을
--    보여주려면 그 숫자가 필요한데, 프론트에 표를 한 벌 더 두면 sync pair 가 생긴다 — 서버가
--    `nextDays` 로 **계산해서 내려주고** 화면은 받아 적기만 한다.
--
-- ⛔ **본문(메시지 원문)을 담지 않는다.** 완전삭제(chatPurge)의 존재 이유가 "그 본문이 어딘가 남아
--    있는 것 자체가 문제(개인정보·불법물)" 라서, 여기 복사해두면 지운 게 아니게 되고 개인정보 파기
--    요청이 오면 이 표까지 뒤져야 한다. 이의 제기 대응에는 `사유 + 차수 + 시각` 이면 충분하다.
--    그래서 `message_id` 도 `on delete set null` 이다 — 글이 물리 삭제돼도 **제재 사실은 남는다**
--    (옛 구조의 구멍이 이거였다: 제일 악질인 완전삭제 케이스가 흔적이 0이었다).
--
-- ⚠️ 영구정지는 `until = 9999-12-31` 로 넣는다. 그래야 검사가 `suspended_until > now()` **한 줄로
--    통일**되고 영구든 3일이든 같은 코드가 막는다(화면만 연도 9999 를 '영구' 로 읽는다).
--
-- ⚠️ 사유는 **신고 사유 코드 6개를 그대로 재사용**한다(`ChatBoard.tsx` 의 `REPORT_REASONS`).
--    아레나 채팅은 6개국어라 관리자가 자유 텍스트로 "욕설 심함" 이라 적으면 베트남 사용자가 그
--    한국어를 그대로 본다. 코드로 두면 사전(`chat.reason*`)이 6개국어를 이미 갖고 있다.
--    관리자가 남기고 싶은 자세한 사정은 `note`(내부용, 사용자에게 안 나감)에 적는다.

create table if not exists public.chat_sanctions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  -- 계기가 된 글. 완전삭제되면 null 이 된다(위 머리말) — null 이 정상이다.
  message_id  bigint references public.chat_messages(id) on delete set null,
  reason      text not null check (reason in ('spam','abuse','sexual','flood','privacy','other')),
  nth         int  not null check (nth >= 1),          -- 그때의 유효 차수(감면 반영 후)
  days        int  check (days is null or days > 0),   -- null = 영구
  until       timestamptz not null,                    -- 그때 계산된 만료(영구는 9999-12-31)
  note        text,                                    -- 관리자 내부 메모 — 사용자에게 안 나간다
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists chat_sanctions_user_idx on public.chat_sanctions (user_id, created_at desc);

-- 함수 전용 표다(RLS 정책을 주지 않는다 = service role 만 접근). 관리자 화면은 `admin` 함수를 통해서만 본다.
alter table public.chat_sanctions enable row level security;
revoke all on public.chat_sanctions from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 사다리 — 차수 → 정지 일수. null = 영구.
--   ⛔ 이 표를 다른 곳에 복사하지 말 것(위 머리말). 값을 바꾸면 여기만 바꾼다.
--   ⚠️ p_nth 는 항상 1 이상으로 불린다(호출부가 보장). 0 이하는 정의가 없어 null 로 떨어진다.
-- ─────────────────────────────────────────────────────────────
create or replace function public.chat_sanction_days(p_nth int)
returns int language sql immutable as $$
  select case
    when p_nth = 1 then 1
    when p_nth = 2 then 3
    when p_nth = 3 then 7
    when p_nth = 4 then 30
    when p_nth = 5 then 90
    else null            -- 6차 이상 = 영구
  end
$$;

-- 유효 차수 = 총 제재 수 − 감면. 감면 = 마지막 제재로부터 90일이 지날 때마다 한 칸.
--   ⚠️ 마지막 제재 **하나**를 기준으로 잰다. 제재가 뜸해지면 그만큼 내려가고, 다시 걸리면
--      그 시점부터 90일을 새로 센다.
--   ⚠️ 제재가 하나도 없으면 max()가 null 이라 감면 0 → 0 을 돌려준다(다음 제재가 1차).
create or replace function public.chat_sanction_nth(p_user uuid)
returns int language sql stable as $$
  select greatest(
    0,
    count(*)::int
      - coalesce(floor(extract(epoch from (now() - max(created_at))) / 86400 / 90)::int, 0)
  )
  from public.chat_sanctions
  where user_id = p_user
$$;

-- ─────────────────────────────────────────────────────────────
-- 제재 걸기 — 차수를 세고, 사다리로 기간을 정하고, 기록 + profiles 갱신을 한 트랜잭션에서.
--   ⚠️ advisory lock 을 잡는다 — 관리자가 [제재] 를 빠르게 두 번 누르면 둘 다 같은 차수를 읽어
--      "3차가 두 개" 가 된다(그리고 두 번째가 첫 번째 정지를 덮는다).
-- ─────────────────────────────────────────────────────────────
create or replace function public.chat_sanction_apply(
  p_user       uuid,
  p_message_id bigint,
  p_reason     text,
  p_note       text,
  p_by         uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_nth int; v_days int; v_until timestamptz; v_id uuid;
begin
  if p_user is null then raise exception 'user_required'; end if;
  if p_reason is null or p_reason not in ('spam','abuse','sexual','flood','privacy','other') then
    raise exception 'bad_reason';
  end if;

  perform pg_advisory_xact_lock(hashtext('chat_sanction:' || p_user::text));

  v_nth   := public.chat_sanction_nth(p_user) + 1;
  v_days  := public.chat_sanction_days(v_nth);
  v_until := case when v_days is null then '9999-12-31T00:00:00Z'::timestamptz
                  else now() + make_interval(days => v_days) end;

  insert into public.chat_sanctions (user_id, message_id, reason, nth, days, until, note, created_by)
  values (p_user, p_message_id, p_reason, v_nth, v_days, v_until,
          nullif(btrim(coalesce(p_note, '')), ''), p_by)
  returning id into v_id;

  update public.profiles
     set suspended_until = v_until, suspended_reason = p_reason
   where id = p_user;

  return jsonb_build_object(
    'id', v_id, 'nth', v_nth, 'days', v_days, 'until', v_until,
    'permanent', v_days is null,
    'nextDays', public.chat_sanction_days(v_nth + 1)
  );
end $$;

-- 정지 상태 — 채팅 입력창 안내에 쓴다(`chat-post` 가 막을 때 같이 내려준다).
--   ⚠️ `nextDays` 를 여기서 계산해 내려주는 이유는 위 머리말(사다리 단일 출처).
create or replace function public.chat_sanction_status(p_user uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_until timestamptz; v_reason text; v_nth int; v_last_reason text;
begin
  select suspended_until, suspended_reason into v_until, v_reason
    from public.profiles where id = p_user;

  if v_until is null or v_until <= now() then
    return jsonb_build_object('suspended', false);
  end if;

  select nth, reason into v_nth, v_last_reason
    from public.chat_sanctions where user_id = p_user
    order by created_at desc limit 1;

  return jsonb_build_object(
    'suspended', true,
    'until', v_until,
    -- 9999 는 영구 sentinel(위 머리말). 9000 으로 재는 건 여유를 둔 것뿐이다.
    'permanent', v_until > '9000-01-01T00:00:00Z'::timestamptz,
    'nth', coalesce(v_nth, 0),
    'reason', coalesce(v_last_reason, v_reason),
    'nextDays', public.chat_sanction_days(coalesce(v_nth, 0) + 1)
  );
end $$;

-- 제재 취소 — **오판 정정용**이다. 마지막 제재 기록을 지우고 정지를 푼다.
--   ⚠️ '기간만 줄이기' 를 만들지 않았다. 관리자가 고를 게 없는 게 이 설계의 요점이고(기간은 사다리가
--      정한다), 취소의 유일한 이유는 "잘못 걸었다" 라서 차수까지 같이 되돌리는 게 맞다.
create or replace function public.chat_sanction_revoke(p_user uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('chat_sanction:' || p_user::text));

  select id into v_id from public.chat_sanctions
   where user_id = p_user order by created_at desc limit 1;
  if v_id is not null then
    delete from public.chat_sanctions where id = v_id;
  end if;

  update public.profiles set suspended_until = null, suspended_reason = null where id = p_user;
  return jsonb_build_object('ok', true, 'removed', v_id is not null);
end $$;

revoke execute on function public.chat_sanction_apply(uuid, bigint, text, text, uuid) from public, anon, authenticated;
revoke execute on function public.chat_sanction_status(uuid) from public, anon, authenticated;
revoke execute on function public.chat_sanction_revoke(uuid) from public, anon, authenticated;
revoke execute on function public.chat_sanction_nth(uuid) from public, anon, authenticated;
