-- 의견함(feedbacks) — FAB 패널의 빨간 '의견 보내기' 로 들어오는 수집함.
--
-- ⛔ 1:1 문의(inquiries)와 **다른 물건**이다. 한 표에 합치지 말 것:
--    · 문의는 로그인한 회원이 쓰고 관리자가 **답변**한다(status/answer/answered_at 이 그래서 있다).
--    · 의견은 **비로그인 누구나** 쓰고 답변 경로가 없다 — 관리자가 읽고 엑셀로 뽑는 게 전부다.
--    그래서 소속·이름을 계정에서 끌어오지 않고 **본인이 적는다**(계정 없는 검수자도 누가 썼는지 남긴다).
--
-- ⚠️ RLS 정책을 하나도 주지 않는다 = service role(엣지 함수) 전용.
--    비로그인이 쓰는 표라 anon 에게 insert 를 열면 그 순간 가드 없는 무제한 삽입 경로가 된다.
--    (chat_messages 가 같은 이유로 정책 없이 chat_post_atomic 한 길만 두고 있다.)

create table if not exists public.feedbacks (
  id uuid primary key default gen_random_uuid(),
  -- 로그인 상태로 썼으면 계정도 같이 남긴다. **cascade 가 아니라 set null** —
  -- 탈퇴가 남의 의견까지 지우면 "이 지적 누가 했지"에 영영 못 답한다(coin_transfers 와 같은 판단).
  user_id uuid references auth.users(id) on delete set null,
  org  text not null,
  name text not null,
  path text not null,
  body text not null,
  -- 도배 가드용. **원본 IP 가 아니라** 날짜 소금을 섞은 해시다(_shared/chat.ts 의 resolveIpHash 와 같은 값).
  ip_hash text,
  created_at timestamptz not null default now(),

  -- ⚠️ '비었나' 와 '너무 긴가' 를 **따로** 본다.
  --    한 줄로 `length(btrim(x)) between 1 and N` 을 쓰면 안 된다 — 기본 btrim 은 **공백만** 털어서
  --    줄바꿈·탭만 든 값이 length 1 로 통과한다(t-feedback 이 실제로 잡아낸 구멍이다).
  --    여기서는 POSIX 문자군 [[:space:]] 로 모든 공백을 걷어 "글자가 하나라도 있나"를 보고,
  --    길이는 저장값(엣지 함수가 이미 trim 한 값) 그대로 잰다 = 서버 LIMITS 와 같은 뜻.
  constraint feedbacks_not_blank check (
    regexp_replace(org,  '[[:space:]]', '', 'g') <> '' and
    regexp_replace(name, '[[:space:]]', '', 'g') <> '' and
    regexp_replace(path, '[[:space:]]', '', 'g') <> '' and
    regexp_replace(body, '[[:space:]]', '', 'g') <> ''
  ),
  -- 서버 LIMITS(supabase/functions/feedback/index.ts)·화면 MAX(src/pages/Feedback.tsx)와 한 벌이다.
  constraint feedbacks_max_len check (
    length(org) <= 60 and length(name) <= 40 and length(path) <= 200 and length(body) <= 4000
  )
);

create index if not exists feedbacks_recent_idx on public.feedbacks (created_at desc);
create index if not exists feedbacks_iprate_idx on public.feedbacks (ip_hash, created_at desc);

alter table public.feedbacks enable row level security;

-- ─────────────────────────────────────────────────────────────
-- 삽입 경로는 이 함수 하나뿐이다(chat_post_atomic 과 같은 구조).
--   가드를 엣지 함수 쪽 select→insert 로 짜면 동시 요청 두 개가 나란히 "아직 안 넘었다"를 보고
--   둘 다 통과한다. advisory lock 안에서 세고 넣어야 그게 안 생긴다.
--
-- ⚠️ 상한은 넉넉하다(10분 20건). 검수자가 화면을 훑으며 연달아 적는 게 정상 사용이라
--    빡빡하게 잡으면 **사람이 먼저 막힌다**. 봇을 막는 바닥선이지 정교한 방어가 아니다.
-- ⚠️ 같은 내용 재전송은 거절이 아니라 **원래 id 를 그대로 돌려준다** — 새로고침·더블클릭·네트워크
--    재시도에서 같은 의견이 두 줄로 쌓이면 관리자가 세는 숫자가 틀어진다.
-- ⚠️ 앞뒤 공백 털기는 여기서 **다시** 한다. 엣지 함수가 이미 털지만, 저장 직전 마지막 관문이
--    털지 않으면 '  홍길동' 과 '홍길동' 이 다른 사람으로 쌓인다.
-- ─────────────────────────────────────────────────────────────
create or replace function public.feedback_post(
  p_user    uuid,
  p_ip_hash text,
  p_org     text,
  p_name    text,
  p_path    text,
  p_body    text
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id  uuid;
  v_cnt int;
  -- 앞뒤의 모든 공백(줄바꿈·탭 포함)을 턴 값. 아래 중복 판정도 이 값으로 해야
  -- 줄바꿈 하나 차이로 같은 의견이 새 줄로 쌓이지 않는다.
  v_org  text := regexp_replace(p_org,  '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_name text := regexp_replace(p_name, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_path text := regexp_replace(p_path, '^[[:space:]]+|[[:space:]]+$', '', 'g');
  v_body text := regexp_replace(p_body, '^[[:space:]]+|[[:space:]]+$', '', 'g');
begin
  perform pg_advisory_xact_lock(hashtext(coalesce(p_ip_hash, '')));

  if p_ip_hash is not null then
    -- (1) 같은 내용 재전송 → 원래 것을 돌려주고 끝(멱등).
    select f.id into v_id
      from feedbacks f
     where f.ip_hash = p_ip_hash
       and f.body = v_body
       and f.created_at > now() - interval '1 day'
     limit 1;
    if v_id is not null then
      return v_id;
    end if;

    -- (2) 도배 바닥선.
    select count(*) into v_cnt
      from feedbacks f
     where f.ip_hash = p_ip_hash
       and f.created_at > now() - interval '10 minutes';
    if v_cnt >= 20 then
      raise exception 'too_many';
    end if;
  end if;

  insert into feedbacks (user_id, ip_hash, org, name, path, body)
  values (p_user, p_ip_hash, v_org, v_name, v_path, v_body)
  returning id into v_id;
  return v_id;
end;
$$;

-- 사용자 토큰으로는 못 부른다. 엣지 함수(service role)만 쓴다.
revoke all on function public.feedback_post(uuid, text, text, text, text, text) from public;
revoke all on function public.feedback_post(uuid, text, text, text, text, text) from anon;
revoke all on function public.feedback_post(uuid, text, text, text, text, text) from authenticated;
