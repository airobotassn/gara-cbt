-- 2026-09-04 · 자격증을 exam_certificates 로 분리 (2026-09-04 지시)
--
--   여태 자격증은 표가 없고 응시 기록(exam_attempts)의 네 칸이었다:
--     cert_no · verify_token · cert_name_roman · cert_issued_at
--   관리자 함수 주석에도 "자격증은 테이블이 없고 응시 기록에서 계산한다" 고 적혀 있었다.
--
--   문제는 **재발급 이력을 담을 자리가 없다는 것**이다. 재발급하면 cert_issued_at 과
--   cert_name_roman 을 덮어써서, 언제 처음 냈는지·몇 번 다시 냈는지가 아무 데도 안 남는다.
--   자격증은 대외로 나가는 물건이라 그 이력이 없는 게 나중에 문제가 된다.
--   ⚠️ 번호(cert_no)와 진위확인 토큰(verify_token)은 **재발급해도 안 바뀐다** — QR 이 죽으면 안 되기
--      때문이다. 그래서 이 표는 응시당 한 줄(1:1)이고, 여러 장이 생기는 구조가 아니다.
--
--   지금 발급된 자격증이 **0건**이라 옮기기 제일 싼 시점이다(아래 insert 는 0행을 옮긴다).
--
--   ⛔ 이 파일은 **표를 만들기만** 한다. exam_attempts 의 네 칸 드롭은 코드 배포 뒤에
--      20260904260000 이 한다 — 먼저 지우면 발급·진위확인·관리자 집계가 전부 400 이다.

begin;

create table if not exists exam_certificates (
  -- 응시 하나당 자격증 하나. 재발급은 새 줄이 아니라 이 줄의 갱신이다(번호·토큰 불변이 그 이유).
  attempt_id      uuid primary key references exam_attempts(id) on delete cascade,
  -- 제80조 규격 자격번호. 채번은 next_cert_seq() 가 원자적으로 한다.
  cert_no         text not null unique,
  -- /verify/:token 이 쓰는 난수. ⛔ 재발급 때 새로 뽑지 말 것 — 이미 인쇄돼 나간 QR 이 죽는다.
  verify_token    text not null unique,
  -- 자격증에 인쇄되는 영문 성명. 응시자가 직접 넣은 값이라 자동 로마자 변환을 하지 않는다.
  name_roman      text not null,
  -- ⭐ 이 표를 만든 이유 — 응시 기록에는 담을 칸이 없던 값들이다.
  first_issued_at timestamptz not null default now(),
  last_issued_at  timestamptz not null default now(),
  issue_count     int not null default 1
);

-- 기존 발급분 이관(현재 0건). 네 칸이 다 찬 행만 옮긴다 — 하나라도 비면 발급이 안 끝난 것이다.
insert into exam_certificates (attempt_id, cert_no, verify_token, name_roman, first_issued_at, last_issued_at)
select id, cert_no, verify_token, coalesce(nullif(btrim(cert_name_roman), ''), '(unknown)'), cert_issued_at, cert_issued_at
  from exam_attempts
 where cert_no is not null and verify_token is not null and cert_issued_at is not null
on conflict (attempt_id) do nothing;

-- 저장소 관례: RLS ON + 정책 0개 = service role 전용. 발급·조회는 전부 엣지 함수가 한다.
--   ⛔ 브라우저에 열지 말 것 — verify_token 이 통째로 읽히면 남의 자격증을 진짜로 조회할 수 있다.
alter table exam_certificates enable row level security;

commit;

-- ── 재발급 ─────────────────────────────────────────────────────────────
-- 이름·마지막 발급시각 갱신 + 횟수 증가를 **한 문장**으로 한다.
--   ⛔ 읽고 나서 쓰면(select → update) 동시 재발급 두 번이 issue_count 를 1만 올린다.
--   ⛔ first_issued_at·cert_no·verify_token 은 건드리지 않는다 — 토큰이 갈리면 인쇄돼 나간 QR 이 죽는다.
create or replace function public.cert_reissue(p_attempt uuid, p_name text)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update exam_certificates
     set name_roman     = p_name,
         last_issued_at = now(),
         issue_count    = issue_count + 1
   where attempt_id = p_attempt;
$function$;
