-- [데모] 회차별 주관식 채점 실증용 더미 — 확인 후 삭제 가능.
--  · 주관식 문항 1(number=9001) + 제출 응시 1(현재 활성 정기회차 배정) + 미검수 답안 1.
--  · exam/유저 없으면 조용히 스킵. 식별용 '[더미]' 프리픽스 → 나중에 일괄 삭제 쉬움.
do $$
declare
  v_exam uuid;
  v_round uuid;
  v_user uuid;
  v_q uuid;
  v_att uuid;
begin
  select id into v_exam from exams where active order by created_at limit 1;
  if v_exam is null then raise notice '[dummy] no exam — skip'; return; end if;

  -- start-exam 과 동일 로직: 오늘 이후 임박 정기회차, 없으면 최근 정기회차
  select id into v_round from exam_rounds
    where kind = 'regular' and published and exam_date >= current_date
    order by exam_date asc limit 1;
  if v_round is null then
    select id into v_round from exam_rounds where kind = 'regular' and published order by exam_date desc limit 1;
  end if;

  select id into v_user from auth.users order by created_at limit 1;
  if v_user is null then raise notice '[dummy] no user — skip'; return; end if;

  insert into questions (exam_id, number, subject, topic, prompt, kind, choices, correct_index, answer_key, active)
  values (v_exam, 9001, '피지컬 AI 및 데이터 처리', '개념', '[더미] 피지컬 AI란 무엇인지 서술하시오.', 'short', '[]'::jsonb, null, '센서·액추에이터로 물리 세계와 상호작용하는 AI (핵심어 포함 시 정답)', true)
  on conflict (exam_id, number) do update set kind = 'short', answer_key = excluded.answer_key, prompt = excluded.prompt
  returning id into v_q;

  insert into exam_attempts (exam_id, round_id, user_id, status, submitted_at, result_release_at, total_questions, total_correct)
  values (v_exam, v_round, v_user, 'submitted', now() - interval '1 day', now() - interval '1 hour', 1, 0)
  returning id into v_att;

  insert into attempt_answers (attempt_id, question_id, number, answer_text, is_correct, review_status)
  values (v_att, v_q, 9001, '[더미] 피지컬 AI는 센서와 액추에이터로 물리 세계와 상호작용하며 실제 환경에서 작동하는 인공지능입니다.', null, 'pending');

  raise notice '[dummy] inserted attempt=% round=%', v_att, v_round;
end $$;
