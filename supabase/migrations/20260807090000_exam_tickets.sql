-- 응시권(exam_tickets) — "결제했다"와 "응시했다" 사이를 담는 유일한 행.
--
-- 왜 새 테이블인가:
--   · payments 는 PG 원장이다. 결제 없는 권한 변동(관리자 수기 발급·단체 접수·부정 응시 회수)을 담을 수 없다.
--   · exam_attempts 는 start-exam 이 불려야 생긴다. 그래서 지금까지 "결제했지만 아직 응시 안 함" 상태를
--     표현할 행이 어디에도 없었다 — ExamGate.tsx 의 TODO 가 정확히 이 얘기다.
--   · 결제 ↔ 응시 사이에 상태를 가진 행을 하나 두고, 그 행을 **응시 자격의 단일 출처**로 삼는다.
--
-- ⚠️ 이름 주의: user_tickets 는 이미 가챠 뽑기권이다(schema.sql). 같은 'ticket' 이지만 다른 도메인이라 exam_ 로 가른다.
-- ⚠️ exam_tickets 는 RLS 정책 0개 = service role(엣지 함수) 전용. 돈·응시 자격이 걸려 있어
--    클라 직접 SELECT 금지(payments 와 동일 관례).
-- ⚠️ supabase/schema.sql 은 이미 exam_rounds·exam_fees·payments 생성문이 없어 단독 실행이 깨져 있다.
--    이번에도 손대지 않는다(그 표류는 별도 과제) — 스키마 변경은 이 마이그레이션 파일에만 있다.

-- ---------- 회차 응시 창(정기시험 11~20일) ----------
-- 왜 컬럼인가: 정기시험이 "시험일 하루"가 아니라 **11~20일 10일 창**이다
--   (2026-08 확정: 1~10일 접수 / 11~20일 시험 / 21~말일 채점).
--   exam_date 는 화면에 뜨는 대표일로 계속 쓰되, **응시 가능 판정은 이 두 컬럼이 한다.**
--   회차마다 창이 다를 수 있어야 해서(공휴일·장애 보정) 코드 상수로 박지 않는다.
alter table public.exam_rounds add column if not exists exam_start_at timestamptz;
alter table public.exam_rounds add column if not exists exam_end_at   timestamptz;

-- 기존 행 백필 — exam_date 가 속한 달의 11일 00:00:00 ~ 20일 23:59:59 **KST**.
-- ⚠️ 함정 두 개. 둘 다 조용히 9시간 어긋나는 종류다.
--   ① timestamptz 는 UTC 로 저장된다. bare date 를 그냥 `::timestamptz` 로 캐스팅하면 서버 TZ(보통 UTC)의
--      자정으로 해석돼 KST 기준 9시간이 밀린다 → 시험 첫날 오전 9시까지 응시가 안 열리고,
--      마지막 날은 다음 날 오전 9시까지 열려 있다. 그래서 무시간대 timestamp 를 만든 뒤
--      `at time zone 'Asia/Seoul'` 로 "이건 서울 벽시계 시각" 이라고 못박는다.
--   ② date_trunc 의 둘째 인자를 date 로 그냥 넘기면 timestamp / timestamptz 오버로드 사이에서
--      결과 타입이 흔들린다. timestamptz 로 잡히면 `at time zone` 이 **반대 방향**(UTC→로컬)으로 동작해
--      ①의 보정이 무의미해진다 → `::timestamp` 를 명시해 방향을 고정한다.
-- 상시(rolling) 회차는 exam_date 가 null 이고 응시권도 팔지 않기로 했으므로(2026-08 결정) 대상이 아니다.
--
-- ⚠️ **기존 데이터가 11~20 규칙을 안 지킨다.** 2026-08-06 프로덕션 확인 결과 정기 5개 중
--    제4회(시험일 10/29)·제5회(11/28)가 규칙 밖이었다. 이걸 그대로 11~20 으로 밀어넣으면
--    **시험창이 정작 시험일을 포함하지 않아** 그 회차는 아무도 응시할 수 없게 된다.
--    그래서 규칙에 맞는 회차만 11~20 으로 넓히고, 벗어난 회차는 **시험일 당일 하루**만 연다.
--    (좁게 여는 쪽이 안전하다 — 넓히는 건 관리자가 회차 편집에서 언제든 할 수 있지만,
--     열려선 안 될 날에 열린 걸 나중에 발견하는 건 되돌릴 수 없다.)
update public.exam_rounds
   set exam_start_at = case
         when extract(day from exam_date) between 11 and 20
           then (date_trunc('month', exam_date::timestamp) + interval '10 days') at time zone 'Asia/Seoul'
         else (exam_date::timestamp) at time zone 'Asia/Seoul'
       end,
       exam_end_at = case
         when extract(day from exam_date) between 11 and 20
           then (date_trunc('month', exam_date::timestamp) + interval '19 days 23 hours 59 minutes 59 seconds')
                  at time zone 'Asia/Seoul'
         else (exam_date::timestamp + interval '23 hours 59 minutes 59 seconds') at time zone 'Asia/Seoul'
       end
 where exam_date is not null
   -- 재실행이 관리자가 손으로 조정한 창을 되돌리면 안 된다(exam_fees 시드와 같은 규칙).
   and (exam_start_at is null or exam_end_at is null);

