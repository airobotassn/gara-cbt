-- ============================================================
-- 채팅 방(room) — 전세계 1개 + 나라별 1개
--   · chat_messages.room: 'global' 또는 ISO2 국가코드(대문자). 기존 행은 default 로 전부 'global'.
--   · 조회가 항상 방 단위로 좁혀지므로 커서 인덱스를 (room, id) 로 재작성하고 옛 (id) 는 드롭한다.
--   · chat_post_atomic 에 p_room 추가 — 인자 목록이 바뀌면 create or replace 가 옛 함수를 남긴 채
--     오버로드를 만들어 호출이 모호해진다. 그래서 drop → create.
--   · ⚠️ 레이트리밋·중복·IP 바닥선 가드는 방을 보지 않는다(전역 유지). 방마다 상한이 리셋되면
--     방을 옮겨다니며 도배할 수 있다.
--   멱등(재실행 안전) — schema.sql 에 동일 DDL 존재.
-- ============================================================

alter table chat_messages add column if not exists room text not null default 'global';

drop index if exists chat_messages_cursor_idx;
create index if not exists chat_messages_room_cursor_idx
  on chat_messages (room, id) where deleted_at is null;

drop function if exists public.chat_post_atomic(uuid,text,text,text,text,boolean,text,text);

create or replace function public.chat_post_atomic(
  p_user uuid,
  p_ip_hash text,
  p_body text,
  p_content_hash text,
  p_mod_status text,
  p_is_anon boolean,
  p_display_name text,
  p_lang text,
  p_room text
) returns table(id bigint, created_at timestamptz, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_min_interval int := case when p_is_anon then 5 else 3 end;
  v_window_cap   int := case when p_is_anon then 5 else 10 end;
  v_room text := coalesce(nullif(p_room, ''), 'global');
  v_last_at timestamptz;
  v_window_count int;
  v_dup_count int;
  v_ip_count int;
begin
  -- 동일 유저/동일 IP 요청 직렬화 (단일 프로세스 pglite 테스트로는 동시성 자체는 증명 불가 — 배포 환경에서만 검증 가능).
  perform pg_advisory_xact_lock(hashtext(coalesce(p_user::text, '')));
  perform pg_advisory_xact_lock(hashtext(coalesce(p_ip_hash, '')));

  if p_user is not null then
    -- 아래 세 가드는 모두 방을 무시한다(계정 단위 전역) — 방 이동으로 상한이 리셋되면 안 된다.
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
    insert into chat_messages(user_id, ip_hash, display_name, is_anon, body, lang, mod_status, content_hash, room)
    values (p_user, p_ip_hash, p_display_name, p_is_anon, p_body, p_lang, p_mod_status, p_content_hash, v_room)
    returning chat_messages.id, chat_messages.created_at, chat_messages.updated_at;
end;
$$;

revoke execute on function public.chat_post_atomic(uuid,text,text,text,text,boolean,text,text,text) from public, anon, authenticated;
grant execute on function public.chat_post_atomic(uuid,text,text,text,text,boolean,text,text,text) to service_role;
