-- 2026-09-07 · 강의 AI Q&A 통째로 제거 + lectures.channel 드롭 (2026-09-07 지시)
--
--   ① 강의 AI Q&A (표 3 · RPC 3 · 엣지 함수 1 · 테스트 2벌)
--      "강의 보다가 모르는 걸 AI 에게 물어보는" 기능이었다. 강의 자막을 조각내 임베딩으로 넣어두고
--      (lecture_chunks) 그 강의를 산 사람만(lecture_entitlements) 하루 몇 번까지(lecture_quota) 묻는 구조.
--
--      **한 번도 안 돌았다** — 셋 다 0행이고, 담당 함수(lecture-qa)를 부르는 화면 코드가 0곳이었다.
--      결정적으로 세 표의 `lecture_id` 가 **text** 인데 실제 `lectures.id` 는 **uuid** 라
--      지금 강의와는 **애초에 이어질 수 없는 구조**다(다른 시기에 다른 전제로 만들어진 스키마).
--
--      ⛔ **되살릴 거면 이 표들을 복구하지 말고 uuid 기준으로 새로 짤 것**(2026-09-07 지시).
--         그래서 데이터 보존을 신경 쓰지 않는다 — 보존할 행이 0개이고, 남겨도 못 쓴다.
--      ⚠️ `vector` 확장은 **지우지 않는다** — reco_cache(레벨 추천)·kb_chunks(문항 생성 지식베이스)·
--         route_cache(메인 검색 라우터)가 계속 쓴다. 여기서 drop extension 하면 그 셋이 통째로 죽는다.
--      ⚠️ 이름이 비슷한 `kb_chunks`(2,546행)는 **다른 것**이다 — 문항 생성용 지식베이스. 건드리지 않는다.
--
--   ② lectures.channel
--      '어느 유튜브 채널 영상인가'. 2026-08-25 에 관리자 입력칸을 뺐고, 그때 "옛 값이 사라진다"는
--      이유로 컬럼은 남겼다. 실측해 보니 **2행 전부 빈 문자열**이라 잃을 값이 없다.
--      화면은 값이 있을 때만 제목 밑에 찍는데 채울 방법이 없어져서 영영 안 뜬다.
--
--   ⛔ **함수 배포가 끝난 뒤에 적용할 것** (ebooks · admin).
--      아직 도는 옛 코드가 강의 목록에서 channel 을 select 하고 저장 때 insert 한다 —
--      먼저 지우면 PostgREST 400 이라 **강의 목록과 강의 저장이 통째로 멈춘다.**
--      같은 배포 묶음: 20260907170000(purchases.source).

begin;

-- ① 강의 AI Q&A
drop function if exists public.match_lecture_chunks(text, vector, int);
drop function if exists public.is_entitled(uuid, text);
drop function if exists public.consume_quota(uuid, text, int);

drop table if exists lecture_chunks;
drop table if exists lecture_entitlements;
drop table if exists lecture_quota;

-- ② 채널
alter table lectures drop column if exists channel;

-- 검산 — vector 확장이 살아 있어야 한다(추천·지식베이스·검색 라우터가 쓴다).
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'vector') then
    raise exception 'vector 확장이 사라졌다 — reco_cache·kb_chunks·route_cache 가 죽는다';
  end if;
end $$;

commit;