-- ---------- 접수창(apply_*) 옛 UTC 값 보정 ----------
-- 옛 Admin.tsx 는 오프셋 없이 `2026-11-30T23:59:59` 를 저장했고, timestamptz 는 그걸 세션 TZ(UTC)로
-- 읽어버려 KST 기준 **9시간 뒤**로 밀려 있다. 지금까지는 표시용이라 티가 안 났는데,
-- 이번에 applyWindowOpen 이 **결제 게이트**로 승격돼서(_shared/exam-tickets.ts) 그대로 두면
-- 접수 마감 다음날 오전 8시 59분까지 결제가 계속 뚫린다.
--
-- 옛 포맷 판별: KST 로 저장된 행은 UTC 로 15:00:00 / 14:59:59 로 찍힌다(=KST 00:00 / 23:59:59).
-- 반대로 UTC 자정·23:59:59 로 찍힌 행이 보정 대상이다. 이 두 시각은 KST 저장에서는 나올 수 없다.
update public.exam_rounds
   set apply_start_at = apply_start_at - interval '9 hours'
 where apply_start_at is not null
   and (apply_start_at at time zone 'UTC')::time = time '00:00:00';

update public.exam_rounds
   set apply_end_at = apply_end_at - interval '9 hours'
 where apply_end_at is not null
   and (apply_end_at at time zone 'UTC')::time = time '23:59:59';

-- ---------- 급수 레지스트리 ----------
-- 왜 테이블인가: 응시료 키는 `${트랙}_${티어}`(t1_pro — 20260806180000)인데 exams.tier 는 트랙 없는 'pro' 다.
--   서버(Deno)는 src/lib/caris.ts 를 못 읽어서 supabase/functions 전체에 't1'·'t2' 문자열이 0건이다
--   = 서버가 응시료 키를 스스로 조립할 방법이 아예 없다. 프론트 상수를 _shared 에 복제하면 동기화 페어가
--   하나 더 늘어난다(CLAUDE.md 가 이미 scoring·categories 두 벌을 관리 중) → 양쪽이 같이 읽는 DB 에 두는 게 싸다.
-- 덤: exams.tier 에는 CHECK 이 없어(schema.sql) 오타 티어가 들어가도 조용히 통과하고 요금 조회만 실패한다.
--   응시권은 여기에 FK 를 걸어 그 경로를 아예 막는다.
create table if not exists public.exam_tiers (
  tier  text primary key,                            -- beginner|pro|elite|master|grandmaster|zenith (caris.ts 티어 key)
  track text not null check (track in ('t1','t2')),  -- 응시료 키 접두사(fees.ts 의 feeKey())
  sort  int  not null default 0
);

-- 티어 이름·순서는 관리자가 화면에서 고치는 값이 아니라 코드(caris.ts)와 짝인 고정 목록이라
-- 여기서 시드한다. do nothing = 재실행이 sort 조정을 되돌리지 않는다.
insert into public.exam_tiers (tier, track, sort) values
  ('beginner','t1',10), ('pro','t1',20), ('elite','t1',30),
  ('master','t2',40), ('grandmaster','t2',50), ('zenith','t2',60)
on conflict (tier) do nothing;

alter table public.exam_tiers enable row level security;
-- 티어 키·트랙은 비밀이 아니고 exam_fees 도 이미 공개 read 다. 화면이 정렬 기준으로 쓸 수 있게 열어둔다.
drop policy if exists exam_tiers_public_read on public.exam_tiers;
create policy exam_tiers_public_read on public.exam_tiers for select using (true);

