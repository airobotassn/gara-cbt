-- ============================================================================
-- 허브 스킨 — 세계 · 파리 에펠탑 (2026-09-14)
--
-- 새 UI 한 벌(`data-ui='world'` — 남색 세계지도 면·금테·지구본 장식, `public/hub/ui-world/*`)을 처음 입는
-- 배경이다. 코드에는 `hub.css` 값 블록 한 벌 + 배경 한 줄 + `SKINS` 한 줄 + 사전(칩 '세계' + 이름)이 늘고,
-- 이 파일은 2026-08-20 선 그대로 **가격·진열**만 만든다. 값 0 · 판매중(오피스·캠퍼스 계열과 같은 조건).
-- 진열 290 — 캠퍼스 정원(280) 다음. 나라 배경을 더 넣을 땐 300 부터.
-- ============================================================================

insert into shop_catalog (part_key, price, kind, sort_order, active) values
  ('skin_world_paris', 0, 'skin', 290, true)
on conflict (part_key) do update
  set price      = excluded.price,
      kind       = excluded.kind,
      sort_order = excluded.sort_order,
      active     = excluded.active;
