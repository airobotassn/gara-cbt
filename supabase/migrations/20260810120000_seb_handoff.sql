-- SEB 세션 인계 — 일반 브라우저의 로그인을 SEB(잠금 브라우저) 안으로 넘기는 **일회용 표**.
--
-- 왜 필요한가: SEB 는 별도 브라우저 프로필로 열려 세션이 없고, 그 안에서는 구글 로그인도 불가능하다
--   (SEB 가 외부 사이트를 막고, 구글도 이런 브라우저를 거부한다). 그래서 SEB 를 켜기 전에
--   "이 사람이 이 응시권으로 응시한다"는 표를 하나 쥐어줘야 한다.
--
-- 왜 여기 담는 값이 nonce 인가(시험 토큰을 바로 주면 안 되는 이유):
--   표는 SEB 실행 링크의 쿼리스트링을 타고 startURL 로 넘어간다(SEB 설정 startURLAppendQueryParameter).
--   즉 **주소창·Cloudflare/Supabase 접속 로그에 남는다.** 거기 남는 값이 몇 시간짜리 인증수단이면
--   로그를 볼 수 있는 사람이 그 시간 내내 남의 응시로 들어갈 수 있다. 그래서 주소에 싣는 건
--   **수 분짜리 1회용 nonce** 로 두고, 그걸 SEB 안에서 시험 전용 토큰으로 바꾼다(seb-handoff).
--
-- ⚠️ RLS 켜고 정책 0개 = service role(엣지 함수) 전용. chat_* 테이블과 같은 관례다.
-- ⚠️ nonce 원문은 저장하지 않는다(해시만). DB 가 통째로 새어도 그것만으로는 응시로 못 들어간다.
create table if not exists public.seb_handoff (
  id uuid primary key default gen_random_uuid(),
  -- sha256(nonce) 16진수. unique 라 같은 nonce 가 두 행이 될 수 없다.
  nonce_hash text not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- 어느 응시권으로 들어갈지까지 표에 박는다 — 토큰이 새어도 **그 응시권 하나** 밖으로 못 나간다.
  ticket_id uuid not null references public.exam_tickets(id) on delete cascade,
  expires_at timestamptz not null,
  -- 소비 시각. 이 컬럼이 null 인 행만 교환 가능 = 1회용의 본체(조건부 UPDATE 한 문장으로 원자 소비).
  redeemed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.seb_handoff enable row level security;

-- 만료분 청소(lazy delete)가 훑는 컬럼. 크론은 만들지 않는 게 이 저장소 관례라 발급 시점에 쓸어낸다.
create index if not exists seb_handoff_expires_idx on public.seb_handoff (expires_at);
