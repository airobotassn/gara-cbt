-- ============================================================================
-- 허브 스킨 — 시즌 · 설날 · 추석 (2026-09-15 · Z:「시즌 스킨」)
--
-- 자기 UI 벌 없이 대한민국 벌(`data-ui='korea'`)을 입는 배경 2장(2026-09-15 지시). 칩 '시즌'. 값 0 · 판매중.
-- 진열 650·660 — 크리스마스(630·640) 다음.
-- ============================================================================

insert into shop_catalog (part_key, price, kind, sort_order, active) values
  ('skin_season_seollal', 0, 'skin', 650, true),
  ('skin_season_chuseok', 0, 'skin', 660, true)
on conflict (part_key) do update
  set price      = excluded.price,
      kind       = excluded.kind,
      sort_order = excluded.sort_order,
      active     = excluded.active;
