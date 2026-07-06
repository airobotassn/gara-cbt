-- 자격증 발급 상태 — 마이페이지(발급현황)든 성적표(합격증 발급)든 발급하면 '발급 완료'로 전환.
-- 재발급도 허용(시각만 갱신). 클라 직접 쓰기 불가(RLS 미부여) — my-attempts 함수만 기록.
alter table exam_attempts add column if not exists cert_issued_at timestamptz;
