-- ============================================================================
-- 허브 스킨 — 풍경 5장 (2026-09-15 · Z:「풍경 스킨」폴더 전부)
--
-- 새 UI 한 벌(`data-ui='scenery'` — 호두나무 틀·아이보리 면·일출 메달, `public/hub/ui-scenery/*`)을 다섯이 같이 입는다.
-- 칩 '풍경'. 값 0 · 판매중. 진열 710~750.
-- ============================================================================

insert into shop_catalog (part_key, price, kind, sort_order, active) values
  ('skin_scenery_desert',   0, 'skin', 710, true),
  ('skin_scenery_saltflat', 0, 'skin', 720, true),
  ('skin_scenery_savanna',  0, 'skin', 730, true),
  ('skin_scenery_beach',    0, 'skin', 740, true),
  ('skin_scenery_safari',   0, 'skin', 750, true)
on conflict (part_key) do update
  set price      = excluded.price,
      kind       = excluded.kind,
      sort_order = excluded.sort_order,
      active     = excluded.active;
