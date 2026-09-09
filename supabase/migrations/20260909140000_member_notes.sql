-- 회원 메모 (2026-09-09 지시)
--
-- 관리자 › 유저관리 › 상세의 '문의·메모' 탭. "이 사람 전화로 뭐라고 했다", "환불 약속함" 같은
-- **다음 담당자에게 넘길 말**을 계정에 붙여 둔다. 여태 그런 자리가 없어서 메신저·기억에 있었다.
--
-- ⛔ **보는 화면과 같이 만든다.** 2026-09-07 에 `admin_audit`(감사로그)을 없앤 이유가 그거다 —
--    16곳이 쓰는데 보는 화면이 0곳이라 53건이 아무 소용 없이 쌓여 있었다. 이 표는 반대로
--    **화면에서만 쓰기가 생기고 같은 화면이 읽는다.** 읽는 자리 없이 쓰기를 늘리지 말 것.
-- ⛔ **본인에게 안 보인다.** 관리자 전용 표다(RLS 켜고 정책 0개 = service role 전용). 회원 화면에
--    노출되는 순간 성격이 완전히 달라진다 — 여기 적히는 건 회원이 읽으라고 쓰는 글이 아니다.
-- ⚠️ **지운 사람도 남는다** — `author` 는 남기고 계정이 사라져도 `on delete set null` 로 메모는 산다.
--    "누가 썼는지 모르는 메모" 가 "메모가 통째로 사라지는 것" 보다 낫다.
-- ⚠️ 회원이 탈퇴·파기되면 그 사람의 메모도 같이 사라진다(`user_id` FK cascade) — 파기는 그 사람에
--    대한 기록을 지우는 절차라 여기만 남기면 그 절차가 반쪽이 된다.

create table if not exists public.member_notes (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  body       text        not null,
  author     uuid        references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint member_notes_body_chk check (char_length(btrim(body)) between 1 and 4000)
);

-- 조회는 언제나 "이 사람의 메모를 최근 것부터".
create index if not exists member_notes_user_idx on public.member_notes (user_id, created_at desc);

alter table public.member_notes enable row level security;
