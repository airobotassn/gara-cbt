-- 관리자페이지 재편(PPT `관리자 페이지 수정사항`)이 요구하는 신규 테이블 묶음 — 2026-08-11.
--   전부 **함수 전용**이다(RLS 정책을 주지 않는다 = service role 만 접근). 관리자 화면은 `admin` 함수를 통해서만 읽고 쓴다.
--   공개 조회가 필요한 것(사이트 정보·팝업·정책 문서)은 별도의 읽기 전용 정책을 아래에서 따로 준다.

-- ─────────────────────────────────────────────────────────────
-- 1) 접속 기록 — "오늘 접속자 · 휴면 회원" 의 유일한 출처
--    ⚠️ 로그인 사용자만 센다. 비로그인 방문자는 대상이 아니다(그건 GA 영역).
--    ⚠️ 하루 1회만 갱신한다 — 매 요청마다 UPDATE 하면 접속자 수만큼 쓰기가 발생한다.
--       그래서 이력 테이블이 아니라 profiles 의 컬럼 하나다.
-- ─────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists last_seen_at timestamptz;
create index if not exists profiles_last_seen_idx on public.profiles (last_seen_at desc);

-- ─────────────────────────────────────────────────────────────
-- 2) 시스템 알림 — 모니터링/로깅이 웹훅으로 밀어넣고, 우리가 자체 계산한 것도 같이 쌓는다.
--    ⚠️ `status` 가 없으면 한 번 뜬 알림이 영구히 남아 아무도 안 보게 된다.
--    ⚠️ `dedupe_key` 로 같은 사건의 중복 적재를 막는다 — 자체 계산 알림은 매번 다시 계산되므로
--       키가 없으면 새로고침할 때마다 같은 알림이 쌓인다.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.system_alerts (
  id uuid primary key default gen_random_uuid(),
  occurred_at timestamptz not null default now(),
  severity text not null default 'info' check (severity in ('info', 'warn', 'error')),
  source text not null,                 -- 'payments' | 'grading' | 'monitor' 등 자유 문자열
  message text not null,
  link text,                            -- 관리자 화면 딥링크(있으면 클릭해서 바로 이동)
  status text not null default 'open' check (status in ('open', 'ack', 'resolved')),
  dedupe_key text,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz
);
create unique index if not exists system_alerts_dedupe_uniq
  on public.system_alerts (dedupe_key) where dedupe_key is not null and status <> 'resolved';
create index if not exists system_alerts_open_idx on public.system_alerts (status, occurred_at desc);

-- ─────────────────────────────────────────────────────────────
-- 3) 사이트 정보 — 키·값 한 벌. 행이 여러 개인 설정 테이블로 만들면 "지금 유효한 행" 을 고르는 규칙이 필요해진다.
--    푸터 사업자 정보가 여기서 나온다(지금 푸터엔 사업자 정보가 한 줄도 없다 — 전자상거래법상 필요).
-- ─────────────────────────────────────────────────────────────
create table if not exists public.site_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);
-- 공개 읽기 — 푸터·탭 제목이 로그인 없이도 읽어야 한다. 쓰기는 함수(service role)만.
alter table public.site_settings enable row level security;
drop policy if exists site_settings_read on public.site_settings;
create policy site_settings_read on public.site_settings for select using (true);

-- ─────────────────────────────────────────────────────────────
-- 4) 팝업 — 노출 기간·위치를 관리자가 정한다.
--    ⛔ 응시 화면에는 절대 띄우지 않는다. 그건 데이터가 아니라 코드가 막는다(설정으로 열 수 있으면 안 된다) —
--       SEB 잠금 화면에서 팝업을 닫으려다 화면을 벗어나면 응시가 무효 처리된다.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.popups (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null default '',           -- 리치 텍스트(HTML)
  image_url text,
  link_url text,
  device text not null default 'both' check (device in ('pc', 'mobile', 'both')),
  -- 노출 위치: 'main' | 'caris' | 'arena' | 'library'. 전체 노출로 두면 시험 공지가 아레나 이용자에게 뜬다.
  placements text[] not null default array['main']::text[],
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  constraint popups_window_chk check (ends_at > starts_at)
);
create index if not exists popups_live_idx on public.popups (active, starts_at, ends_at);
alter table public.popups enable row level security;
drop policy if exists popups_read on public.popups;
create policy popups_read on public.popups for select using (active and now() between starts_at and ends_at);

