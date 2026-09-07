-- ============================================================================
-- 허브 스킨 4장 추가 — 사옥 안 둘 + 캠퍼스 둘 (2026-09-07)
--
-- 무엇인가
--   오피스 사옥·광장과 **같은 UI 한 벌**(`data-ui='office'`)을 그대로 입는 배경 4장이다.
--   그래서 코드에는 `hub.css` 배경 4줄 + `SKINS` 4줄 + 사전 4키(6개국어)만 늘고,
--   이 파일은 2026-08-20 에 그은 선 그대로 **가격·진열**만 만든다.
--     · office_desk   = 사무실(창가 데스크 + 모아교육그룹 벽 로고)
--     · office_lounge = 라운지(소파·유리 회의실)
--     · campus_day    = 캠퍼스 광장 낮(분수)
--     · campus_sunset = 캠퍼스 광장 노을
--
-- ⚠️ **값 0인데 active=true 다** — 오피스 두 장과 같은 조건이다. '기본'이 아니라 '공짜로 파는
--    물건'이라는 뜻이고, 상점에 진열되며 구매를 누르면 코인을 안 쓰고 그 자리에서 지급된다
--    (`shop_buy` 가 `v_points < v_price` 만 본다). `skin_meadow`(값 0 · active=false)와
--    헷갈리지 말 것 — 초원은 아무것도 장착 안 한 사람이 떨어지는 자리라 상점에 안 뜨는 게 정의다.
--
-- 진열 순서: 초원 90(비판매) · 고궁 낮 100 · 밤 110 · 오피스 사옥 120 · 광장 130
--            · **사무실 140 · 라운지 150 · 캠퍼스 낮 160 · 캠퍼스 노을 170**
-- ============================================================================

insert into shop_catalog (part_key, price, kind, sort_order, active) values
  ('skin_office_desk',   0, 'skin', 140, true),
  ('skin_office_lounge', 0, 'skin', 150, true),
  ('skin_campus_day',    0, 'skin', 160, true),
  ('skin_campus_sunset', 0, 'skin', 170, true)
on conflict (part_key) do update
  set price      = excluded.price,
      kind       = excluded.kind,
      sort_order = excluded.sort_order,
      active     = excluded.active;
