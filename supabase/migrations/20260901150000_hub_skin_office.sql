-- ============================================================================
-- 허브 스킨 '오피스' 추가 (2026-09-01)
--
-- 무엇인가
--   모아교육그룹 사옥 앞 광장 배경 한 장 + **자기 UI 한 벌**(흰 면에 파란 테를 두른 판·
--   알약 게이지·3D 파란 아이콘). 고궁 낮·밤이 UI 한 벌을 나눠 쓰는 것과 달리, 오피스는
--   배경과 UI 를 같이 들고 온다 — `data-skin='office'` + `data-ui='office'`.
--
--   그림·수치는 코드/에셋에 있고(`src/lib/hubCosmetics.ts` · `src/styles/hub.css` ·
--   `public/hub/bg-office.webp` · `public/hub/ui-office/*`), 이 파일은 **가격·진열**만 만든다.
--   2026-08-20 에 그은 선 그대로다.
--
-- ⚠️ **값 0인데 active=true 다.** '기본'이 아니라 '공짜로 파는 물건'이라는 뜻이다:
--     · 상점 목록은 `get-hub` 이 active 인 행으로 만든다 → 진열된다.
--     · `shop_buy` 는 `v_points < v_price` 만 보므로 0원은 그냥 통과해 그 자리에서 지급된다
--       (코인이 0인 사람도 받는다).
--   ⛔ 이 자리를 `skin_meadow`(값 0 · **active=false**)와 헷갈리지 말 것. 초원은 목록 첫 항목이자
--      아무것도 장착 안 한 사람이 떨어지는 자리라 상점에 안 뜨는 게 정의다(`SKINS[0]`).
--      오피스를 그쪽으로 옮기면 상점에서 사라지고, 반대로 초원을 active 로 바꾸면
--      "이미 입고 있는 것"이 상점에 팔 물건으로 뜬다.
--
-- 진열 순서: 초원 90(비판매) · 고궁 낮 100 · 고궁 밤 110 · **오피스 120**.
-- ============================================================================

insert into shop_catalog (part_key, price, kind, sort_order, active) values
  ('skin_office', 0, 'skin', 120, true)
on conflict (part_key) do update
  set price      = 0,
      kind       = 'skin',
      sort_order = 120,
      active     = true;