-- ─────────────────────────────────────────────────────────────
-- 5) 정책 문서(이용약관·개인정보처리방침·협회소개)
--    ⛔ 본문만 고칠 수 있게 하면 부족하다. 약관 제3조가 "개정 시 적용일자·사유를 명시해 7일 전 공지,
--       불리한 개정은 30일 전" 이라고 스스로 규정하므로 **과거 버전을 보관**해야 그 조항을 지킬 수 있다.
--       그래서 한 행 = 한 개정판이고, 화면은 시행일이 지난 것 중 가장 최신을 보여준다.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.policy_docs (
  id uuid primary key default gen_random_uuid(),
  doc text not null check (doc in ('terms', 'privacy', 'about')),
  version int not null,
  body text not null default '',
  change_note text not null default '',    -- 개정 사유(약관 제3조가 요구)
  effective_at date not null,              -- 시행일
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create unique index if not exists policy_docs_version_uniq on public.policy_docs (doc, version);
create index if not exists policy_docs_live_idx on public.policy_docs (doc, effective_at desc);
alter table public.policy_docs enable row level security;
drop policy if exists policy_docs_read on public.policy_docs;
create policy policy_docs_read on public.policy_docs for select using (effective_at <= (now() at time zone 'Asia/Seoul')::date);

-- ─────────────────────────────────────────────────────────────
-- 6) 1:1 문의(Q&A) — **비공개**다. 쓴 사람과 관리자만 본다.
--    공개 게시판으로 두면 응시·결제 문의에 섞인 개인정보가 그대로 노출되고 시험 내용이 올라온다.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.inquiries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null default 'etc' check (category in ('exam', 'payment', 'account', 'arena', 'etc')),
  title text not null,
  body text not null,
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  answer text,
  answered_at timestamptz,
  answered_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists inquiries_user_idx on public.inquiries (user_id, created_at desc);
create index if not exists inquiries_queue_idx on public.inquiries (status, created_at desc);
-- 본인 것만 읽고 쓸 수 있다. 답변 작성은 함수(service role)만.
alter table public.inquiries enable row level security;
drop policy if exists inquiries_own_read on public.inquiries;
create policy inquiries_own_read on public.inquiries for select using (auth.uid() = user_id);
drop policy if exists inquiries_own_write on public.inquiries;
create policy inquiries_own_write on public.inquiries for insert with check (auth.uid() = user_id);

-- ─────────────────────────────────────────────────────────────
-- 7) 강의(콘텐츠) — 이북과 **같은 모양**이다(카탈로그 + 대상 레벨/급수 + 공개 + 순서).
--    ⚠️ 유튜브 링크만 받는다. 영상 파일을 우리 스토리지에 올리면 그 순간부터 영상 트래픽이 전부 우리 몫이 된다.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.lectures (
  id uuid primary key default gen_random_uuid(),
  catalog text not null default 'leveltest' check (catalog in ('leveltest', 'caris')),
  target_level smallint check (target_level is null or (target_level between 1 and 7)),
  target_tier text references public.exam_tiers(tier),
  youtube_id text not null,
  title text not null,
  channel text not null default '',
  description text not null default '',
  published boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
-- 한 강의는 한 카탈로그에만 속한다 — 이북(ebooks_catalog_target_chk)과 같은 규칙.
alter table public.lectures drop constraint if exists lectures_catalog_target_chk;
alter table public.lectures add constraint lectures_catalog_target_chk check (
  (catalog = 'leveltest' and target_tier is null)
  or (catalog = 'caris' and target_level is null)
);
create index if not exists lectures_live_idx on public.lectures (catalog, published, sort_order);

-- ─────────────────────────────────────────────────────────────
-- 8) 코인·시즌 점수 적립 정책 — 개발자가 아니라 관리자가 값을 정한다.
--    ⚠️ 지갑이 둘이다: `coin`(뽑기·상점 재화)과 `score`(랭킹). 섞으면 안 된다.
--    ⚠️ 값의 단일 출처가 여기가 되면 프론트는 값을 들고 있지 않는다 — 서버가 화면 데이터에 실어 내려준다.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.reward_policy (
  wallet text not null check (wallet in ('coin', 'score')),
  kind text not null,                    -- 'attendance' | 'daily' | 'minigame' | 'referral' ...
  label text not null,
  amount int not null default 0 check (amount >= 0),
  per_day int not null default 1 check (per_day >= 0),
  active boolean not null default true,
  sort_order int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (wallet, kind)
);

