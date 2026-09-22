-- ============================================================
-- 결제창 잠금(window_open) — 같은 상품의 엑심베이 결제창이 **두 개 열리는 것**을 막는다.
--
-- 무엇이 뚫려 있었나:
--   엑심베이는 돈이 **팝업 안에서** 빠진다(토스처럼 우리 confirm 이 청구하는 구조가 아니다). 그래서 기존 방어 두 겹
--   (paid 유니크 · confirming 선점)은 전부 **돈이 빠진 뒤**에만 걸린다 — 결제 화면을 탭 두 개로 열어 팝업을 둘 다
--   띄우면 두 건 다 청구되고, 두 번째는 우리 DB 에서 '중복' 으로 접히며 환불거리가 된다.
--   승인 전 검사(agree 액션)는 "지금 paid 가 있나" 만 보는데, 첫 팝업이 결제 중인 동안엔 paid 가 아직 없어 둘 다 통과한다.
--
-- 어떻게 막나:
--   결제하기 = 팝업을 열기 직전에 이 주문을 window_open=true 로 표시하고, 아래 부분 유니크가 (사람 × 상품) 단위로
--   그 표시를 하나로 제한한다 — 두 번째 탭은 팝업이 아예 안 뜬다(409 window_open). ⛔ 동시성은 코드가 아니라
--   이 유니크가 막는다. "열린 창이 있나" 를 select 로 보고 update 하면 두 요청이 나란히 통과한다.
--   window_seen_at = 결제 화면이 마지막으로 "아직 열려 있다" 고 신호(heartbeat)한 시각. 신호가 60초 넘게 끊긴 표시는
--   다음 agree 가 청소한다(브라우저가 죽거나 모바일이 백그라운드로 가면 release 가 안 온다).
--
-- ⚠️ 표시는 status 가 pending/expired 를 벗어나는 모든 갱신에서 같이 내린다(confirm 실패·선점·settle·중복 접기).
--    안 내리면 그 사람은 그 상품을 다시 결제할 수 없다. 코드 쪽에서 그 규칙이 지켜지는지가 이 인덱스의 전제다.
-- ⚠️ fail_code 는 처음(20260806170000)부터 있다 — 여기서 새로 만들지 않는다.
--
-- 멱등(재실행 안전).
-- ============================================================

alter table public.payments add column if not exists window_open boolean not null default false;
alter table public.payments add column if not exists window_seen_at timestamptz;

comment on column public.payments.window_open is
  '이 주문의 PG 결제창이 지금 열려 있나. 결제하기(agree) 가 켜고, 창이 닫히거나(release) 상태가 종결되면 내린다.';
comment on column public.payments.window_seen_at is
  '결제 화면이 마지막으로 "창이 열려 있다" 고 신호한 시각(heartbeat). 60초 넘게 끊긴 표시는 다음 agree 가 청소한다.';

-- 같은 사람이 같은 상품의 결제창을 동시에 두 개 열 수 없다.
create unique index if not exists payments_window_product_uniq
  on public.payments (user_id, product_type, product_ref)
  where window_open;

comment on index public.payments_window_product_uniq is
  '결제창 잠금. 같은 (사람×상품)에 결제창이 두 개 열리는 것을 막는다 — 엑심베이는 팝업 안에서 청구되므로 여기가 돈이 빠지기 전 마지막 관문이다.';
