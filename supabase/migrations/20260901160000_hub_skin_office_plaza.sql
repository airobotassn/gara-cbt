-- ============================================================================
-- 허브 스킨 '오피스 · 광장' 추가 (2026-09-01)
--
-- 고궁 낮·밤과 같은 꼴이다 — **배경만 다르고 UI 한 벌은 통째로 공유**한다
-- (`data-ui='office'`). 그래서 코드에는 `hub.css` 의 배경 한 줄과 `SKINS` 한 줄만 늘고,
-- 여기서는 가격·진열만 만든다.
--
-- ⚠️ 값 0 · active=true — 오피스 · 사옥과 같은 조건(구매를 누르면 코인을 안 쓰고 바로 지급).
-- 진열 순서: 초원 90(비판매) · 고궁 낮 100 · 고궁 밤 110 · 오피스 사옥 120 · **광장 130**.
-- ============================================================================

insert into shop_catalog (part_key, price, kind, sort_order, active) values
  ('skin_office_plaza', 0, 'skin', 130, true)
on conflict (part_key) do update
  set price      = 0,
      kind       = 'skin',
      sort_order = 130,
      active     = true;