-- ─────────────────────────────────────────────────────────────
-- 9) 관리자 활동 로그 — 되돌릴 수 없는 조작(회차 삭제·응시권 무효·응시 복구·자격증 수동 발급)이
--    누구 손에서 났는지 답할 수 있어야 한다. 지금은 문항 수정 이력(question_events) 하나뿐이다.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.admin_audit (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor uuid references auth.users(id) on delete set null,
  actor_email text,                      -- 스냅샷: 계정이 사라져도 "누가" 는 남아야 한다
  action text not null,
  target text,
  detail jsonb not null default '{}'::jsonb
);
create index if not exists admin_audit_at_idx on public.admin_audit (at desc);
create index if not exists admin_audit_action_idx on public.admin_audit (action, at desc);

-- ─────────────────────────────────────────────────────────────
-- 10) 계정 정지 — 지금은 계정을 막을 수단이 아예 없다(채팅 신고 기록만 있고 정지가 없다).
-- ─────────────────────────────────────────────────────────────
alter table public.profiles add column if not exists suspended_until timestamptz;
alter table public.profiles add column if not exists suspended_reason text;

-- ─────────────────────────────────────────────────────────────
-- 11) 금지어 — 지금 `_shared/badwords_ko.ts` 에 박혀 있어 새 은어마다 배포해야 한다.
--     코드의 기본 목록은 그대로 두고, 이 표는 **덧붙이는 것**이다(운영 중 추가/해제용).
-- ─────────────────────────────────────────────────────────────
create table if not exists public.banned_words (
  word text primary key,
  active boolean not null default true,
  added_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────
-- 12) 시험환경 점검 기록 — `/exam/check` 가 지금은 아무것도 남기지 않는다.
--     이 기록이 관리자 `CARIS 현황` 의 "시험환경 점검 인원" 이 되고, 독려 메일 대상도 여기서 나온다.
--     ⚠️ 통과 판정에 SEB 감지를 넣지 않는다 — 일반 브라우저에선 항상 실패라 아무도 못 켠다.
--        모의 응시를 끝낸 것을 완료로 본다.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.exam_env_checks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  ticket_id uuid references public.exam_tickets(id) on delete cascade,
  checked_at timestamptz not null default now(),
  ua text,
  screen text,
  detail jsonb not null default '{}'::jsonb
);
-- 응시권 하나당 최신 1건만 유지(다시 하면 갱신). 응시권 없이 그냥 체험한 건은 ticket_id 가 null 이라 여러 건 쌓인다.
create unique index if not exists exam_env_checks_ticket_uniq
  on public.exam_env_checks (ticket_id) where ticket_id is not null;
create index if not exists exam_env_checks_user_idx on public.exam_env_checks (user_id, checked_at desc);

-- ─────────────────────────────────────────────────────────────
-- 13) 자격증 발급 조건 — 개발자가 아닌 관리자가 바꾼다.
--     ⛔ 합격선을 전역 값 하나로 두면 안 된다. 값을 낮추는 순간 **과거 불합격자가 오늘 합격자로 바뀌고**
--        자격증까지 열린다(합격선이 결과 화면·회원 취득급수·대시보드 합격률에 다 쓰인다).
--        → 회차별로 저장하고, 응시 시점 값을 응시 기록에 스냅샷으로 박는다.
-- ─────────────────────────────────────────────────────────────
alter table public.exam_rounds add column if not exists pass_ratio numeric(4,3)
  check (pass_ratio is null or (pass_ratio > 0 and pass_ratio <= 1));
alter table public.exam_rounds add column if not exists cert_available_after_days int
  check (cert_available_after_days is null or cert_available_after_days >= 0);
-- 응시 시점 스냅샷. 이 값이 있으면 채점·합격 판정은 **이 값**을 쓴다(정책이 바뀌어도 과거가 안 흔들린다).
alter table public.exam_attempts add column if not exists pass_ratio_snapshot numeric(4,3);

