-- 응시료 결제에 교재(이북)를 **함께** 담는다 — 원서접수 화면의 '추천 교재 구매'.
--   한 번의 결제로 응시권 + 교재 열람권 둘 다 나간다.
--
-- ⛔ 왜 새 상품 유형('bundle')을 만들지 않았나 — 중복결제 방어가 깨지기 때문이다.
--    응시권의 이중 결제를 실제로 막는 건 payments_paid_product_uniq(user_id, product_type, product_ref) 하나다
--    (exam_tickets_live_uniq 는 지급 단계라 그때는 돈이 이미 빠진 뒤 = 환불거리).
--    번들을 별도 타입으로 두면 같은 (회차×급수)를 'exam' 으로 한 번, 'bundle' 로 또 한 번 결제할 수 있다.
--    교재를 **곁다리(addon)** 로 달면 product_type/product_ref 가 그대로라 그 방어가 손대지 않은 채 유지된다.
--
-- amount(정가)는 **응시료 + 교재 합계**이고, 그중 교재 몫을 addon_amount 에 따로 적는다.
--   합계만 남기면 원장이 "$2 를 받았다"까지만 말하고 무엇을 팔았는지는 못 말한다.
alter table public.payments
  add column if not exists addon_ebook_id uuid references public.ebooks(id) on delete set null,
  add column if not exists addon_amount integer;

comment on column public.payments.addon_ebook_id is
  '함께 산 교재(이북). 응시료 결제에만 붙는다. 책이 삭제되면 null 이 되지만 order_name 에 제목이 남는다.';
comment on column public.payments.addon_amount is
  '위 교재의 정가(달러 센트). amount 에 이미 포함돼 있다 — 청구액이 아니라 내역 표시·대사용.';

-- 곁다리는 응시료에만 붙는다. 이북 결제에 또 이북을 다는 모양은 없다(그건 그냥 두 건이다).
-- 금액을 안 적고 책만 다는 것도 막는다 — 원장에서 그 책이 얼마였는지 영영 알 수 없어진다.
alter table public.payments drop constraint if exists payments_addon_exam_only;
alter table public.payments add constraint payments_addon_exam_only
  check (
    addon_ebook_id is null
    or (product_type = 'exam' and addon_amount is not null and addon_amount >= 0)
  );

-- 환불 회수·대사가 "이 결제로 나간 교재"를 찾을 때 쓴다(ebook_purchases.payment_id 로 역추적한다).
create index if not exists payments_addon_ebook_idx on public.payments (addon_ebook_id)
  where addon_ebook_id is not null;
