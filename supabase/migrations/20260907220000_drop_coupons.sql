-- 2026-09-07 · 쿠폰 제거 — 쓸 방법이 없는 쿠폰이 계속 쌓이고 있었다 (2026-09-07 지시)
--
--   레벨을 처음 올릴 때마다 `LEVELUP10`(10% 할인) 쿠폰이 자동 발급됐다. 10명에게 14장 나갔다.
--   그런데 **쓸 길이 어디에도 없었다**:
--     · 허브의 쿠폰함을 여는 버튼이 **주석 처리**돼 있었다("쿠폰 복구 시: … 버튼 추가")
--     · 결제 화면에 쿠폰 입력칸이 없다
--     · 할인을 적용하는 코드도, 사용 처리(`used_at`)를 하는 코드도 **0곳**
--   그래서 14장 전부 `used_at` null · `payment_id` null 이었고, 앞으로도 영원히 그랬을 것이다.
--
--   ⛔ **되살릴 거면 쓰는 길(결제 할인 + 사용 처리)을 같이** 만들 것. 발급만 되살리면 같은 상태다.
--
--   ⚠️ `user_coupons` 를 먼저 지운다 — `coupons(code)` 를 참조하므로 순서가 반대면 FK 로 막힌다.
--
--   ⛔ **함수·프론트 배포가 끝난 뒤에 적용할 것** (get-hub · submit-test/_shared/scoring).
--      아직 도는 옛 코드가 레벨업 때 user_coupons 에 upsert 하고 get-hub 이 select 한다 —
--      먼저 지우면 레벨업 채점과 허브 첫 로드가 PostgREST 400 으로 죽는다.
--      ⚠️ 프론트는 늦어도 안전하다: 옛 화면이 읽던 `coupons` 가 응답에서 빠지면 `?? []` 로 빈 배열이
--         되고, 쿠폰함을 여는 버튼은 원래 주석 처리라 열 수도 없었다.
--
--   지우기 전: coupons 1행(LEVELUP10 · 10% · level_first_reach) · user_coupons 14행(10명 · Lv.2~5)

begin;

drop table if exists user_coupons;
drop table if exists coupons;

commit;
