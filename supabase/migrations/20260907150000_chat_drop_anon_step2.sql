-- 2026-09-07 · 익명 채팅 폐지 ②/② — 옛 9인자 함수와 is_anon 칸을 지운다 (2026-09-07 지시)
--
--   ⛔ **함수 배포가 끝난 뒤에 적용할 것.** 앞 파일(20260907140000)이 새 8인자 함수를 만들어 뒀고,
--      chat-post 가 그쪽을 부르도록 배포된 다음에야 이 파일을 적용한다. 순서를 바꾸면
--      아직 도는 옛 chat-post 가 9인자를 못 찾아 채팅 쓰기가 통째로 죽는다.
--      배포 대상: chat-post · chat-list · chat-report · chat-translate · admin (전부 플래그 없이)
--
--   ⚠️ 함수를 먼저 지우고 칸을 지운다. 옛 함수가 본문에서 is_anon 에 insert 하므로 순서가 반대면
--      드롭이 막힌다(의존성).
--
--   ⚠️ 프론트는 늦게 반영돼도 안전하다 — 옛 화면이 읽던 `is_anon` 이 응답에서 빠지면 undefined =
--      falsy 라 '실명 글' 로 그려진다. 실측 95건 전부 false 였으므로 화면이 달라지지 않는다.
--
--   ⛔ 되살리지 말 것 — 칸만 되살리면 익명 배지만 붙고 아바타·국기·카드·색·간격은 실명 그대로라
--      "익명이라고 적혀 있는데 누군지 다 보이는" 상태가 된다. 되살릴 거면 여섯 분기를 같이.

begin;

drop function if exists public.chat_post_atomic(uuid,text,text,text,text,boolean,text,text,text);
drop function if exists public.chat_post_atomic(uuid,text,text,text,text,boolean,text,text);

alter table chat_messages drop column if exists is_anon;

-- 검산 — 새 8인자 함수가 남아 있어야 한다(이게 없으면 채팅 쓰기가 죽는다).
do $$
declare n int;
begin
  select count(*) into n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'chat_post_atomic';
  if n <> 1 then
    raise exception 'chat_post_atomic 이 %개다 — 정확히 1개(8인자)여야 한다', n;
  end if;
end $$;

commit;
