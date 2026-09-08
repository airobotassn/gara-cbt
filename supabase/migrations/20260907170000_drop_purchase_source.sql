-- 2026-09-07 · 죽은 칸 제거 — ebook_purchases.source · lecture_purchases.source (2026-09-07 지시)
--
--   ⛔ **함수 배포가 끝난 뒤에 적용할 것** (payments · ebooks · admin).
--      아직 도는 옛 코드가 insert 문에 source 를 실어 보내므로, 먼저 지우면 PostgREST 가
--      "column not found" 로 400 을 내고 **이북·강의 지급이 통째로 막힌다**(결제는 되고 물건이 안 나간다).
--
--   왜 지우나 — 이 칸이 들고 있던 정보가 전부 다른 데 있거나, 아무도 안 쓴다:
--     · 'pg'(7건)   = 결제로 산 것. `payment_id is not null` 과 **정확히 1:1** 이라 군더더기다(실측 대조).
--     · 'free'(42건) = 0원이라 결제창을 안 타고 그 자리에서 지급된 것.
--     · 'demo'(11건) = 옛 데모 시절 유물. **지금 코드는 이 값을 쓰지 않는다** — 컬럼 default 로만 남아 있었다.
--   그리고 **어느 쿼리도 이 칸으로 거르지 않는다**(`.eq('source', …)` 0곳). 관리자 구매자 목록이
--   글자로 찍기만 했고, free 냐 demo 냐로 동작이 갈리는 자리는 없다.
--
--   ⛔ **응시권(exam_tickets.source)은 남는다 — 이름만 같고 다른 칸이다.** 그쪽은 발급 경로를
--      (결제 / 무료 급수 / 관리자 수기)로 갈라 관리자 화면이 라벨로 보여주고, 코드가 값을 세 가지로 쓴다.
--      한꺼번에 지우지 말 것.
--
--   ⚠️ default 가 'demo' 였던 게 함정이었다 — CHECK 도 없어서, source 를 빼먹고 insert 하는 새 코드가
--      아무 경고 없이 'demo' 로 찍혔다. 칸을 없애면 그 함정도 같이 없어진다.
--
--   지우기 전 분포 (되돌릴 때 참고):
--     ebook_purchases    free 42 · demo 11 · pg 7   (pg 7건 = payment_id 있는 7건과 동일)
--     lecture_purchases  free 10

begin;

alter table ebook_purchases   drop column if exists source;
alter table lecture_purchases drop column if exists source;

-- 검산 — pg 로 표시됐던 것들이 payment_id 로 그대로 식별되는지(정보가 안 사라졌는지).
do $$
declare n int;
begin
  select count(*) into n from ebook_purchases where payment_id is not null;
  if n <> 7 then
    raise exception '결제로 산 이북이 %건이다 — 7건이어야 한다(source=pg 였던 수)', n;
  end if;
end $$;

commit;
