-- ============================================================================
-- 허브 스킨 1장 추가 — 오피스 · GARA 사옥 (2026-09-15 지시)
--
-- 무엇인가
--   GARA 본사 정면(깃발·분수·유리 돔) 그림 한 장. 지금 있는 `skin_office`(모아교육그룹 건물)를
--   갈아끼운 게 아니라 **따로 하나 더** 넣었다(2026-09-15 선택). 오피스 UI 한 벌(`data-ui='office'`)을
--   그대로 입는 배경만 다른 스킨이라, 코드에는 `hub.css` 배경 1줄 + `SKINS` 1줄 + 사전 1키(6개국어)만
--   늘고 이 파일은 2026-08-20 에 그은 선 그대로 **가격·진열**만 만든다.
--
-- ⚠️ 값 0 · active=true — 앞서 넣은 오피스 스킨들과 같은 조건('공짜로 파는 물건').
-- 진열 순서 125 = 오피스 사옥(120) 바로 뒤, 광장(130) 앞 — 사옥 둘이 나란히 선다.
-- ============================================================================

insert into shop_catalog (part_key, price, kind, sort_order, active) values
  ('skin_office_gara', 0, 'skin', 125, true)
on conflict (part_key) do update
  set price      = excluded.price,
      kind       = excluded.kind,
      sort_order = excluded.sort_order,
      active     = excluded.active;