-- ---------- 회차가 연 급수(공개 노출용) ----------
-- 왜 비정규화하나: exams 는 RLS 정책 0개(schema.sql)라 프론트가 못 읽는다. 그래서 ExamApply 는 회차와
--   무관하게 6개 티어를 전부 판다 → 결제는 성공하고 start-exam 은 '해당 회차의 시험이 준비되지 않았습니다'
--   400 을 뱉는 조합이 자연스럽게 발생한다. 티어 키는 비밀이 아니므로, 이미 공개 read 가 열려 있는
--   exam_rounds 에 얹는 게 가장 싸다.
-- ⚠️ 쓰는 곳은 admin 함수의 syncRoundExams 한 곳뿐이다(exams 행을 만드는 유일한 코드).
--    **판매 가능 판정의 정본은 계속 서버(resolveExamOffer)** 이고 이 컬럼은 화면 표시용이다 — 어긋나도 돈은 안 샌다.
alter table public.exam_rounds add column if not exists open_tiers text[] not null default '{}'::text[];

update public.exam_rounds r set open_tiers = coalesce((
  select array_agg(e.tier order by t.sort)
  from public.exams e
  join public.exam_tiers t on t.tier = e.tier
  where e.round_id = r.id and e.active and e.tier is not null
), '{}'::text[])
where r.open_tiers = '{}'::text[];   -- 이미 채워진 회차는 건너뛴다(재실행 안전)

-- ---------- 응시권 ----------
create table if not exists public.exam_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,

  -- 귀속 단위가 (회차 × 급수)인 이유:
  --   관리자가 회차 편집에서 급수를 해제하면, 문항·응시가 0건인 exams 행은 **실제로 DELETE 된다**
  --   (admin/index.ts 의 syncRoundExams). 응시권을 판 직후가 정확히 그 '응시 0건' 구간이다 —
  --   exams.id 로 묶으면 체크박스 한 번에, 팔린 응시권이 존재하지 않는 시험을 가리키게 된다.
  --   (round_id, tier) 는 exams 의 unique 키(schema.sql)이자 slug 규칙 `r-<round>-<tier>` 의 원재료라,
  --   exams 행이 지워졌다 다시 생겨도 같은 시험을 계속 가리킨다.
  -- FK 를 ON DELETE 없이(기본 NO ACTION) 두는 것도 의도다 — 팔린 응시권이 있는 회차 삭제가 DB 에서 막힌다.
  round_id uuid not null references public.exam_rounds(id),
  tier     text not null references public.exam_tiers(tier),

  -- issued  : 발급됨(미사용)
  -- consumed: 응시에 사용됨. 어느 응시인지는 exam_attempts.ticket_id 가 가리킨다.
  -- void    : 환불·부정·관리자 회수로 무효화
  -- expired : 회차가 끝나도록 안 씀(조회 시점 lazy 판정 — 크론 없음)
  status text not null default 'issued'
    check (status in ('issued','consumed','void','expired')),

  -- 결제 없는 응시권이 존재할 수 있어서 payment_id 는 nullable 이다.
  --   pg=PG 결제 / admin=관리자 수기 발급(단체 접수·시험 당일 장애 보상) / free=0원 정가(무료 개방·쿠폰)
  -- 대사(reconcile)는 source='pg' 인 행만 결제와 대조한다.
  source text not null default 'pg' check (source in ('pg','admin','free')),
  payment_id uuid references public.payments(id),

  price_paid integer not null default 0,   -- 발급 시점 금액 스냅샷. exam_fees 는 관리자가 언제든 고치므로 나중에 역산이 안 된다.
  granted_by text,                         -- 수기 발급·회수한 관리자 이메일. 회차·응시료 변경엔 로그가 아예 없어서 분쟁 시 추적할 게 이것뿐이다.
  note text,

  -- 만료 override. **null = 회차의 exam_end_at 이 만료를 정한다**(정상 경로는 전부 null).
  -- 상시(rolling) 회차는 응시권을 팔지 않기로 해서 '무기한' 경로 자체가 존재하지 않는다.
  -- ⚠️ 회차 시험창을 여기에 복사해두지 않는다 — 관리자가 일정을 바꾸면 두 값이 갈린다.
  --    이 컬럼은 수기 발급(장애 보상 응시권 등)에서만 쓰는 예외다.
  expires_at timestamptz,

  issued_at   timestamptz not null default now(),
  consumed_at timestamptz,
  voided_at   timestamptz,
  void_reason text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
  -- attempt_id 를 일부러 두지 않았다. exam_attempts.ticket_id 하나로 충분하고(그쪽에 '살아있는 응시 1개'
  -- 부분 유니크가 걸린다), 양방향 참조는 한쪽만 갱신 실패했을 때 조용히 갈린다.
);

