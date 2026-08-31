-- 허브 '아이템'(kind='part') 폐기 (2026-08-31 지시: "저거 안 쓰는 거야 다 지워")
--
-- 모자·신발·안경·날개·왕관 6종. 2026-07 뽑기(가차) 시절의 물건이고 뽑기가 사라지면서
-- (`20260818120000`) 살 길이 없어졌다. 적용 직전 프로덕션 실측:
--   · 6종 **전부 이미 active=false** — 상점에 안 뜬 지 오래다.
--   · **착용자 0명** — `user_characters.equipped` 는 전부 `{"skin": …}` 뿐이다.
--   · 보유 3건 / 1계정 — 뽑기 시절 흔적.
-- 그래서 "돈 낸 물건을 뺏지 않는다" 원칙에 걸리지 않는다(살 수 있던 적이 없다).
--
-- ⚠️ `user_cosmetics` 를 먼저 지운다. 순서를 뒤집어도 FK 가 없어 에러는 안 나지만,
--    카탈로그가 먼저 사라지면 남은 보유행이 '이름도 없는 유령'이 된다.
-- ⚠️ 뽑기 표(`gacha_pool` 등)는 이미 드롭돼서 여기서 건드릴 게 없다.
-- ⚠️ 화면 쪽에서 같이 지운 것: 관리자 꾸미기 관리의 '아이템' 묶음 · 사전 `hub.part.<키>` 6개국어 6벌.
--    ⛔ `schema.sql` 의 seed 한 줄도 같이 지웠다 — 안 지우면 스키마를 다시 세울 때 되살아난다.

delete from public.user_cosmetics
 where part_key in ('hat_common_01','hat_common_02','shoe_common_01','glasses_common_01','wing_rare_01','crown_rare_01');

delete from public.shop_catalog
 where part_key in ('hat_common_01','hat_common_02','shoe_common_01','glasses_common_01','wing_rare_01','crown_rare_01');
