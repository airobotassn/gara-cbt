-- ============================================================
-- 유사채팅(pseudo-chat) board — chat_messages / chat_reports / chat_incidents
--   · chat_messages: 커서 기반 조회(id) 전용. updated_at 인덱스 없음 — reconcile 은 PK 로 처리.
--   · chat_reports: (message_id, reporter_id) 1인 1신고.
--   · chat_incidents: 모더레이션 장애(모드 API 불가 등) 기록.
--   · RLS: 전부 활성화 + 클라 정책 없음 → service role(Edge Function)만 접근.
--   · chat_post_atomic: rate-limit/dup/ip-floor 가드를 원자적으로 수행하는 유일한 삽입 경로.
--   멱등(재실행 안전) — schema.sql 에 동일 DDL 존재.
-- ============================================================

create table if not exists chat_messages (
  id bigserial primary key,
  user_id uuid,
  ip_hash text,
  display_name text,
  is_anon boolean not null default false,
  body text not null,
  lang text,
  mod_status text not null default 'ok',
  content_hash text,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_messages_cursor_idx
  on chat_messages (id) where deleted_at is null;
create index if not exists chat_messages_rate_idx
  on chat_messages (user_id, created_at desc);
create index if not exists chat_messages_dup_idx
  on chat_messages (user_id, content_hash, created_at desc);
create index if not exists chat_messages_iprate_idx
  on chat_messages (ip_hash, created_at desc);

create table if not exists chat_reports (
  id uuid primary key default gen_random_uuid(),
  message_id bigint references chat_messages(id) on delete set null,
  reporter_id uuid,
  reason text,
  lang text,
  status text not null default 'open',
  created_at timestamptz not null default now()
);

create unique index if not exists chat_reports_once_idx
  on chat_reports (message_id, reporter_id);

create table if not exists chat_incidents (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'mod_unavailable',
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

alter table chat_messages  enable row level security;
alter table chat_reports   enable row level security;
alter table chat_incidents enable row level security;
-- chat_messages / chat_reports / chat_incidents: 클라 정책 없음 → service role(Edge Function)만 접근.

-- chat_post_atomic — 원자적 채팅 삽입: 최소 간격 / 60초 창 상한 / 중복 / IP 바닥선 가드.
--   advisory xact lock(user, ip) 으로 동시 요청 직렬화 후 가드 평가 → insert.
--   raise exception '<code>' (기본 errcode) 로 supabase-js 가 error.message 로 코드를 그대로 받는다.
create or replace function public.chat_post_atomic(
  p_user uuid,
  p_ip_hash text,
  p_body text,
  p_content_hash text,
  p_mod_status text,
  p_is_anon boolean,
  p_display_name text,
  p_lang text
) returns table(id bigint, created_at timestamptz, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_min_interval int := case when p_is_anon then 5 else 3 end;
  v_window_cap   int := case when p_is_anon then 5 else 10 end;
  v_last_at timestamptz;
  v_window_count int;
  v_dup_count int;
  v_ip_count int;
begin
  -- 동일 유저/동일 IP 요청 직렬화 (단일 프로세스 pglite 테스트로는 동시성 자체는 증명 불가 — 배포 환경에서만 검증 가능).
  perform pg_advisory_xact_lock(hashtext(coalesce(p_user::text, '')));
  perform pg_advisory_xact_lock(hashtext(coalesce(p_ip_hash, '')));

  if p_user is not null then
    select max(m.created_at) into v_last_at
    from chat_messages m
    where m.user_id = p_user;

    if v_last_at is not null and v_last_at > now() - make_interval(secs => v_min_interval) then
      raise exception 'too_fast';
    end if;

    select count(*) into v_window_count
    from chat_messages m
    where m.user_id = p_user
      and m.created_at > now() - interval '60 seconds';

    if v_window_count >= v_window_cap then
      raise exception 'rate_limited';
    end if;

    if p_content_hash is not null then
      select count(*) into v_dup_count
      from chat_messages m
      where m.user_id = p_user
        and m.content_hash = p_content_hash
        and m.created_at > now() - interval '60 seconds';

      if v_dup_count > 0 then
        raise exception 'duplicate';
      end if;
    end if;
  end if;

  if p_ip_hash is not null then
    select count(*) into v_ip_count
    from chat_messages m
    where m.ip_hash = p_ip_hash
      and m.created_at > now() - interval '60 seconds';

    if v_ip_count > 30 then
      raise exception 'ip_floor';
    end if;
  end if;

  return query
    insert into chat_messages(user_id, ip_hash, display_name, is_anon, body, lang, mod_status, content_hash)
    values (p_user, p_ip_hash, p_display_name, p_is_anon, p_body, p_lang, p_mod_status, p_content_hash)
    returning chat_messages.id, chat_messages.created_at, chat_messages.updated_at;
end;
$$;

revoke execute on function public.chat_post_atomic(uuid,text,text,text,text,boolean,text,text) from public, anon, authenticated;
grant execute on function public.chat_post_atomic(uuid,text,text,text,text,boolean,text,text) to service_role;
