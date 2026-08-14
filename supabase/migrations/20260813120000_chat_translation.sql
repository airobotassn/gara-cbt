-- ============================================================
-- 채팅 번역 — 번역 창고 + 수요 목록 + 원문 언어
--
--   설계 요약(자세히는 CLAUDE.md '/arena 채팅 번역'):
--    · 원문이 기본. 사용자가 번역 토글을 켠 순간에만 번역이 일어난다.
--    · 한 번 만든 번역본은 창고에 남아 같은 언어 사용자 전원이 나눠 쓴다
--      → 비용이 **사용자 수가 아니라 (방 × 언어) 조합 수**에만 비례한다.
--    · 어떤 언어로 미리 채울지는 **번역 요청 기록**이 정한다(chat_translation_demand).
--      접속자 언어를 추적하지 않는다 — 눈팅은 번역본을 쓰지 않으므로 셀 이유가 없다.
--
--   ⚠️ 두 테이블 모두 RLS 정책 없음 = service role(Edge Function·워커) 전용.
--      chat_messages 와 같은 관례다. 클라가 번역본을 직접 쓸 수 있으면
--      원문 모더레이션을 우회하는 입력 경로가 열린다.
--
--   멱등(재실행 안전) — schema.sql 에 동일 DDL 존재.
-- ============================================================

-- ── 번역 창고 ──────────────────────────────────────────────
-- (글, 대상언어) → 번역문. 원문이 지워지면 같이 사라진다(cascade).
-- engine 은 기록용이고 조회는 엔진을 구분하지 않는다 — 어느 쪽이 만들었든 같은 값으로 쓴다.
create table if not exists chat_translations (
  message_id bigint      not null references chat_messages(id) on delete cascade,
  lang       text        not null,
  body       text        not null,
  engine     text        not null check (engine in ('edge', 'azure', 'google')),
  created_at timestamptz not null default now(),
  primary key (message_id, lang)
);

-- 워커가 "이 언어로 아직 번역 안 된 글"을 찾을 때 타는 인덱스(anti-join).
create index if not exists chat_translations_lang_idx
  on chat_translations (lang, message_id);

-- ── 수요 목록 ──────────────────────────────────────────────
-- "이 방을 이 언어로 보고 있는 사람이 있다"는 신호. 워커의 유일한 입력이다.
--   ⚠️ 갱신은 **사용자 요청**일 때만 한다. 워커가 갱신하면 자기가 채운 조합이
--      자기 때문에 계속 살아남아 아무도 안 보는 방을 영원히 번역하게 된다.
create table if not exists chat_translation_demand (
  room              text        not null,
  lang              text        not null,
  last_requested_at timestamptz not null default now(),
  primary key (room, lang)
);

create index if not exists chat_translation_demand_fresh_idx
  on chat_translation_demand (last_requested_at desc);

-- ── 원문 언어 ──────────────────────────────────────────────
-- 한 번 판정하고 저장한다. 두 군데서 쓴다:
--   ① 독자 언어와 같으면 번역 대상에서 제외(번역할 이유가 없다)
--   ② 번역 호출에 원문 언어를 명시 → 감지 요금·감지 오류를 둘 다 없앤다
--  ⚠️ chat_messages.lang 은 **작성자의 화면 언어**지 본문 언어가 아니다.
--     한국어 화면으로 영어를 치는 사람이 있으므로 그 값으로 대신할 수 없다.
alter table chat_messages add column if not exists src_lang text;

-- 워커가 "언어 판정이 아직 안 된 글"을 찾을 때.
create index if not exists chat_messages_srclang_todo_idx
  on chat_messages (id desc) where src_lang is null and deleted_at is null;

alter table chat_translations        enable row level security;
alter table chat_translation_demand  enable row level security;
-- 정책 없음 = service role 전용(위 주의 참고).

-- ── 워커의 할 일 목록 ──────────────────────────────────────
-- "수요가 살아있는 방(5일) × 그 언어로 아직 번역 안 된 글".
--
--  ⚠️ 판정을 SQL 한 곳에 둔 이유 = 같은 조건이 서버 함수와 워커 양쪽에 생기면
--     하나만 고쳤을 때 "워커는 번역했는데 서버는 안 한" 어긋남이 난다.
--     나중에 백엔드를 Spring 으로 옮겨도 이 함수는 그대로 쓴다.
--  ⚠️ 최신 글부터(order by m.id desc) — 밀려도 사람들이 지금 보는 화면이 먼저 채워진다.
--  ⚠️ src_lang is null 인 글도 포함한다. 워커가 언어 판정을 먼저 하고 번역한다(둘 다 공짜).
--     길이 2 이하만 여기서 걸러내고, '글자가 하나도 없는 줄'(이모지·숫자만)은
--     유니코드 판정이 필요해 워커 쪽(isTranslatable)에서 거른다.
create or replace function public.chat_translation_pending(p_limit int default 500)
returns table(message_id bigint, room text, body text, src_lang text, dst_lang text)
language sql security definer set search_path = public as $$
  select m.id, m.room, m.body, m.src_lang, d.lang
  from chat_translation_demand d
  join chat_messages m
    on  m.room       = d.room
    and m.deleted_at is null
    and m.mod_status = 'ok'
    and m.body       is not null
    and char_length(btrim(m.body)) > 2
    and (m.src_lang is null or m.src_lang <> d.lang)
  left join chat_translations t
    on t.message_id = m.id and t.lang = d.lang
  where d.last_requested_at > now() - interval '5 days'
    and t.message_id is null
  order by m.id desc
  limit greatest(1, least(p_limit, 2000));
$$;

revoke execute on function public.chat_translation_pending(int) from public, anon, authenticated;
grant  execute on function public.chat_translation_pending(int) to service_role;