alter table public.exam_tickets enable row level security;
-- 정책을 만들지 않는다 = service role 전용. 클라는 my-attempts / admin 함수를 통해서만 본다.

-- ⚠️ 중복 발급 방어의 본체 두 개. 코드가 아니라 여기서 막는다 —
--    grant 를 부르는 경로가 승인(confirm) · 웹훅 · 대사(reconcile) 셋이고 셋 다 동시에 올 수 있다.

-- ① 결제 1건 = 응시권 1장.
--    settleFromToss 는 "지급 먼저, fulfilled_at 나중" 이라 같은 결제로 grant 가 두 번 불릴 수 있다.
--    두 번째 insert 가 23505 로 튕겨야 코드가 '이미 지급'으로 접을 수 있다(ebook_purchases 와 같은 패턴).
create unique index if not exists exam_tickets_payment_uniq
  on public.exam_tickets (payment_id) where payment_id is not null;

-- ② 한 사람이 같은 회차·급수에 살아있는 응시권을 두 장 가질 수 없다.
--    payments_paid_product_uniq 는 '결제'만 막는다 — 수기 발급·무료 지급은 payments 를 안 타므로
--    여기가 없으면 그대로 뚫린다.
-- ⚠️ void/expired 는 이 인덱스 대상에서 빠진다 = 그 순간 재구매가 열린다.
--    payments_paid_product_uniq 가 status='paid' 에서만 걸리는 것과 모양은 같지만 **자동으로 맞물리지는
--    않는다**: 환불은 웹훅이 payments 를 refunded 로 눕히는 반면, 응시권 void 는 자동이 아니다
--    (환불 자동 회수 안 함 = 운영 방침. 대사가 목록으로 뱉고 사람이 처리).
--    그래서 "환불됐는데 응시권은 issued" 구간이 실제로 생긴다 — 이 구멍은 스키마가 아니라 코드가 메운다:
--    start-exam 이 source='pg' 응시권에 대해 연결된 payments.status='paid' 를 같이 확인해야 한다.
create unique index if not exists exam_tickets_live_uniq
  on public.exam_tickets (user_id, round_id, tier) where status in ('issued','consumed');

create index if not exists exam_tickets_user_idx  on public.exam_tickets (user_id, status);
create index if not exists exam_tickets_round_idx on public.exam_tickets (round_id, tier, status);
-- payment_id 단독 조회용 인덱스는 따로 만들지 않는다 — 위 exam_tickets_payment_uniq 가
-- `where payment_id is not null` 부분 인덱스라 `payment_id = $1` 조회를 그대로 탄다(술어가 함의된다).

-- ---------- 응시 ↔ 응시권 연결 ----------
-- 두 가지를 동시에 푼다.
--   · 추적: 환불 회수 때 "이 응시가 어느 응시권에서 나왔나"를 사람이 볼 수 있다.
--   · 이중 응시 잠금: 1인1회가 지금은 코드 검사뿐이라(20260629140000 이 '의도적'이라고 적어뒀다)
--     동시 요청 두 개면 응시가 두 개 난다. 결제 쪽은 유니크로 막았는데 응시 쪽만 코드인 비대칭을 없앤다.
alter table public.exam_attempts add column if not exists ticket_id uuid references public.exam_tickets(id);

-- ⛔ **응시권 1장 = 응시 1개.** 상태를 가리지 않는다.
--    처음엔 `status in ('in_progress','submitted')` 로 두려 했는데, 그러면 제출만 안 하고 나갔다가
--    TTL(240분) 뒤 재진입할 때 옛 응시를 expired 로 눕히고 **같은 응시권으로 새 응시를 또 만들 수 있다.**
--    시험창이 10일이라 4시간 주기로 무한 반복이 되고, 문항 세트는 고정이라 문제를 다 본 뒤
--    마지막 1회만 제출하면 제한시간·1인1회가 둘 다 무의미해진다(2026-08-06 검증에서 실제로 잡힘).
--    그래서 상태 필터를 빼고 **DB 가** 강제한다 — 재진입은 '새로 만들기'가 아니라 '그 응시로 돌아가기'여야 한다.
create unique index if not exists exam_attempts_ticket_live_uniq
  on public.exam_attempts (ticket_id)
  where ticket_id is not null;
create index if not exists exam_attempts_ticket_idx on public.exam_attempts (ticket_id);
