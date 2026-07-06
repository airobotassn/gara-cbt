-- 주관식 문항 지원 — 방법 A(기존 테이블 컬럼 추가). 채점 단위는 문항당 O/X 1점(부분점수 없음).
--  · questions.kind = 'mc'(객관식·기존) | 'short'(주관식). 주관식은 choices=[], correct_index=null.
--  · answer_key = 주관식 모범답안/채점 기준(관리자 검수 참고용, 클라 비노출).
--  · attempt_answers.answer_text = 응시자 주관식 답. review_status = auto(객관식 자동채점) | pending(주관식 검수대기) | graded(검수완료).

alter table questions add column if not exists kind text not null default 'mc';
alter table questions add column if not exists answer_key text;
alter table questions alter column correct_index drop not null;
-- 인라인 check(correct_index between 0 and 3)를 kind 조건부로 교체
alter table questions drop constraint if exists questions_correct_index_check;
alter table questions add constraint questions_correct_index_check check (
  (kind = 'mc' and correct_index between 0 and 3)
  or (kind = 'short' and correct_index is null)
);
alter table questions add constraint questions_kind_check check (kind in ('mc', 'short'));

alter table attempt_answers add column if not exists answer_text text;
alter table attempt_answers add column if not exists review_status text not null default 'auto';
alter table attempt_answers add column if not exists graded_by text;
alter table attempt_answers add column if not exists graded_at timestamptz;

-- 검수 대기 조회용(주관식 pending) — 관리자 채점 큐
create index if not exists attempt_answers_review_idx on attempt_answers(review_status) where review_status = 'pending';
