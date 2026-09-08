-- 2026-09-07 · 죽은 칸 ebooks.price 제거 (2026-09-07 지시)
--
--   2026-08-13 에 정가를 **원화 정수 → 달러 센트**로 갈아탔다(엑심베이 단일 PG · 정가 한 벌 = 달러).
--   그때 새 칸 `price_usd_cents` 를 만들고 옛 칸은 그냥 뒀다 — 읽는 코드가 그날로 0곳이 됐는데
--   (`_shared/payments.ts` 의 `resolveProduct` 주석: "옛 price(원화 정수)는 읽지 않는다")
--   10행에 1500·3000·4500 이 그대로 남아서, DB 를 열어본 사람에게는 **이게 정가로 보인다.**
--
--   ⚠️ 배포가 필요 없다 — 이 칸을 select 하는 자리도 insert/update 에 넣는 자리도 0곳이다.
--      (확인: functions/ebooks · admin · admin/reform · _shared/payments 의 모든 select 목록에 없고,
--       admin 의 이북 등록/수정이 만드는 row 객체에도 없다. not null default 0 이라 빠져도 들어간다.)
--
--   ⛔ **값을 price_usd_cents 로 옮기지 않는다.** 원화 1,500 을 센트로 바꾸려면 환율 판단이 필요하고
--      그건 사람이 정할 값이다. 지금 10권이 전부 0(=무료)인 것은 **따로 정해서 채울 문제**이지
--      이 마이그레이션이 추측으로 메울 자리가 아니다.
--
--   지금 값 (지우기 전 기록):
--     CARIS Bible Beginner 1500 · Pro 3000 · Elite 4500
--     Level Up Study 1 = 0 · 2~7 = 각 1500

begin;

alter table ebooks drop column if exists price;

commit;
