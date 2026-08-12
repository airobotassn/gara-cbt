-- 1:1 문의 '새 답변' 빨간 점 — 답변을 **사용자가 봤는지**를 한 칸으로 기록한다(2026-08-12).
--
-- 왜 컬럼이 필요한가: inquiries 는 이미 status='answered' + answered_at 을 갖고 있어서 "답변이 달렸다"는
--   알 수 있지만, "그 사람이 그걸 봤다"는 아무 데도 없다. 그 칸 없이 점을 띄우면 둘 중 하나가 된다 —
--   점이 영영 안 꺼지거나(읽음 개념이 없음), 마이페이지를 열기만 해도 꺼진다(본 적 없는데 사라짐).
--
-- ⚠️ 사용자에게 UPDATE 를 열어주지 않는다. RLS 는 컬럼 단위로 못 막아서, 본인 행 update 를 허용하면
--    그 사람이 자기 문의의 answer·status 까지 직접 쓸 수 있다(자기 글에 "답변 완료"를 스스로 박는다).
--    그래서 읽음 처리는 아래 SECURITY DEFINER 함수 하나로만 한다.
alter table public.inquiries add column if not exists answer_seen_at timestamptz;

-- 미확인 개수 조회 전용. 로그인한 **모든 화면**에서 도는 질의라 인덱스 없이 두면 안 된다.
create index if not exists inquiries_unseen_idx
  on public.inquiries (user_id)
  where status = 'answered' and answer_seen_at is null;

-- 읽음 처리 = 그 문의를 펼쳐본 순간. 본인 행 · 답변된 것 · 아직 안 본 것만 찍는다.
-- ⚠️ `answer_seen_at is null` 조건을 빼면 안 된다 — 목록을 열 때마다 시각이 밀려서
--    "언제 봤나"가 사라지고, 관리자가 답변을 고쳐 쓴 시점과의 선후를 못 따진다.
create or replace function public.inquiry_mark_seen(p_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.inquiries
     set answer_seen_at = now()
   where id = p_id
     and user_id = auth.uid()
     and status = 'answered'
     and answer_seen_at is null;
$$;
revoke all on function public.inquiry_mark_seen(uuid) from public;
grant execute on function public.inquiry_mark_seen(uuid) to authenticated;
