-- ============================================================================
-- 허브 스킨 — 나라 배경 24장 (2026-09-14 · Z:「국가별 스킨」폴더 전부, 파리는 `20260914120000` 에서 먼저)
--
-- 전부 세계 UI 한 벌(`data-ui='world'`)을 그대로 입는 배경만 다른 스킨이라 코드에는 `hub.css` 배경 24줄 +
-- `SKINS` 24줄 + 사전 24키(6개국어)만 늘고, 이 파일은 가격·진열만 만든다. 값 0 · 판매중(같은 날 결정 그대로).
-- 진열 300~530 — 폴더의 가나다 순서 그대로.
-- ============================================================================

insert into shop_catalog (part_key, price, kind, sort_order, active) values
  ('skin_world_za_capetown',     0, 'skin', 300, true),
  ('skin_world_kr_seoul_night',  0, 'skin', 310, true),
  ('skin_world_kr_seoul',        0, 'skin', 320, true),
  ('skin_world_de_berlin',       0, 'skin', 330, true),
  ('skin_world_my_petronas',     0, 'skin', 340, true),
  ('skin_world_us_dc_capitol',   0, 'skin', 350, true),
  ('skin_world_us_dc_monument',  0, 'skin', 360, true),
  ('skin_world_vn_hoankiem',     0, 'skin', 370, true),
  ('skin_world_vn_hanoi_temple', 0, 'skin', 380, true),
  ('skin_world_es_sevilla',      0, 'skin', 390, true),
  ('skin_world_sg_marinabay',    0, 'skin', 400, true),
  ('skin_world_ae_dubai',        0, 'skin', 410, true),
  ('skin_world_gb_bigben',       0, 'skin', 420, true),
  ('skin_world_il_jerusalem',    0, 'skin', 430, true),
  ('skin_world_it_colosseum',    0, 'skin', 440, true),
  ('skin_world_in_lotus',        0, 'skin', 450, true),
  ('skin_world_in_indiagate',    0, 'skin', 460, true),
  ('skin_world_jp_fuji',         0, 'skin', 470, true),
  ('skin_world_cn_tiantan',      0, 'skin', 480, true),
  ('skin_world_cn_tiananmen',    0, 'skin', 490, true),
  ('skin_world_ca_rockies',      0, 'skin', 500, true),
  ('skin_world_ke_kilimanjaro',  0, 'skin', 510, true),
  ('skin_world_ph_palawan',      0, 'skin', 520, true),
  ('skin_world_hk_victoria',     0, 'skin', 530, true)
on conflict (part_key) do update
  set price      = excluded.price,
      kind       = excluded.kind,
      sort_order = excluded.sort_order,
      active     = excluded.active;
