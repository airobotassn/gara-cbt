-- ============================================================================
-- 허브 스킨 8장 추가 — 홈·오피스 (2026-09-11)
--
-- 무엇인가
--   Z:「홈·오피스 스킨」폴더의 9장 중 8장이다(「오피스 스킨.png」는 이미 들어가 있는
--   `skin_office_lounge` 와 같은 그림이라 뺐다). 전부 오피스 UI 한 벌(`data-ui='office'`)을 그대로
--   입는 배경만 다른 스킨이라, 코드에는 `hub.css` 배경 8줄 + `SKINS` 8줄 + 사전 8키(6개국어)만 늘고
--   이 파일은 2026-08-20 에 그은 선 그대로 **가격·진열**만 만든다.
--     · home_m               = 홈 · 백수의 집 (남)
--     · home_f               = 홈 · 백수의 집 (여)
--     · home_warm            = 홈 · 따뜻한 거실
--     · office_future_sunset = 미래형 오피스 · 노을
--     · office_future_day    = 미래형 오피스 · 낮
--     · lab_factory          = 스마트팩토리 · 연구실
--     · lab_atrium           = 스마트팩토리 · 아트리움
--     · office_city          = 오피스 · 도심 라운지
--
-- ⚠️ **값 0인데 active=true 다** — 앞서 넣은 오피스·캠퍼스 여섯 장과 같은 조건(2026-09-11 지시).
--    '기본'이 아니라 '공짜로 파는 물건'이라 상점에 진열되고 구매를 누르면 코인을 안 쓰고 그 자리에서
--    지급된다(`shop_buy` 가 `v_points < v_price` 만 본다). `skin_meadow`(값 0 · active=false)와
--    헷갈리지 말 것.
--
-- ⚠️ 상점·보관함의 **배경 칩 필터(카테고리)는 DB 에 없다** — `SkinDef.category`(코드)가 단일 출처다.
--    그림·수치는 코드, 가격·진열은 DB 라는 선을 그대로 지킨 것이다. 여기 컬럼을 만들지 말 것.
--
-- 진열 순서: 초원 90(비판매) · 고궁 낮 100 · 밤 110 · 오피스 사옥 120 · 광장 130 · 사무실 140
--            · 라운지 150 · 캠퍼스 낮 160 · 노을 170 · **홈 남 180 · 홈 여 190 · 따뜻한 거실 200
--            · 미래형 노을 210 · 미래형 낮 220 · 연구실 230 · 아트리움 240 · 도심 라운지 250**
--   (칩으로 거른 뒤에도 이 순서대로 선다 — 화면이 다시 정렬하지 않는다.)
-- ============================================================================

insert into shop_catalog (part_key, price, kind, sort_order, active) values
  ('skin_home_m',               0, 'skin', 180, true),
  ('skin_home_f',               0, 'skin', 190, true),
  ('skin_home_warm',            0, 'skin', 200, true),
  ('skin_office_future_sunset', 0, 'skin', 210, true),
  ('skin_office_future_day',    0, 'skin', 220, true),
  ('skin_lab_factory',          0, 'skin', 230, true),
  ('skin_lab_atrium',           0, 'skin', 240, true),
  ('skin_office_city',          0, 'skin', 250, true)
on conflict (part_key) do update
  set price      = excluded.price,
      kind       = excluded.kind,
      sort_order = excluded.sort_order,
      active     = excluded.active;
