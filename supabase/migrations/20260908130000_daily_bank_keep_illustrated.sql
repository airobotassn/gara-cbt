-- 2026-09-08 · DAILY QUIZ 은행 — 해설 그림이 있는 8문항만 남긴다 (2026-09-08 지시 "일단 그런 코드 말고는 다 지워주고")
--
-- DAILY QUIZ 의 해설(풀고 나서 펼쳐지는 카드)은 코드에 있다 — src/lib/terms.ts 의 TERM_THEORY(글) +
-- src/components/DailyVisual.tsx(SVG 그림). 지금 해설이 붙은 용어는 8개뿐이고 나머지 42문항은 문제·정답만 나온다.
-- 지시는 "해설 없는 문항은 일단 빼라" — 그래서 DAILY 은행에서 8개 빼고 전부 **삭제** 처리한다.
--
--   · 삭제 = deleted_at + active=false (관리자 › 문항 이력 › 삭제 탭에서 되돌릴 수 있다). 하드 삭제 아님.
--   · 게임 은행(a1)은 건드리지 않는다 — 게임엔 해설이 없고, 은행이 다르다.
--   · ⛔ **아래 8개 이름은 TERM_THEORY 의 키와 한 벌이다**(sync pair). 해설은 한국어 정답 표기로 붙기 때문에
--     여기 목록이 코드와 어긋나면 "남겼는데 해설이 안 나오는" 문항이 생긴다. tests/db/t-term-banks.mjs 가 대조한다.
--   · 이력(question_history)에 문항마다 delete 한 줄을 남긴다 — 관리자가 "왜 42개가 없어졌나" 를 이력 탭에서 본다.
--   · 재실행 안전: 이미 삭제된 행은 다시 안 잡히고 이력도 다시 안 쌓인다.
--
-- 이 뒤로 /daily 는 8문항 위에서 8일 주기로 돈다(순서 = D-001, D-003, D-020~024, D-035).
-- 되돌리기: 관리자 화면의 되돌리기, 또는
--   update term_questions set deleted_at = null, active = true where bank_id = a2 and deleted_at is not null;

begin;

with del as (
  update public.term_questions
     set deleted_at = now(), active = false, updated_at = now()
   where bank_id = '00000000-0000-0000-0000-0000000000a2'
     and deleted_at is null
     and answer_i18n->>'ko' not in (
       '엔드 이펙터', '서보모터', '매니퓰레이터', '그리퍼', '자유도(DOF)', '인공지능(AI)', '딥러닝', '피지컬 AI'
     )
  returning id, code, answer_i18n->>'ko' as answer
)
insert into public.question_history (kind, question_id, label, scope, action, actor, detail)
select 'term', id, code, 'daily', 'delete', 'migration:20260908130000',
       jsonb_build_object('answer', answer, 'reason', '해설 그림 없는 문항 정리(2026-09-08 지시)')
  from del;

commit;
