-- 2026-09-07 · 익명 채팅 폐지 ①/② — 새 chat_post_atomic(8인자)을 옛 것 옆에 만든다 (2026-09-07 지시)
--
--   익명 채팅을 안 하기로 했다. 여태는 스위치(`CHAT_REQUIRE_LOGIN`, 기본 true)가 익명 글을 막고 있었고,
--   끌 수 있는 스위치라 "익명 글이 들어왔을 때 익명으로 지켜주는" 분기 여섯이 딸려 있어야 했다:
--     ① 이름을 '익명#4b8d' 로 치환   ② 응답에서 user_id 은닉   ③ 아바타·국기 미부착
--     ④ 아바타 눌러도 카드 안 열림    ⑤ 말풍선 색 시드 고정    ⑥ 도배 최소간격 5초(실명 3초)
--   스위치를 없애면(= 게스트는 영영 못 씀) 이 여섯과 `chat_messages.is_anon` 칸이 통째로 죽는다.
--   실측 95건 전부 false 라 잃는 데이터도 없다.
--
--   ⛔ **이 파일은 아직 아무것도 지우지 않는다.** 옛 9인자 함수와 is_anon 칸을 그대로 둔 채
--      새 8인자 함수만 옆에 만든다. 지금 배포돼 있는 chat-post 가 9인자를 부르고 있어서,
--      먼저 지우면 그 순간부터 채팅 쓰기가 통째로 죽는다.
--      순서: ① 이 파일 → ② 함수 배포(chat-post·chat-list·chat-report·chat-translate·admin)
--            → ③ 20260907130000 (옛 함수 + 칸 드롭)
--
--   ⚠️ 인자 **개수**가 달라서 두 함수가 공존해도 모호하지 않다(Postgres 가 arity 로 고른다).
--      기본값을 준 채 인자만 줄이는 방식이면 모호해져서(`function is not unique`) 쓰기가 죽는다 —
--      `feedback_post` 6→7인자 때 겪은 그 함정이라, 여기서도 새로 만들고 옛 것을 통째로 드롭한다.
--
--   ⚠️ 레이트리밋이 상수가 됐다 — 최소간격 3초 · 60초 창 10건(옛 실명 값 그대로).
--      익명이 없어졌으므로 5초/5건 쪽은 쓰일 일이 없다.

begin;

create or replace function public.chat_post_atomic(
  p_user uuid,
  p_ip_hash text,
  p_body text,
  p_content_hash text,
  p_mod_status text,
  p_display_name text,
  p_lang text,
  p_room text
) returns table(id bigint, created_at timestamptz, updated_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  v_min_interval constant int := 3;
  v_window_cap   constant int := 10;
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
    insert into chat_messages(user_id, ip_hash, display_name, body, lang, mod_status, content_hash, room)
    values (p_user, p_ip_hash, p_display_name, p_body, p_lang, p_mod_status, p_content_hash, v_room)
    returning chat_messages.id, chat_messages.created_at, chat_messages.updated_at;
end;
$$;

revoke execute on function public.chat_post_atomic(uuid,text,text,text,text,text,text,text) from public, anon, authenticated;
grant  execute on function public.chat_post_atomic(uuid,text,text,text,text,text,text,text) to service_role;

commit;
