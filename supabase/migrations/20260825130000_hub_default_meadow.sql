-- ============================================================================
-- 허브 기본 배경을 초원으로 · 고궁 낮을 판매 스킨으로 되돌린다 (2026-08-25)
--
-- 무엇이 잘못돼 있었나
--   기본 배경(초원)을 **고궁 낮 자리에 덮어씌워** 넣었다. 한 칸에 두 물건이 들어가면서
--   ① 고궁 낮이 자기 배경(bg-v2.png)과 궁궐 UI 를 통째로 잃었고
--   ② 초원 위에는 살아남은 궁궐 판·게이지·도장이 그대로 얹혔다.
--   배경과 UI 는 이제 축이 둘이다(`data-skin` · `data-ui`) — src/lib/hubCosmetics.ts 참고.
--
-- 이 마이그레이션이 하는 일
--   1) 기본 = `skin_meadow` (값 0 · **비판매**). 값이 0이라 사지 않아도 입는다(`hub_equip` 예외).
--   2) `skin_palace_day` 를 판매 스킨으로(값 300 · 진열). 밤과 같은 값 — 같은 UI 한 벌에
--      배경만 다른 물건이라 값이 다를 이유가 없다.
--   3) 지금 고궁 낮을 입고 있는 사람을 전원 초원으로 옮긴다.
--
-- ⚠️ 3) 이 몰수가 아닌 이유: 고궁 낮은 여태 **값 0인 기본**이었다. 아무도 코인을 낸 적이 없고
--    (`user_cosmetics` 에 산 기록이 없다), 그 사람들이 고궁 낮을 '고른' 것도 아니다 — 기본이라
--    그냥 입고 있었을 뿐이다. 그래서 새 기본으로 옮기는 게 원래 상태 그대로다.
--    ⛔ 반대로 **산 기록(`user_cosmetics`)이 있으면 그 사람은 안 옮긴다** — 그건 기본이라 입고
--       있던 게 아니라 고른 것이다. 소유가 있으니 값이 붙어도 계속 입고 벗을 수 있다.
-- ⚠️ 안 옮기면 화면이 깨지지는 않는다(모르는 값은 목록 첫 항목으로 떨어진다). 그래도 옮기는 건
--    보관함에서 **아무것도 '착용 중'으로 안 보여** 자기가 뭘 입고 있는지 화면이 말을 못 하기 때문.
-- ============================================================================

-- ── 1) 새 기본: 초원 ────────────────────────────────────────────────────────
-- ⚠️ active=false = **비판매**. 상점(`get-hub` 은 active 만 내려준다)에는 안 뜨고 보관함에만 뜬다
--    (화면이 기본 스킨을 늘 보관함에 넣는다 — Hub.tsx 의 `ownedSkins`).
-- ⚠️ **값은 반드시 0이어야 한다.** 아무것도 장착 안 한 사람과 모르는 값이 저장된 사람이 전부
--    목록 첫 항목으로 떨어지는데(`skinByPart`), 거기에 값을 매기면 신규 회원 화면에 배경이 없다.
insert into shop_catalog (part_key, price, kind, sort_order, active) values
  ('skin_meadow', 0, 'skin', 90, false)
on conflict (part_key) do update
  set price = 0, kind = 'skin', active = false;

-- ── 2) 고궁 낮 = 판매 스킨 ──────────────────────────────────────────────────
-- 300 은 시작값이다 — 관리자 화면(WORLD ARENA > 꾸미기 관리)에서 바꿀 수 있다.
update shop_catalog
   set price = 300, active = true, sort_order = 100
 where part_key = 'skin_palace_day';

-- 혹시 행이 없던 환경(옛 스냅샷)에서도 같은 상태가 되게.
insert into shop_catalog (part_key, price, kind, sort_order, active) values
  ('skin_palace_day', 300, 'skin', 100, true)
on conflict (part_key) do nothing;

-- ── 3) 고궁 낮을 '기본으로서' 입고 있던 사람을 초원으로 ──────────────────────
-- ⚠️ 산 기록이 있는 사람은 건드리지 않는다 — 그건 고른 것이다.
update user_characters uc
   set equipped   = equipped || jsonb_build_object('skin', 'skin_meadow'),
       updated_at = now()
 where equipped->>'skin' = 'skin_palace_day'
   and not exists (
     select 1 from user_cosmetics c
      where c.user_id = uc.user_id and c.part_key = 'skin_palace_day'
   );
