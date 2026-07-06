-- 응시-회차 연결 — 정기시험 회차별 채점/집계용. 응시가 어느 회차(exam_rounds)에서 이뤄졌는지 기록.
--  · 접수 UX(회차 선택)는 아직이지만, start-exam 이 현재 활성 정기회차를 자동 배정(데모 포함).
--  · nullable — 회차 미배정(상시 등)은 null.
alter table exam_attempts add column if not exists round_id uuid references exam_rounds(id);
create index if not exists exam_attempts_round_idx on exam_attempts(round_id);
