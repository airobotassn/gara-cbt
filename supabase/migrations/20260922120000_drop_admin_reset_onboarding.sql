-- '첫 진입 상태로 초기화' 제거 (2026-09-22 지시)
--   관리자 › 회원 상세의 버튼과 admin 함수의 resetOnboarding 액션을 같은 날 지웠다. 부르는 곳이 0곳이 된
--   RPC 를 DB 에서도 내린다 — 기능이 없는데 함수만 남으면 service role 로 부를 수 있는 우회 경로가 된다
--   (지역 1회 변경 잠금을 푸는 조작이라 루트 전용으로 막아 뒀던 것).
--   원본 20260819170000 · 캐릭터까지 비우도록 갈아끼운 20260820120000 §4.
drop function if exists public.admin_reset_onboarding(uuid);
