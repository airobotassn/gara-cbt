-- ============================================================================
-- 허브 스킨 3장 추가 — 학교 (2026-09-11)
--
-- Z:「학교 스킨」폴더 5장 중 3장(「대학교 캠퍼스」·「황금빛노을 대학 캠퍼스광장」은 이미 들어가 있는
-- 캠퍼스 낮·노을과 같은 그림이라 뺐다). 오피스 UI 한 벌을 그대로 입고 칩은 '캠퍼스'다.
--     · campus_classroom = 캠퍼스 · 고등학교 교실
--     · campus_lecture   = 캠퍼스 · 대학 강의실
--     · campus_garden    = 캠퍼스 · 정원
-- 값 0 · 판매중 — 같은 날 넣은 홈·오피스 8장(`20260911140000`)과 같은 조건. 진열 260~280.
-- ============================================================================

insert into shop_catalog (part_key, price, kind, sort_order, active) values
  ('skin_campus_classroom', 0, 'skin', 260, true),
  ('skin_campus_lecture',   0, 'skin', 270, true),
  ('skin_campus_garden',    0, 'skin', 280, true)
on conflict (part_key) do update
  set price      = excluded.price,
      kind       = excluded.kind,
      sort_order = excluded.sort_order,
      active     = excluded.active;
