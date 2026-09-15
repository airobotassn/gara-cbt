-- ============================================================================
-- 허브 스킨 1장 추가 — 오피스 · GARA 사옥 · 노을 (2026-09-15 지시)
--
-- 바로 앞 `20260915240000`(GARA 사옥 낮)과 같은 그림의 노을 시간대. 같은 조건(값 0 · active=true ·
-- 오피스 UI 벌)이고 진열 126 = 낮(125) 바로 뒤 — 고궁 낮·밤처럼 둘이 나란히 선다.
-- ============================================================================

insert into shop_catalog (part_key, price, kind, sort_order, active) values
  ('skin_office_gara_sunset', 0, 'skin', 126, true)
on conflict (part_key) do update
  set price      = excluded.price,
      kind       = excluded.kind,
      sort_order = excluded.sort_order,
      active     = excluded.active;
