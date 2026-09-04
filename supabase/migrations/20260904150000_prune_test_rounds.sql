-- 2026-09-04 · 테스트 회차 3개 정리 (2026-09-04 지시)
--   남길 것 = 제 0회 CARIS [구성원 테스트](9/30) · 2026년 11월 정기시험(11/20).
--   지울 것 = 제 1회(7/18) · 제 2회(8/15) · 2026년 8월 정기시험(8/20) — 전부 테스트로 만든 회차다.
--
--   ⚠️ 제 2회에는 실제 토스 결제 1건(안형준 · 1,500원 · 2026-08-06 승인)이 붙어 있었는데
--      **테스트 결제이고 실결제가 아니라는 확인을 받았다.** 그래서 payments 행까지 같이 지운다 —
--      응시권만 지우고 결제 행을 남기면 대사(reconcile)가 "paid 인데 미지급"으로 영원히 잡는다.
--      되돌릴 일이 있으면 backup/20260904/payments.json 에 지우기 전 113행이 그대로 있다.
--
--   FK 는 대부분 NO ACTION 이라 자식부터 지운다(응시권 → 시험 → 회차).
--   exam_questions 는 exams 에 CASCADE 라 시험을 지우면 출제 세트가 같이 빠진다.
--   지우는 회차에 걸린 응시(exam_attempts)는 0건이라 응시기록·답안은 손대지 않는다.

begin;

create temp table _dead_rounds(id uuid) on commit drop;
insert into _dead_rounds(id) values
  ('e721d465-d6d8-4b20-b13e-d5dac2e7c67b'),  -- 제 1회 CARIS (7/18) — 딸린 것 없음
  ('36e08883-9e4e-42f3-86e0-2e95647580e5'),  -- 제 2회 CARIS (8/15) — 시험1·출제40·응시권1
  ('b88f980c-d454-4c7a-8a70-e24370bef4f6');  -- 2026년 8월 정기시험 (8/20) — 시험3·문항 0

-- 안전장치: 응시 기록이 걸린 회차가 섞였으면 통째로 멈춘다(테스트 회차만 지우는 게 전제다)
do $$
declare n int;
begin
  select count(*) into n from exam_attempts a where a.round_id in (select id from _dead_rounds);
  if n > 0 then raise exception '응시 기록이 있는 회차가 섞였다 (%건) — 중단', n; end if;
end $$;

-- ⚠️ 순서 주의: exam_tickets.payment_id → payments 로 FK 가 걸려 있어서 **응시권을 먼저** 지운다.
--    결제 행부터 지우면 23503 으로 통째로 막힌다(실제로 그렇게 한 번 막혔다).
create temp table _dead_payments(id uuid) on commit drop;
insert into _dead_payments(id)
  select t.payment_id from exam_tickets t
   where t.round_id in (select id from _dead_rounds) and t.payment_id is not null;

delete from exam_tickets where round_id in (select id from _dead_rounds);

-- 그 응시권에 딸려 있던 결제 행 (테스트 결제)
delete from payment_items where payment_id in (select id from _dead_payments);
delete from payments      where id         in (select id from _dead_payments);
delete from exams        where round_id in (select id from _dead_rounds);  -- exam_questions CASCADE
delete from exam_rounds  where id       in (select id from _dead_rounds);

commit;
