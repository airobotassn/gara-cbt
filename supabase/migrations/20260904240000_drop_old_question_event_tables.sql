-- 문항 이력 옛 표 3개 드롭 — `20260904230000_question_history_merge.sql` 의 마지막 단계(④).
--
-- ⛔ **함수를 배포하기 전에는 적용하지 말 것.** 브라우저와 엣지 함수가 컬럼을 이름으로 select 하므로,
--    배포 전 코드가 살아 있는 동안 지우면 PostgREST 가 400 을 내고 **관리자 이력 탭 3개가 통째로 멈춘다.**
--    순서는 ① 20260904230000 적용 → ② `supabase functions deploy admin admin-test`
--          → ③ 20260904230000 재실행(틈 메우기) → ④ **이 파일**.
--
-- 적용 전 확인: 이력 탭 3개(CARIS 문항 이력 · CARIS ARENA 문항 이력 · 용어 문항 이력)가
--             배포된 화면에서 실제로 뜨는지 눈으로 볼 것. 뜨면 새 표를 읽고 있다는 뜻이다.

-- 혹시 ③(틈 메우기)을 건너뛰었을 때를 대비해 한 번 더 쓸어 담는다 — 이미 있으면 아무 일도 안 한다.
insert into public.question_history (id, kind, question_id, label, scope, action, actor, detail, created_at)
select id, 'caris', question_id, number::text, bank_id::text, action, actor, detail, coalesce(created_at, now())
  from public.cbt_question_events
union all
select id, 'leveltest', question_id, code, level::text, action, actor, detail, coalesce(created_at, now())
  from public.question_events
union all
select id, 'term', question_id, code, null, action, actor, detail, coalesce(created_at, now())
  from public.term_question_events
on conflict (id) do nothing;

-- ⛔ 옮겨지지 않은 행이 한 줄이라도 있으면 드롭하지 않는다 — 드롭은 되돌릴 수 없다.
do $$
declare
  r record;
  got bigint;
begin
  for r in
    select 'caris' as kind, (select count(*) from public.cbt_question_events)  as want
    union all
    select 'leveltest',     (select count(*) from public.question_events)
    union all
    select 'term',          (select count(*) from public.term_question_events)
  loop
    select count(*) into got from public.question_history h where h.kind = r.kind;
    if got < r.want then
      raise exception '아직 옮기지 못한 이력이 있다 (%): 옛 표 % / 새 표 % — 드롭 중단', r.kind, r.want, got;
    end if;
  end loop;
end $$;

drop table if exists public.cbt_question_events;
drop table if exists public.question_events;
drop table if exists public.term_question_events;
