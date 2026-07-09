-- QR 진위확인 — 자격증 원본 레코드 필드.
-- 발급(my-attempts issue) 시점에 채워지고, QR은 verify_token 을 조회 키로 쓴다.
--   verify_token : 추측 불가 랜덤(UUID). QR URL = /verify/<token>. 최초 발급 시 1회 생성, 재발급해도 불변(QR 유지).
--   cert_no      : 자격번호(제80조 규격)를 발급 시 확정 저장 → 성적표·마이페이지·검증이 같은 값 사용(불일치 제거).
-- 클라 직접 쓰기 불가(RLS 미부여) — my-attempts / verify-cert 함수(service role)만 접근.
alter table exam_attempts add column if not exists verify_token text;
alter table exam_attempts add column if not exists cert_no text;

-- 토큰 유니크(발급 전 NULL 은 다중 허용 — 부분 인덱스).
create unique index if not exists exam_attempts_verify_token_key
  on exam_attempts (verify_token)
  where verify_token is not null;
