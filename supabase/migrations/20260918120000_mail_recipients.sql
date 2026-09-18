-- 독려 메일 · 사람별 발송 이력 (2026-09-18 지시 · PPT `관리자 페이지 수정사항` 2페이지 '독려이력')
--
-- 옛 상태: `mail_log` 가 "한 번에 몇 명에게 보냈다" 만 남겼다(recipients int). 그래서 유저관리 › 상세에서
-- "이 사람에게 뭘 보냈나" 를 보여줄 수가 없었다 — 누구에게 보냈는지가 어디에도 없었기 때문이다.
--
-- ⚠️ **메일은 아직 실제로 안 나간다**(발송 서비스가 붙은 적이 없다 — mailNudge 주석). 그래서 이 표의
--    status 기본값이 'logged'(기록만) 이다. 발송 서비스가 붙으면 보내는 자리가 'sent'/'failed' 로 바꾼다.
--    ⛔ 붙기 전에 'sent' 를 쓰지 말 것 — 안 보낸 걸 보냈다고 화면이 말하게 된다(2026-09-18 결정:
--    "일단 해놓고 발송은 나중에 추가").
-- ⛔ **보는 화면과 같이 만든다** — 유저관리 › 상세 › 독려이력 탭(`memberMailList`). 쓰기만 있는 표를
--    또 만들지 말 것(admin_audit 을 없앤 이유).
-- ⚠️ 회원이 파기되면 그 사람 줄도 같이 사라진다(cascade) — 파기는 그 사람 기록을 지우는 절차다.
--    묶음(`mail_log`) 쪽은 남는다(건수 통계는 사람과 무관).

create table if not exists public.mail_recipients (
  id         bigserial   primary key,
  mail_id    bigint      not null references public.mail_log(id) on delete cascade,
  user_id    uuid        references auth.users(id) on delete cascade,
  email      text        not null,
  -- logged = 내용·대상만 기록(발송 수단 없음) · sent = 실제 발송 · failed = 발송 시도했으나 실패
  status     text        not null default 'logged',
  sent_at    timestamptz,
  error      text,
  created_at timestamptz not null default now(),
  constraint mail_recipients_status_chk check (status in ('logged', 'sent', 'failed'))
);

-- 조회는 언제나 "이 사람에게 보낸 것을 최근 것부터".
create index if not exists mail_recipients_user_idx on public.mail_recipients (user_id, created_at desc);
create index if not exists mail_recipients_mail_idx on public.mail_recipients (mail_id);

alter table public.mail_recipients enable row level security;
-- 정책 0개 = service role(엣지 함수) 전용. 관리자 함수만 읽고 쓴다.

-- 무엇을 보냈는지도 남긴다 — 제목만으로는 "그때 본문이 뭐였지" 에 답을 못 한다.
alter table public.mail_log add column if not exists body text not null default '';

comment on table public.mail_recipients is
  '독려 메일 사람별 발송 이력. status=logged 는 발송 수단이 없어 기록만 한 것(2026-09-18).';
