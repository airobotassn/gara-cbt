-- 결제 웹훅 수신 원장 (2026-09-14)
--
-- 왜 표를 파나 — payments-webhook 은 PG(엑심베이 status_url)가 서버-서버로 부르는 유일한 통지 경로인데,
-- 본문이 어떤 모양으로 오는지(JSON/폼 · 칸 이름) 문서에 없어서 코드가 **짐작으로** 식별자를 꺼낸다.
-- 짐작이 틀리면 통지를 "못 읽는 이벤트" 로 200 을 주고 조용히 버린다 — 창을 닫고 나간 사람의 결제를 영영 모른다.
-- 함수 로그는 며칠이면 사라져(8월 테스트 결제의 로그가 이미 없다) 되짚을 수가 없었다.
-- 그래서 **받은 본문을 통째로** 여기 남긴다. 못 읽은 통지도 버리지 않고 남긴다(outcome 으로 표시).
--
-- 📌 대사(reconcile)와는 무관하다. 대사는 payments 함수의 reconcile 액션을 크론이 부르기만 하면 되고(Spring 이관 시
--    거기 크론), 이 표는 손댈 게 없다. 이 표는 "PG 가 우리에게 무엇을 보냈나" 의 증거이고, 대사는 "우리 원장과 PG 가
--    맞나" 의 확인이다 — 둘은 다른 질문이다.
-- ⚠️ 판정에는 쓰지 않는다. 결제 상태의 정본은 여전히 PG 재조회(resettle)다. 이 표는 읽어보는 용도뿐이다.

create table if not exists public.payment_webhook_events (
  id           uuid primary key default gen_random_uuid(),
  received_at  timestamptz not null default now(),
  provider     text not null default 'eximbay',
  -- 본문에서 꺼낸 식별자(못 꺼냈으면 null). 원장 행과 잇는 열쇠.
  order_id     text,
  payment_key  text,
  -- 받은 그대로. content-type 과 본문 원문(8KB 상한 — 통지 본문은 이보다 훨씬 작다).
  content_type text,
  raw          text not null,
  -- 처리 결과: settled(재조회까지 감) · no_identifier(식별자 못 찾음) · unknown_order(우리 원장에 없음)
  --            · retired_provider · permanent_error · error · forbidden(시크릿 불일치)
  outcome      text not null,
  -- 재조회 결과나 오류 문구 — 사람이 읽는 칸.
  note         text
);

-- RLS 켜고 정책 없음 = service role(엣지 함수) 전용. 결제 계열 표의 관례.
alter table public.payment_webhook_events enable row level security;

create index if not exists payment_webhook_events_order_idx on public.payment_webhook_events (order_id, received_at desc);
create index if not exists payment_webhook_events_received_idx on public.payment_webhook_events (received_at desc);

comment on table public.payment_webhook_events is
  'PG 결제 통지(status_url) 수신 원장 — 본문 원문과 처리 결과. 판정에 쓰지 않고 되짚는 용도.';
