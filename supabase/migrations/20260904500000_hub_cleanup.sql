-- 2026-09-04 · 허브 쪽 죽은 것 둘 제거 (2026-09-04 지시)
--
--   ① shop_catalog.surface 드롭 — 방 꾸미기(2026-08-14)가 붙인 칸이다. "이 파츠를 어디에 놓느냐"
--      (벽·바닥·책상)를 담으려던 자리인데, **2026-08-20 에 방 꾸미기를 통째로 없앴다**
--      (20260820160000 이 user_rooms 를 드롭). 그 뒤로 11건 전부 null 이다.
--      ⚠️ 그때 이 컬럼은 **일부러 남겼다** — "컬럼을 지우면 schema.sql·옛 마이그레이션과 더 어긋나고,
--         남아 있어도 아무도 안 읽는다" 가 이유였다. 두 가지가 다 약해졌다:
--           · schema.sql 과의 어긋남은 오늘 이미 여러 건 생겼다(같은 정리의 일부다)
--           · **아무도 안 읽는 게 아니었다** — 관리자 꾸미기 관리 화면이 이름 옆에 그리려고 하고 있었다
--             (AdminReform.tsx, 값이 전부 null 이라 실제로는 아무것도 안 떴다)
--      읽던 자리 셋을 같이 걷어냈다: get-hub(카탈로그 응답) · admin/reform(조회) · AdminReform(화면).
--
--   ② user_tickets 드롭 — 3열 0행. 코드·SQL 함수·FK 어디에서도 참조가 없다(전수 확인).
--      응시권은 exam_tickets 가 담당하고 있고 이 표는 그 이전 설계의 잔재다.
--
--   ⚠️ 남긴 것: user_characters.equipped(jsonb) 는 그대로 둔다. "행을 열어보기 전엔 안에 뭐가
--      들었는지 모른다" 는 문제가 있지만(skin·title 두 키), **오늘 다른 세션이 title 키를 막 추가했다**
--      (20260904200000). 지금 컬럼으로 쪼개면 그 작업과 충돌한다 — 따로 잡을 것.

begin;

alter table shop_catalog drop column if exists surface;
drop table if exists user_tickets;

commit;
