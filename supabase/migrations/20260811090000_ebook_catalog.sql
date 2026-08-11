-- 러닝 라이브러리(/ebooks) 카탈로그 — **LEVELTEST E-BOOK / CARIS E-BOOK 두 갈래**(2026-08-11).
--   화면 맨 위 전환 버튼이 이 컬럼 하나로 갈린다. 기존 책은 전부 레벨테스트 쪽(default)이다.
--
-- 왜 `target_tier` 유무로 유추하지 않는가:
--   그러면 **급수를 정하지 않은 CARIS 교재**(시험 안내서처럼 급수 전체에 걸치는 것)를 표현할 방법이 없다.
--   레벨테스트 쪽은 이미 '레벨 무관'(target_level is null) 자리를 갖고 있는데 CARIS 만 못 갖는 건 이유가 없다.
alter table public.ebooks add column if not exists catalog text not null default 'leveltest';

alter table public.ebooks drop constraint if exists ebooks_catalog_chk;
alter table public.ebooks add constraint ebooks_catalog_chk
  check (catalog in ('leveltest', 'caris'));

-- 대상 급수(beginner..zenith). null = 급수 무관.
--   exam_tiers FK 인 이유는 exam_tickets(20260807090000)과 같다 — exams.tier 엔 CHECK 이 없어서
--   오타 티어가 조용히 들어가고, 그러면 그 책은 어느 급수 목록에도 안 뜨는 유령이 된다.
alter table public.ebooks add column if not exists target_tier text references public.exam_tiers(tier);

-- 한 책은 한 카탈로그에만 속한다 — 반대쪽 분류 컬럼은 비어 있어야 한다.
--   안 막으면 "Lv.3 이면서 Pro" 인 책이 생기고, 그 책을 어느 탭에 세울지가 데이터가 아니라 코드 취향이 된다.
alter table public.ebooks drop constraint if exists ebooks_catalog_target_chk;
alter table public.ebooks add constraint ebooks_catalog_target_chk check (
  (catalog = 'leveltest' and target_tier is null)
  or (catalog = 'caris' and target_level is null)
);
