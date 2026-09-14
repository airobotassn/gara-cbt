-- ============================================================================
-- 허브 스킨 — 대한민국 지역 8장 (2026-09-14 · Z:「★대한민국 지역별 스킨」폴더 전부)
--
-- 새 UI 한 벌(`data-ui='korea'` — 단청 구름·청록·금테, `public/hub/ui-korea/*`)을 입는 배경 8장.
-- 강릉 · 경기 · 광주 · 대구 · 대전 · 부산 · 인천 · 제주. 코드에는 `hub.css` 값 블록 한 벌 + 배경 8줄 +
-- `SKINS` 8줄 + 사전(칩 '대한민국' + 이름)이 늘고, 이 파일은 가격·진열만 만든다. 값 0 · 판매중.
-- 진열 540~610 — 세계(300~530) 다음.
-- ============================================================================

insert into shop_catalog (part_key, price, kind, sort_order, active) values
  ('skin_kr_gangneung',  0, 'skin', 540, true),
  ('skin_kr_gyeonggi',   0, 'skin', 550, true),
  ('skin_kr_gwangju',    0, 'skin', 560, true),
  ('skin_kr_daegu',      0, 'skin', 570, true),
  ('skin_kr_daejeon',    0, 'skin', 580, true),
  ('skin_kr_busan',      0, 'skin', 590, true),
  ('skin_kr_incheon',    0, 'skin', 600, true),
  ('skin_kr_jeju',       0, 'skin', 610, true)
on conflict (part_key) do update
  set price      = excluded.price,
      kind       = excluded.kind,
      sort_order = excluded.sort_order,
      active     = excluded.active;
