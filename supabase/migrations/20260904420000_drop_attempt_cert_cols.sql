-- 2026-09-04 · 자격증 분리 2단계 — exam_attempts 의 자격증 네 칸 드롭
--   (1단계 = 20260904250000 이 exam_certificates 를 만들고 이관했다. 그 사이에 코드를 배포했다.)
--
--   지운 칸: cert_no · verify_token · cert_name_roman · cert_issued_at
--   옮겨간 곳: exam_certificates(attempt_id PK) — 덤으로 first_issued_at·last_issued_at·issue_count 가
--   생겨서 **재발급 이력**이 남는다(옛 구조에는 담을 칸이 없어 덮어써지던 값이다).
--
--   ⚠️ 번호(cert_no)·토큰(verify_token)은 재발급해도 안 바뀐다 — 인쇄돼 나간 QR 이 죽으면 안 된다.
--      그래서 응시당 한 줄(1:1)이고, 재발급은 새 줄이 아니라 그 줄의 갱신이다(cert_reissue RPC).
--   ⛔ 만료 계산은 first_issued_at 을 쓴다(verify-cert) — 재발급으로 유효기간이 연장되면 안 된다.
--
--   옮긴 자리 다섯:
--     my-attempts  발급·재발급·내 응시 목록      verify-cert  진위확인 토큰 조회
--     payments     '이미 발급됨' 판정            admin        홈 대시보드 발급 집계 4곳
--     admin/reform 자격증 발급 목록(certList)
--
--   ⚠️ 타임스탬프가 420000 인 이유 = 같은 날 세션 셋이 20260904 대를 10000 씩 집어가다 두 번 겹쳤다.
--      gara-cbt-1a 가 400000·410000 을 썼고 그 뒤를 이어 받았다.

begin;

alter table exam_attempts drop column if exists cert_no;
alter table exam_attempts drop column if exists verify_token;
alter table exam_attempts drop column if exists cert_name_roman;
alter table exam_attempts drop column if exists cert_issued_at;

commit;
