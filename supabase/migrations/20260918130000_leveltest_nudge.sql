-- 레벨테스트 독려 메일 (2026-09-18 지시 · PPT `관리자 페이지 수정사항` 4페이지)
--
-- WORLD ARENA › 레벨테스트 › 응시 기록에 「독려 메일」 — **마지막 응시가 N일 지난 회원**을 골라 한 번에 보낸다.
-- 시험환경 점검 독려(20260811150000)와 같은 구조: 제목·본문은 site_settings 의 기본값, 관리자가 창에서 고쳐 보낸다.
--
-- ⚠️ **메일은 아직 실제로 안 나간다**(발송 서비스 없음). 보내기를 누르면 mail_log·mail_recipients 에 '기록만'
--    남는다 — 유저관리 › 상세 › 독려이력이 그걸 보여준다. 발송 서비스가 붙으면 그 자리(mailNudge)가 보낸다.
-- ⚠️ PPT 의 "N일 후 **자동** 발송" 은 여기 없다 — 발송 수단과 스케줄러 둘 다 없어서다(2026-09-18 결정: 수동 선택 발송).
-- 치환자: {name} 이름 · {level} 현재 레벨등급 · {link} 레벨테스트 주소

insert into public.site_settings (key, value) values
  ('mail_leveltest_subject', 'AI&로봇 레벨테스트 레벨 UP 하세요~!'),
  ('mail_leveltest_body',
   E'안녕하세요, {name} 님.\nWORLD ARENA AI&로봇 레벨테스트를 운영중인 CARIS입니다.\n{name} 님께서는 현재 레벨등급 {level} 유지 중입니다.\n\n레벨 클리어로 CARI 코인 +1000점도 획득 하시고 레벨테스트 인증서도 발급받으세요.\n그간의 노력과 준비가 결실을 맺을 수 있도록, 레벨 UP 하세요~\n\n{link}\n\n감사합니다.')
on conflict (key) do nothing;

-- 대상 후보 — 회원별 **마지막 제출 응시**가 p_days 일보다 오래된 사람.
--   · 게스트(익명)·탈퇴 신청자는 뺀다(메일을 받을 계정이 아니다).
--   · 이메일은 여기서 안 준다 — auth.users 는 admin_user_emails() 가 따로 준다(그 함수의 권한 경계를 그대로 쓴다).
--   · 한 번도 응시 안 한 회원은 후보가 아니다("응시기록 후 N일" 이 조건이라).
create or replace function public.leveltest_nudge_candidates(p_days int)
returns table (user_id uuid, display_name text, rank int, last_at timestamptz, days_since int)
language sql
stable
security definer
set search_path = public
as $$
  with last as (
    select distinct on (a.user_id) a.user_id, a.submitted_at
    from test_attempts a
    where a.status = 'submitted' and a.submitted_at is not null
    order by a.user_id, a.submitted_at desc
  )
  select l.user_id, p.display_name, coalesce(up.rank, 1) as rank, l.submitted_at as last_at,
         floor(extract(epoch from (now() - l.submitted_at)) / 86400)::int as days_since
  from last l
  join profiles p on p.id = l.user_id
  left join user_progress up on up.user_id = l.user_id
  where coalesce(p.is_anonymous, false) = false
    and p.deactivated_at is null
    and l.submitted_at <= now() - make_interval(days => greatest(p_days, 0))
  order by l.submitted_at desc
$$;

revoke all on function public.leveltest_nudge_candidates(int) from public;
revoke all on function public.leveltest_nudge_candidates(int) from anon;
revoke all on function public.leveltest_nudge_candidates(int) from authenticated;
grant execute on function public.leveltest_nudge_candidates(int) to service_role;
