-- 관리자페이지 재편 2차 — 사용자 검수 반영(2026-08-11).
--   ① 코인/점수 적립을 **미니게임 종류별**로 나눈다
--   ② 자격증 발급조건을 **회차별이 아니라 급수(티어)별**로 옮긴다
--   ③ 사이트 정보에 메일 발송용 값(제목·본문 템플릿)을 둔다

-- ─────────────────────────────────────────────────────────────
-- ① 미니게임 종류별 적립
--   `minigame` 한 줄로는 "버텨라는 2점, 지어라는 3점" 같은 조정이 안 된다.
--   부모 행(`minigame`)은 **기본값**으로 남기고, 게임별 행이 있으면 그게 이긴다.
--   kind 규칙: `minigame:<gameId>` — 게임 목록은 _shared/minigames.ts 의 GAMES 가 단일 출처다.
-- ─────────────────────────────────────────────────────────────
insert into public.reward_policy (wallet, kind, label, amount, per_day, sort_order) values
  ('score', 'minigame:beat-cari',    '버텨라 CARI',      2, 3, 10),
  ('score', 'minigame:shoot-cari',   '쏴라 CARI',        2, 3, 11),
  ('score', 'minigame:pick-cari',    '골라라 CARI',      2, 3, 12),
  ('score', 'minigame:reach-cari',   '닿아라 CARI',      2, 3, 13),
  ('score', 'minigame:build-cari',   '지어라 CARI',      2, 3, 14),
  ('score', 'minigame:program-cari', '프로그램해라 CARI', 2, 3, 15)
on conflict (wallet, kind) do nothing;

-- ─────────────────────────────────────────────────────────────
-- ② 자격증 발급조건 = 급수(티어)별
--   회차마다 합격선을 다르게 두면 "이번 달 비기너는 60%, 다음 달 비기너는 55%" 가 되어 자격의 뜻이 흔들린다.
--   바꾸는 단위는 **급수 그 자체**다(비기너의 발급조건을 바꾸면 비기너 전체에 적용).
--   ⚠️ 과거 판정을 지키는 장치는 그대로다 — 응시 시점 값을 exam_attempts.pass_ratio_snapshot 에 박는다.
-- ─────────────────────────────────────────────────────────────
alter table public.exam_tiers add column if not exists pass_ratio numeric(4,3)
  check (pass_ratio is null or (pass_ratio > 0 and pass_ratio <= 1));
alter table public.exam_tiers add column if not exists cert_available_after_days int
  check (cert_available_after_days is null or cert_available_after_days >= 0);
alter table public.exam_tiers add column if not exists cert_fee_override int
  check (cert_fee_override is null or cert_fee_override >= 0);

-- 회차에 달았던 것은 되돌린다(위 이유로 급수가 맞는 단위다). 값이 들어간 적이 없어 데이터 손실이 없다.
alter table public.exam_rounds drop column if exists pass_ratio;
alter table public.exam_rounds drop column if exists cert_available_after_days;

-- ─────────────────────────────────────────────────────────────
-- ③ 메일 발송 — 발신자만 정해두면 "무슨 내용을 보낼지" 가 빠진다.
--   제목·본문을 템플릿으로 두고, 관리자가 회차를 골라 **한 번에** 보낸다(사람마다 따로 쓰는 게 아니다).
--   치환자: {name} 응시자 이름 · {round} 회차명 · {tier} 급수 · {examDate} 시험일 · {link} 응시 안내 주소
-- ─────────────────────────────────────────────────────────────
insert into public.site_settings (key, value) values
  ('mail_nudge_subject', '[CARIS] {round} 시험환경 점검을 아직 안 하셨어요'),
  ('mail_nudge_body',
   E'{name}님, 안녕하세요.\n\n신청하신 {round}({tier}) 시험일이 {examDate}입니다.\n응시 전에 시험환경 점검을 꼭 마쳐 주세요. 점검을 마쳐야 응시하기 버튼이 열립니다.\n\n{link}\n\n감사합니다.')
on conflict (key) do nothing;

-- 발송 이력 — 누구에게 언제 무엇을 보냈는지. 없으면 같은 사람에게 매일 보내게 된다.
create table if not exists public.mail_log (
  id bigserial primary key,
  sent_at timestamptz not null default now(),
  kind text not null,                    -- 'nudge_env_check' 등
  round_id uuid references public.exam_rounds(id) on delete set null,
  recipients int not null default 0,
  subject text not null default '',
  sent_by uuid references auth.users(id) on delete set null
);
create index if not exists mail_log_at_idx on public.mail_log (sent_at desc);