-- ─────────────────────────────────────────────────────────────
-- 14) 응시 시작 잠금 — 배포·DB 작업 중 **새 응시 시작만** 막는다.
--     보던 사람은 계속 풀고 제출도 된다. 팝업으로는 못 막는다(닫고 시작할 수 있다).
--     site_settings 의 키 하나로 둔다(별도 표를 만들 이유가 없다).
-- ─────────────────────────────────────────────────────────────
insert into public.site_settings (key, value) values ('exam_start_locked', '0')
  on conflict (key) do nothing;
insert into public.site_settings (key, value) values ('exam_start_lock_note', '')
  on conflict (key) do nothing;

-- ─────────────────────────────────────────────────────────────
-- 15) 용어 문항 풀 — 미니게임(버텨라·쏴라·골라라)과 오늘의 학습이 **같이 쓰는 한 벌**.
--     지금 이 문항이 `src/lib/terms.ts` + `public/games/*.html` 의 POOL 로 **네 벌 복제**돼 있다.
--     여기로 모으고, 게임에는 앱 브리지(MGBridge)로 내려보낸다.
--     ⚠️ 게임은 자립형 HTML(iframe)이라 앱 코드를 직접 못 읽는다 — 그래서 '복제'가 생겼던 것이다.
--     ⚠️ 시험 문제은행과 달리 **세트를 고정할 필요가 없다**(게임은 매판 섞여도 된다) → 추출 규칙이 단순하다.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.term_questions (
  id uuid primary key default gen_random_uuid(),
  field text not null default 'AI',          -- 분야 뱃지(AI · 로봇 · 피지컬AI). 자유 문자열 — 분야가 늘 수 있다.
  -- 다국어. 레벨테스트 문항(questions.prompt_i18n)과 같은 모양이라 번역 파이프라인을 그대로 쓸 수 있다.
  desc_i18n jsonb not null default '{}'::jsonb,     -- 설명(문제문)
  answer_i18n jsonb not null default '{}'::jsonb,   -- 정답 용어
  distractors_i18n jsonb not null default '{}'::jsonb, -- 오답 3개: { ko: [..], en: [..] }
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists term_questions_live_idx on public.term_questions (active, sort_order);
-- 같은 정답이 두 번 들어오면 게임에서 같은 문제가 반복된다. 한국어 정답을 유일 키로 본다.
create unique index if not exists term_questions_answer_uniq
  on public.term_questions ((answer_i18n->>'ko')) where active;

-- ─────────────────────────────────────────────────────────────
-- 시드 — **지금 코드에 박힌 값 그대로** 넣는다. 마이그레이션만으로 동작이 달라지면 안 된다.
--   score: src/lib/scoring.ts 의 ACTIVITY_DELTA / ACTIVITY_PER_DAY
--   coin : complete-daily 의 DAILY_POINTS(=10). 출석·학습을 통틀어 하루 1회다(둘 다 해도 재화는 한 번).
-- ─────────────────────────────────────────────────────────────
insert into public.reward_policy (wallet, kind, label, amount, per_day, sort_order) values
  ('score', 'attendance',  '출석',            5, 1, 1),
  ('score', 'daily_learn', '오늘의 학습',      2, 1, 2),
  ('score', 'minigame',    '미니게임',        2, 3, 3),
  ('score', 'referral',    '친구 초대',       5, 1, 4),
  ('coin',  'daily_complete', '오늘의 완료(출석·학습)', 10, 1, 1)
on conflict (wallet, kind) do nothing;

-- 사이트 정보 기본 키 — 값은 비워둔다(관리자가 채운다). 키가 있어야 화면이 입력칸을 그린다.
insert into public.site_settings (key, value) values
  ('site_name', 'CARIS'), ('site_desc', ''),
  ('logo_url', ''), ('favicon_url', ''),
  ('company_name', ''), ('company_ceo', ''), ('company_reg_no', ''), ('company_sales_no', ''),
  ('company_addr', ''), ('company_tel', ''), ('company_email', ''), ('privacy_officer', ''),
  ('sender_email', ''), ('sender_name', ''),
  ('leveltest_per_day', '2'), ('leveltest_promote_bonus', '1'), ('result_release_days', '14')
on conflict (key) do nothing;
