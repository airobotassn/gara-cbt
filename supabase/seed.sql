-- ============================================================
-- 시드 — GARA 자격검정 (CBT) 기본 시험 1개 + 더미 문항 100개
-- 실제 문항은 임포트로 교체. 재실행 가능(idempotent-ish): 같은 slug 시험/문항을 지우고 다시 넣음.
-- ⚠️ 더미 데이터(보기/정답은 placeholder).
-- ============================================================

-- 기존 'gara-default' 시험과 그 문항 정리(자식 questions 는 ON DELETE CASCADE 로 함께 삭제됨)
delete from exams where slug = 'gara-default';

-- 시험 1개
insert into exams (slug, title, year, round, total_questions, duration_minutes, active)
values ('gara-default', 'GARA 자격검정', 2026, 1, 100, 120, true);

-- 더미 문항 100개 (number 1..100, 보기 4개, 정답 1개)
-- subject 는 5개 카테고리를 순환, topic/prompt 는 문항 번호 참조.
insert into questions (exam_id, number, subject, topic, prompt, options, correct_index)
select
  e.id,
  n,
  (array[
    'AI 활용 · 기초',
    '데이터 · 전처리',
    '모델 · 학습',
    '윤리 · 보안',
    '실무 · 적용'
  ])[((n - 1) % 5) + 1] as subject,
  format('소주제 %s', ((n - 1) % 5) + 1) as topic,
  format('[더미 · 교체필요] %s번 문항 — 다음 중 가장 적절한 것을 고르시오.', n) as prompt,
  jsonb_build_array(
    format('보기 1 (%s번)', n),
    format('보기 2 (%s번)', n),
    format('보기 3 (%s번)', n),
    format('보기 4 (%s번)', n)
  ) as options,
  (n % 4) as correct_index
from exams e
cross join generate_series(1, 100) as n
where e.slug = 'gara-default';
