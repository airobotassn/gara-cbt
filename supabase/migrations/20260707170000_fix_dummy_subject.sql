-- 더미 문항 subject 정정 — 티어 개편(Beginner~Zenith) 전에 넣은 '피지컬 AI 및 데이터 처리'는
-- 현재 /guide 과목 목록에 없어(getTracks) 관리자 문항목록의 급수→과목 필터에 안 잡힘.
-- 개념상 가장 맞는 실제 /guide 과목(CARIS-Ⅰ Beginner subj.1)으로 교체. 대상 subject 인 행만 갱신(안전).
update public.questions
set subject = '일상 속 로봇 기술과 피지컬 AI의 이해'
where subject = '피지컬 AI 및 데이터 처리';
