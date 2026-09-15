-- ============================================================================
-- 허브 스킨 — 판타지 4장 (2026-09-15 · Z:「판타지 스킨」폴더 전부)
--
-- 새 UI 한 벌(`data-ui='fantasy'` — 연보라 수정·은테, `public/hub/ui-fantasy/*`)을 넷이 같이 입는다.
-- 칩 '판타지'. 값 0 · 판매중. 진열 760~790.
-- ============================================================================

insert into shop_catalog (part_key, price, kind, sort_order, active) values
  ('skin_fantasy_medieval', 0, 'skin', 760, true),
  ('skin_fantasy_alps',     0, 'skin', 770, true),
  ('skin_fantasy_aurora',   0, 'skin', 780, true),
  ('skin_fantasy_heaven',   0, 'skin', 790, true)
on conflict (part_key) do update
  set price      = excluded.price,
      kind       = excluded.kind,
      sort_order = excluded.sort_order,
      active     = excluded.active;
