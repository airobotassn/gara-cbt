-- 뽑기(가챠) 제거 — 기능·데이터·실행경로를 통째로 걷어낸다(2026-08-18 결정).
--
-- 왜
--   허브의 재화 흐름을 **코인 하나**로 줄인다. 가루(dust)는 뽑기 중복 환급으로만 생기고
--   쓸 곳도 뽑기 전용 한정템뿐이라, 뽑기가 사라지면 벌 수도 쓸 수도 없는 죽은 지갑이 된다.
--   그래서 확률·천장·가루·교환소를 한 번에 없앤다(반쯤 남기면 "왜 안 늘지" 를 아무도 못 푼다).
--
-- 되돌릴 수 없다
--   뽑기 이력(gacha_log)·교환 이력(dust_exchange)·가루 잔액(user_currency.dust)이 여기서 사라진다.
--   되살리려면 20260714000500 · 20260716120000 · 20260716130000 을 다시 실행해야 하고,
--   그래도 옛 잔액·이력은 돌아오지 않는다.
--
-- ⚠️ 소유(user_cosmetics)는 건드리지 않는다 — 뽑기로 받았든 상점에서 샀든 이미 가진 물건이다.
--   예외는 아래 한정 가구 2종뿐이고, 그건 '얻을 길이 없어진 물건' 이라 화면에서 함께 지운다.

-- ── (1) 뽑기 전용 한정 가구 2종 정리 ────────────────────────────────────────
-- 어항·네온은 상점에 없고(active=false) 뽑기·가루 교환으로만 나왔다. 뽑기가 사라지면
-- 새로 얻을 길이 통째로 없어지므로 카탈로그에서 뺀다.
--   ⚠️ 순서가 곧 정확성이다 — 방 배치 → 소유 → 카탈로그.
--     반대로 지우면 카탈로그에 없는 part_key 가 방 슬롯에 남아, 화면이 "이름도 그림도 없는 물건"을
--     그린다(get-hub 의 furniture 목록이 shop_catalog 라서 면조차 모른다).
update user_rooms
   set slots = (
         select coalesce(jsonb_object_agg(k, v), '{}'::jsonb)
           from jsonb_each_text(slots) as e(k, v)
          where v not in ('fur_aquarium_01', 'fur_neon_01')
       ),
       updated_at = now()
 where slots::text like '%fur_aquarium_01%'
    or slots::text like '%fur_neon_01%';
--   ⚠️ 여기서 `slots ?| array[...]` 를 쓰면 안 된다 — `?|` 는 **키**를 보는데 슬롯 배치는
--     {슬롯키: 가구키} 라 가구는 값 쪽에 있다. 키로 물으면 한 행도 안 걸려 조용히 지나간다.

delete from user_cosmetics where part_key in ('fur_aquarium_01', 'fur_neon_01');
delete from shop_catalog   where part_key in ('fur_aquarium_01', 'fur_neon_01');

-- ── (2) 실행 경로부터 끊는다 ────────────────────────────────────────────────
-- 함수를 먼저 지워야 이 마이그레이션 도중에 들어온 요청이 이미 없는 표를 건드리지 않는다.
drop function if exists gacha_draw(uuid, text, text);
drop function if exists gacha_exchange(uuid, text, text);

-- ── (3) 표 ─────────────────────────────────────────────────────────────────
drop table if exists gacha_log;
drop table if exists dust_exchange;
drop table if exists user_gacha_pity;
drop table if exists gacha_exclusive;
drop table if exists gacha_pool;

-- ── (4) 가루 지갑 ──────────────────────────────────────────────────────────
alter table user_currency drop column if exists dust;
