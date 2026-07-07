-- 상시회차 제목에서 'Pro' 제거 — 자격 개편(2026-07, 트랙/티어제)으로 "CARIS Pro"는 더 이상 트랙명 아님.
-- 20260703160000 시드는 `where not exists` 라 이미 시드된 DB엔 반영 안 됨 → 기존 행을 직접 UPDATE.
-- 구 제목(ko='CARIS Pro 상시 검정 (CBT)')인 상시회차만 대상(관리자가 새로 만든 회차는 건드리지 않음).
update public.exam_rounds
set title_i18n = '{"ko":"CARIS 상시 검정 (CBT)","en":"CARIS Rolling Exam (CBT)","ja":"CARIS 常時検定 (CBT)","zh":"CARIS 常规检定 (CBT)","hi":"CARIS रोलिंग परीक्षा (CBT)","vi":"Kỳ thi thường trực CARIS (CBT)"}'::jsonb
where kind = 'rolling'
  and title_i18n->>'ko' = 'CARIS Pro 상시 검정 (CBT)';
