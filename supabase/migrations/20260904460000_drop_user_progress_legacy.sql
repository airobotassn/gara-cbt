-- 2026-09-04 · user_progress 에서 죽은 칸 둘 제거 (2026-09-04 지시)
--
--   ① demotion_strikes — **강등은 2026-07 에 없앴다.** 그때 강등선·3진 경고·경고 배너가 다 사라졌는데
--      이 칸만 남았다. 21명 전부 0이고 읽는 코드도 SQL 함수도 0곳이다.
--      짝인 test_attempts.warn_strikes 는 20260904440000 에서 이미 뺐다.
--
--   ② points — 시즌 점수 개편(2026-09-03) 전의 옛 계산식(0~10,000). 지금 점수의 단일 출처는
--      skill_score + activity_score = season_total(생성열)이다. 같은 사람에게 points 5,714 와
--      season_total 4,437 이 동시에 존재해서, 어느 게 진짜 점수인지 코드마다 갈릴 수 있었다.
--      읽던 세 자리를 이렇게 정리했다:
--        get-hub        rankPoints 필드 삭제      — 화면(Hub.tsx)이 타입에만 두고 안 그리고 있었다
--        list-attempts  currentPoints 필드 삭제   — /test/record 가 안 쓴다
--        mypage-ai      **함수째 삭제**           — 프론트 호출부가 0곳이었다(배포본만 살아 있었다).
--                                                  마이페이지 AI 조언은 나중에 새로 짠다(2026-09-04 지시).
--      ⚠️ mypage-ai 는 화면과 다른 숫자(points)를 Gemini 에 넘기고 있었다 — 시스템 지시가
--         "데이터에 없는 사실을 지어내지 말라" 인데 정작 주는 데이터가 화면과 달랐다.
--
--   ⚠️ 남긴 것: season_id 는 21명 전부 비어 있지만 **죽은 칸이 아니다** — 시즌 리셋(reset_season)이
--      쓰는 자리이고, 첫 시즌을 아직 안 끝내서 안 채워진 것뿐이다. activity_ledger 쪽은 305건 전부 차 있다.
--
--   배포 → 드롭 순서로 적용했다(get-hub·list-attempts 재배포 + mypage-ai 배포본 삭제 완료).

begin;

alter table user_progress drop column if exists demotion_strikes;
alter table user_progress drop column if exists points;

commit;
