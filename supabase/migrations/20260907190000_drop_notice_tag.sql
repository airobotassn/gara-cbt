-- 2026-09-07 · 죽은 칸 notices.tag 제거 (2026-09-07 지시)
--
--   공지에는 분류 성격의 칸이 셋이었는데 실제로 쓰이는 건 둘이다:
--     · category (guide·schedule)  → 화면이 분류 배지로 그린다.        살아 있음
--     · required (boolean)         → 화면이 빨간 「필독」 배지로 그린다. 살아 있음
--     · tag      (notice·required) → **읽는 코드도 쓰는 코드도 0곳**
--
--   `tag` 는 boolean `required` 를 만들기 전에 같은 일을 하던 옛 칸이다(값이 'notice'/'required' 인 게 증거).
--   지금은 공개 화면(/notice·/notice/:id)이 `category, required` 만 select 하고, 관리자 저장(noticeUpsert)이
--   만드는 row 에도 tag 가 없어서 **새 공지는 default 값이 그대로 박힌다** — 아무도 안 보는 값이 계속 쌓인다.
--
--   ⚠️ 배포가 필요 없다 — select 목록에도 없고 insert/update row 에도 없다. not null default 라 빠져도 들어갔다.
--   ⚠️ FAQ 의 `tag_i18n` 은 **다른 것**이다(화면에 뜨는 꼬리표, 6개국어). 건드리지 않는다.
--
--   지우기 전 값: notice 5 · required 2 (7행)

begin;

alter table notices drop column if exists tag;

commit;
