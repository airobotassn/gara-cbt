-- ============================================================================
-- 허브 스킨 — 시즌 · 할로윈 (2026-09-14 · Z:「시즌 스킨」)
--
-- 새 UI 한 벌(`data-ui='halloween'` — 보라 면·금테·호박 메달, `public/hub/ui-halloween/*`)을 입는 첫 시즌 배경.
-- 칩 '시즌'. 값 0 · 판매중. 진열 620 — 대한민국(540~610) 다음. 설날·추석·크리스마스는 자기 UI 벌이 오면 630 부터.
-- ============================================================================

insert into shop_catalog (part_key, price, kind, sort_order, active) values
  ('skin_season_halloween', 0, 'skin', 620, true)
on conflict (part_key) do update
  set price      = excluded.price,
      kind       = excluded.kind,
      sort_order = excluded.sort_order,
      active     = excluded.active;
