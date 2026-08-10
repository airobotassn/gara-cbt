-- ============================================================
-- 결제 승인 선점 상태(confirming) — 같은 상품에 동시 승인 두 발이 **둘 다 PG 로 나가는** 구멍을 막는다.
--
-- 무엇이 뚫려 있었나:
--   주문(payments)은 status='pending' 으로 생기고, 중복 방어 유니크는 status='paid' 에만 걸린다.
--   그래서 같은 상품으로 pending 주문을 두 개 만들 수 있고(결제창 두 개), **정확히 동시에** 승인을 누르면
--   두 요청이 나란히 "완료된 결제 없음"을 보고 통과한다 → 토스가 두 건 다 승인 → **돈이 두 번 빠진다.**
--   두 번째는 우리 DB 유니크에서만 터져서 대사 목록에 남고, 환불은 사람이 해야 한다.
--   (승인 전 중복검사만으로는 못 막는다 — 검사와 승인 사이에 트랜잭션이 없다.)
--
-- 어떻게 막나:
--   PG 를 부르기 **전에** 주문을 'confirming' 으로 선점한다. 선점은 아래 부분 유니크가 상품 단위로 막으므로
--   같은 (사람 × 상품)에 대해 한 번에 하나만 PG 로 나간다. 진 쪽은 돈이 아예 안 빠진다.
--
-- ⚠️ 'confirming' 은 **일시 상태**다. 선점만 하고 죽으면 행이 여기 남는데,
--    그건 대사(reconcile)가 미완결 대상에 포함해서 PG 에 다시 물어 수렴시킨다.
--    코드 쪽에서 findUnsettled·failPending·expirePending 이 이 상태를 같이 다루도록 되어 있어야 한다.
-- ⚠️ 기존 payments_paid_product_uniq 는 **건드리지 않는다.** 그건 '완료된 결제'의 중복을 막는 것이고
--    이건 '진행 중인 승인'의 중복을 막는 것이라 목적이 다르다. 둘 다 필요하다.
--
-- 멱등(재실행 안전).
-- ============================================================

-- 상태 목록에 confirming 추가.
alter table public.payments drop constraint if exists payments_status_check;
alter table public.payments add constraint payments_status_check
  check (status in ('pending', 'confirming', 'waiting_deposit', 'paid',
                    'canceled', 'refunded', 'failed', 'expired'));

-- 같은 사람이 같은 상품을 동시에 두 번 승인하러 갈 수 없다.
create unique index if not exists payments_confirming_product_uniq
  on public.payments (user_id, product_type, product_ref)
  where status = 'confirming';

comment on index public.payments_confirming_product_uniq is
  'PG 승인 선점. 같은 (사람×상품)에 동시 승인이 두 건 나가는 것을 막는다 — 진 쪽은 결제 자체가 시작되지 않는다.';

-- 선점만 하고 끊긴 주문을 대사가 빨리 찾도록. payments_unsettled_idx 와 같은 성격.
create index if not exists payments_confirming_idx
  on public.payments (created_at) where status = 'confirming';
