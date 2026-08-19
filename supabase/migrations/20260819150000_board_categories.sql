-- 게시판 분류(board_categories) — 공지사항·FAQ 의 분류를 **관리자가 만들고 고치고 지운다**(2026-08-19).
--
-- 왜 만드나
--   분류가 코드에 박혀 있었다(공지 4종 `NOTICE_CATS` / FAQ 5종 `FAQ_CATS`)고, 이름은 i18n 사전에
--   `notice.filter_*`·`faq.cat_*` 로 또 한 벌 있었다. 분류 하나 늘리려면 개발자가 두 파일을 고치고
--   배포해야 했다 — 운영자가 못 하는 일이 아니라 못 하게 되어 있던 일이다.
--
-- 설계
--   · 공지·FAQ 를 **한 표**에 담고 `kind` 로 가른다. 둘의 생김새가 같아서(키+이름+순서) 표를 둘로 두면
--     같은 CRUD 를 두 벌 유지하게 된다.
--   · `key` 가 `notices.category`·`faqs.category` 에 실제로 저장되는 값이다. 기존 데이터와 이어지려면
--     시드 키가 옛 하드코딩 값과 **글자까지 같아야** 한다(guide/schedule/... ).
--   · 이름은 6개국어 jsonb. 관리자는 한국어만 쓰고 admin 함수가 나머지를 자동 번역해 넣는다
--     (공지·FAQ 본문과 같은 경로 = translateKoFields).
--
-- ⛔ **분류를 지워도 글은 안 건드린다.** 글의 category 값은 그대로 남고(고아 키), 공개 화면은
--    "지금 있는 분류에 속한 글"만 보여주며, 관리자 목록에는 '미분류' 로 모여 다시 지정할 수 있다.
--    글을 같이 지우거나 category 를 비우면 되돌릴 수 없다 — 실수로 지운 분류를 같은 key 로 다시 만들면
--    글이 그대로 돌아오는 게 이 설계의 이유다.
-- ⚠️ 그래서 `notices.category`·`faqs.category` 에 FK 를 걸지 않는다. FK 를 걸면 위 동작이 불가능하다
--    (삭제가 막히거나 글이 딸려 지워진다).

create table if not exists public.board_categories (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('notice', 'faq')),
  -- notices.category / faqs.category 에 저장되는 값. 영문 소문자·숫자·밑줄만(주소·조회에 그대로 쓰인다).
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,31}$'),
  label_i18n jsonb not null default '{}'::jsonb,   -- { ko, en, ja, zh, hi, vi }
  -- FAQ 사이드바 아이콘(Material Symbols 이름). 공지에는 안 쓴다. 비면 화면이 기본 아이콘을 쓴다.
  icon text not null default '',
  sort int not null default 100,                   -- 작을수록 앞
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (kind, key)
);
create index if not exists board_categories_kind_idx on public.board_categories (kind, sort, created_at);

alter table public.board_categories enable row level security;
-- 분류 이름은 공개 화면(/notice · /faq)이 그대로 그리는 값이라 누구나 읽는다. 쓰기 정책은 없다 = admin 함수 전용.
drop policy if exists board_categories_public_read on public.board_categories;
create policy board_categories_public_read on public.board_categories for select using (true);

-- ── 시드: 지금 코드·사전에 박혀 있는 분류를 그대로 옮긴다 ───────────────────────
--   ⚠️ 값을 다듬지 말 것. 화면 문구가 바뀌면 "분류를 DB 로 옮겼더니 이름이 달라졌다" 가 된다.
insert into public.board_categories (kind, key, label_i18n, icon, sort) values
  ('notice', 'guide', '{"ko":"안내","en":"Guide","ja":"案内","zh":"指南","hi":"गाइड","vi":"Hướng dẫn"}', '', 10),
  ('notice', 'schedule', '{"ko":"CARIS 일정","en":"CARIS schedule","ja":"CARIS日程","zh":"CARIS 日程","hi":"CARIS कार्यक्रम","vi":"Lịch CARIS"}', '', 20),
  ('notice', 'maintenance', '{"ko":"점검","en":"Maintenance","ja":"メンテナンス","zh":"维护","hi":"रखरखाव","vi":"Bảo trì"}', '', 30),
  ('notice', 'event', '{"ko":"이벤트","en":"Event","ja":"イベント","zh":"活动","hi":"इवेंट","vi":"Sự kiện"}', '', 40),
  ('faq', 'schedule', '{"ko":"시험 접수 및 일정","en":"Registration & Schedule","ja":"受験申込・日程","zh":"考试报名与日程","hi":"पंजीकरण और कार्यक्रम","vi":"Đăng ký & Lịch thi"}', 'calendar_month', 10),
  ('faq', 'system', '{"ko":"시스템 및 환경","en":"System & Environment","ja":"システム・環境","zh":"系统与环境","hi":"सिस्टम और वातावरण","vi":"Hệ thống & Môi trường"}', 'computer', 20),
  ('faq', 'payment', '{"ko":"결제 및 환불","en":"Payment & Refunds","ja":"支払い・返金","zh":"支付与退款","hi":"भुगतान और रिफंड","vi":"Thanh toán & Hoàn tiền"}', 'credit_card', 30),
  ('faq', 'grading', '{"ko":"채점 및 인증서","en":"Grading & Certificates","ja":"採点・資格証","zh":"评分与证书","hi":"मूल्यांकन और प्रमाणपत्र","vi":"Chấm điểm & Chứng chỉ"}', 'workspace_premium', 40),
  ('faq', 'corporate', '{"ko":"기업 및 단체 응시","en":"Corporate & Group Exams","ja":"企業・団体受験","zh":"企业与团体应试","hi":"कॉर्पोरेट और समूह परीक्षा","vi":"Thi doanh nghiệp & nhóm"}', 'domain', 50)
on conflict (kind, key) do nothing;
