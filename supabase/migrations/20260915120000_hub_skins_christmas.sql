-- ============================================================================
-- 허브 스킨 — 시즌 · 크리스마스 마을 광장 · 산장 (2026-09-15 · Z:「시즌 스킨」)
--
-- 새 UI 한 벌(`data-ui='christmas'` — 초록·빨강·금테, `public/hub/ui-christmas/*`)을 둘이 같이 입는다.
-- 칩 '시즌'. 값 0 · 판매중. 진열 630·640 — 할로윈(620) 다음.
-- ============================================================================

insert into shop_catalog (part_key, price, kind, sort_order, active) values
  ('skin_season_xmas_town',  0, 'skin', 630, true),
  ('skin_season_xmas_cabin', 0, 'skin', 640, true)
on conflict (part_key) do update
  set price      = excluded.price,
      kind       = excluded.kind,
      sort_order = excluded.sort_order,
      active     = excluded.active;
