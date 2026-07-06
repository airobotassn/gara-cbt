-- [데모] 회차별 채점 실증용 더미 2 — 제2회 정기시험(2026-08-15)에 배정. 확인 후 삭제 가능.
do $$
declare
  v_exam uuid;
  v_user uuid;
  v_q uuid;
  v_att uuid;
  v_round uuid := '36e08883-9e4e-42f3-86e0-2e95647580e5'; -- 제 2회 정기시험
begin
  select exam_id into v_exam from questions where number = 9001 and kind = 'short' order by exam_id limit 1;
  if v_exam is null then raise notice '[dummy2] no q9001 — skip'; return; end if;
  select id into v_q from questions where number = 9001 and exam_id = v_exam limit 1;

  select id into v_user from auth.users order by created_at limit 1;
  if v_user is null then raise notice '[dummy2] no user — skip'; return; end if;

  insert into exam_attempts (exam_id, round_id, user_id, status, submitted_at, result_release_at, total_questions, total_correct)
  values (v_exam, v_round, v_user, 'submitted', now() - interval '2 day', now() - interval '2 hour', 1, 0)
  returning id into v_att;

  insert into attempt_answers (attempt_id, question_id, number, answer_text, is_correct, review_status)
  values (v_att, v_q, 9001, '[더미2] 피지컬 AI는 로봇처럼 물리적 몸체를 통해 현실 환경과 직접 상호작용하는 인공지능을 뜻합니다.', null, 'pending');

  raise notice '[dummy2] inserted attempt=% round=%', v_att, v_round;
end $$;
