-- ============================================================================
-- 허브 스킨 — 세계 · 한옥 양반집 둘 + 산토리니 · 만리장성 (2026-09-15 · 옛 Z:「배경 스킨」→「국가별 스킨」으로 옮김)
--
-- 한옥 둘은 세계 칩(아시아)에 서되 UI 는 대한민국 벌(`data-ui='korea'`)을 입고, 산토리니(유럽)·만리장성(아시아)은 세계 벌.
-- 값 0 · 판매중. 진열 670~700.
-- ============================================================================

insert into shop_catalog (part_key, price, kind, sort_order, active) values
  ('skin_world_kr_hanok',  0, 'skin', 670, true),
  ('skin_world_kr_hanok2', 0, 'skin', 680, true),
  ('skin_world_gr_santorini', 0, 'skin', 690, true),
  ('skin_world_cn_greatwall', 0, 'skin', 700, true)
on conflict (part_key) do update
  set price      = excluded.price,
      kind       = excluded.kind,
      sort_order = excluded.sort_order,
      active     = excluded.active;
