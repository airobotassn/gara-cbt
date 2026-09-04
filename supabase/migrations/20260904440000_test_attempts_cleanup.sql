-- 2026-09-04 · test_attempts 정리 — 강등 잔재(warn_strikes) · 중복 시각(created_at) · 옛 'down' 3건
--
--   ① warn_strikes 드롭 — **강등은 2026-07 에 없앴다.** 그때 강등선·3진 경고·경고 배너가 다 사라졌는데
--      이 칸만 남았다(값이 0 아닌 게 11건 = 강등 제도 시절 흔적). 읽지도 쓰지도 않는다 —
--      코드 참조 0곳, SQL 함수 참조 0곳. src/lib/scoring.ts 주석도 vestigial 이라고 적고 있었다.
--      ⚠️ 짝인 user_progress.demotion_strikes 는 이 파일에서 안 건드린다(그 표를 볼 때 같이 본다).
--
--   ② created_at 드롭 — started_at 과 **426건 전부 같은 값**이었다. 응시권·응시 기록·응시 로그에 이어
--      오늘 네 번째로 나온 같은 패턴이다. 읽던 두 자리는 started_at 으로 옮겼다:
--        admin-test/handlers/attempts.ts   목록 정렬 + 응답(별칭 `created_at:started_at` 로 화면 유지)
--        admin-test/handlers/analytics.ts  일별 응시 추이 폴백
--      ⚠️ 응답 필드 이름을 별칭으로 남긴 이유 = 화면(AdminLevelTest.tsx)이 그 이름을 쓰고 있어서다.
--
--   ③ rank_dir='down' 3건 → 'stay' — 강등 제거 전 기록이다. 서버는 이미 내려줄 때 접고 있었지만
--      (list-attempts · _shared/scoring.ts) **관리자 분석 화면은 DB 값을 그대로 세서 '강등 3건'** 을
--      보여줬다. 제도에 없는 값이라 원본을 정정한다.
--      ⛔ 접는 코드는 그대로 둘 것 — 옛 백업에서 복원하거나 다른 경로로 'down' 이 들어와도 화면은 막힌다.

begin;

alter table test_attempts drop column if exists warn_strikes;
alter table test_attempts drop column if exists created_at;

update test_attempts set rank_dir = 'stay' where rank_dir = 'down';

commit;
