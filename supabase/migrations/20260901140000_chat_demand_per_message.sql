-- ============================================================
-- 채팅 번역 수요를 **방 단위 → 글 단위**로 바꾼다 (2026-09-01)
--
--   왜 바꾸나 — 여태 수요가 `(방, 언어)` 한 줄이라, **한 사람이 한 번 번역을 켜면 그 방의 모든 글이,
--   그리고 그 뒤 5일간 올라오는 모든 글이** 번역 대상이 됐다. 켠 사람이 그 자리에서 나가도 마찬가지다
--   (끄는 신호도 나가는 신호도 서버로 오지 않는다 — 서버가 아는 건 마지막 요청 시각뿐이다).
--   그래서 "몽골 방을 한 번 열어본 브라질 사람" 때문에 아무도 안 읽을 포르투갈어 번역이 5일간 쌓였다.
--
--   바꾼 뒤 — 브라우저가 이미 **지금 화면에 띄운 글 번호**를 보내고 있으므로, 그걸 그대로 수요로 적는다.
--   화면에 뜬 적 없는 글은 번역되지 않고, 방을 나가면 새 요청이 없으니 자연히 멈춘다.
--
--   ⛔ **5일 만료(last_requested_at)가 통째로 사라진다.** 만료는 "이 방을 아직 보고 있나"를 추측하는
--      장치였는데, 글 단위에서는 추측할 게 없다 — 요청된 글이 곧 대상이고, 번역되면
--      chat_translations 에 행이 생겨 자동으로 목록에서 빠진다.
--      ⚠️ requested_at 은 남겨두지만 **판정에 쓰지 않는다.** 오래 남은 미처리 행을 찾을 때만 본다.
--
--   ⚠️ 옛 행은 옮기지 않고 버린다. `(방, 언어)` 를 `(글, 언어)` 로 펼치면 그 방 글 전부가 수요가 되어
--      지금 없애려는 상태를 그대로 복원하게 된다. 수요는 사용자 요청으로 즉시 다시 쌓인다.
--
--   ⚠️ 사용자 경로의 순서도 뒤집힌다(chat-translate 함수) — 여태 '수요 기록 → 창고 조회' 였는데,
--      이제 **'창고 조회 → 없는 것만 수요 기록'** 이다. 이미 번역된 글을 수요에 넣을 이유가 없고,
--      무엇이 없는지는 조회를 해봐야 알기 때문이다.
--
--   멱등(재실행 안전) — schema.sql 에 동일 DDL 존재.
-- ============================================================

drop table if exists chat_translation_demand;

-- (글, 언어) → "이 글을 이 언어로 보여달라는 요청이 있었다".
--  · 워커의 유일한 입력이다.
--  · 원문이 지워지면 같이 사라진다(cascade) — 없는 글을 번역할 이유가 없다.
create table if not exists chat_translation_demand (
  message_id   bigint      not null references chat_messages(id) on delete cascade,
  lang         text        not null,
  -- ⚠️ 기록용이다. 워커 목록을 고르는 데 **쓰지 않는다**(위 ⛔ 참고).
  requested_at timestamptz not null default now(),
  primary key (message_id, lang)
);

alter table chat_translation_demand enable row level security;
-- 정책 없음 → service role 전용. 클라가 수요를 직접 쓰면 남의 글을 임의 언어로 번역시킬 수 있다.

-- ── 워커 할 일 목록 ────────────────────────────────────────
-- "요청된 (글, 언어) 중 아직 번역이 없는 것", 최신 글부터.
--
--  ⚠️ 남은 조건은 전부 **수요를 적은 뒤에 상황이 바뀔 수 있는 것들**이다. 적을 때는 멀쩡했는데
--     그 사이 지워졌거나, 신고로 가려졌거나, 다른 사람 요청으로 이미 번역됐을 수 있다.
--  ⚠️ src_lang is null 인 글도 포함한다 — 워커가 언어 판정을 먼저 하고 번역한다(둘 다 공짜).
--     길이 2 이하만 여기서 걸러내고, '글자가 하나도 없는 줄'(이모지·숫자만)은 유니코드 판정이
--     필요해 워커 쪽(isTranslatable)에서 거른다.
--  ⚠️ 최신 글부터(order by m.id desc) — 밀려도 사람들이 지금 보는 화면이 먼저 채워진다.
create or replace function public.chat_translation_pending(p_limit int default 500)
returns table(message_id bigint, room text, body text, src_lang text, dst_lang text)
language sql security definer set search_path = public as $$
  select m.id, m.room, m.body, m.src_lang, d.lang
  from chat_translation_demand d
  join chat_messages m
    on  m.id         = d.message_id
    and m.deleted_at is null
    and m.mod_status = 'ok'
    and m.body       is not null
    and char_length(btrim(m.body)) > 2
    and (m.src_lang is null or m.src_lang <> d.lang)
  left join chat_translations t
    on t.message_id = m.id and t.lang = d.lang
  where t.message_id is null
  order by m.id desc
  limit greatest(1, least(p_limit, 2000));
$$;

revoke execute on function public.chat_translation_pending(int) from public, anon, authenticated;
grant  execute on function public.chat_translation_pending(int) to service_role;
