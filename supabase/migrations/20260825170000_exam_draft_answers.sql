-- 응시 중 답안 임시보관을 **응시 행의 jsonb 한 칸**으로 옮긴다 (2026-08-25)
--
-- 여태 있던 것: 하트비트(30초)가 답안을 attempt_answers 에 **문항마다 한 줄씩** UPDATE 했다.
--   클라는 매번 **전 문항**을 보내므로(CbtRunner 의 draftRef) 40문항 시험이면 30초마다 40왕복,
--   50분이면 한 사람이 4,000왕복이다. 동시 응시자가 수백이면 그 곱만큼 DB 를 두드린다.
--
-- ⛔ **채점 결과는 그대로 행에 남는다.** 행이 밥값을 하는 곳이 실제로 있어서다 —
--    ① 주관식 수동 검수 큐(review_status='pending' 인 행만 골라 뽑는다)
--    ② 문항별 정답률 집계(SQL group by)
--    ③ 결과 화면·관리자 응시 상세의 문항별 정오답
--    이건 전부 **제출 후** 데이터고, 임시보관은 **제출 전 복구용 사본**이라 성격이 다르다.
--    그 둘이 같은 행에 얹혀 있던 것이 이 비용의 원인이었다.
--
-- 그래서 갈라 놓는다:
--   · 시험 중 자동저장 → exam_attempts.draft_answers 한 칸을 통째로 덮어쓴다 (1왕복, 문항 수와 무관)
--   · 끊겼다 복구     → 그 칸을 읽어 화면을 되살린다
--   · 제출 시 채점     → 예전 그대로 attempt_answers 에 기록한다 (건드리지 않음)
--
-- 모양: [{ "number": 1, "selectedIndex": 2, "answerText": null }, ...]
--   ⚠️ 클라가 보낸 값을 **그대로** 담지 않는다 — exam-session 이 번호·선택지를 정수로 자르고
--      주관식은 2000자로 끊은 뒤 넣는다(옛 saveDraft 의 검증을 그대로 옮겼다).
--   ⚠️ 인덱스를 걸지 않는다. 이 칸은 **그 응시 하나를 되살릴 때만** 읽고, 조건 검색 대상이 아니다.
alter table exam_attempts add column if not exists draft_answers jsonb;

comment on column exam_attempts.draft_answers is
  '응시 중 답안 임시보관(복구용). 채점 결과가 아니다 — 그건 attempt_answers 에 남는다. 제출과 무관하게 마지막 하트비트 상태를 담는다.';
