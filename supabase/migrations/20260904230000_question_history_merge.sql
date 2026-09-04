-- 문항 변경 이력 표 3개 → 1개(`question_history`).
--
-- 옛 상태: 제도만 다르고 하는 일이 같은 표가 셋이었다. 컬럼 6칸(id·question_id·action·actor·detail·created_at)이
-- 완전히 같고, 다른 것은 "사람이 읽는 문항 이름표"와 "어느 묶음 소속인가" 두 칸의 **이름과 타입**뿐이었다.
--
--   cbt_question_events    56행   CARIS 자격검정   number int + bank_id uuid
--   question_events       455행   레벨테스트       code   text + level   int
--   term_question_events  159행   미니게임 용어    code   text
--
-- 새 표는 그 두 칸을 `label`(=number·code) · `scope`(=bank_id·level) 로 통일하고 `kind` 로 제도를 가른다.
--
-- ⛔ **이 마이그레이션은 옛 표를 지우지 않는다.** 브라우저와 엣지 함수가 컬럼을 이름으로 select 하므로
--    먼저 지우면 PostgREST 가 400 을 내고 그 이력 탭이 통째로 멈춘다. 순서는
--      ① 이 마이그레이션(새 표 + 이관, 옛 표는 그대로) → ② 코드 배포 → ③ 옛 표 드롭(다음 마이그레이션).
--
-- ⛔ **`label` 값을 다시 계산하지 말 것.** 이력의 존재 이유가 "그 시점의 스냅샷"이다. 실제로 2026-07
--    레벨 사다리 밀기 때 문항 번호가 바뀌었는데 이력의 code 는 옛 값(L1-*)이라 관리자가 번호로 검색해도
--    안 나온 사고가 있었다(66건). 그건 그때 값을 **맞춰서** 고친 것이고, 여기서는 지금 값을 그대로 옮긴다.

create table if not exists public.question_history (
  id          uuid primary key default gen_random_uuid(),
  -- 어느 제도의 문항인가. translate-questions 의 지갑 구분(caris/leveltest)과 같은 낱말.
  kind        text not null check (kind in ('caris', 'leveltest', 'term')),
  -- FK 아님 — 문항이 지워져도 로그는 남는다(옛 세 표 전부 같은 규칙).
  question_id uuid,
  -- 사람이 읽는 문항 이름표: 120 · L3-045 · T-001. 관리자가 이걸로 검색한다.
  -- ⚠️ 옛 CARIS `number` 는 int 였다 → text 로 접었다(120 → '120').
  label       text,
  -- 어느 묶음 소속인가: caris=문제은행 uuid · leveltest=레벨(1~7) · term=없음.
  scope       text,
  action      text not null,
  actor       text,
  detail      jsonb,
  -- ⚠️ 옛 cbt·level 은 nullable 이었다(실측 null 0건). 아래 이관이 coalesce 로 메운다.
  created_at  timestamptz not null default now()
);

-- ⚠️ question_id 가 **비는 행이 정상**이다 — 문항 하나가 아닌 작업(엑셀 import, 여러 문항 일괄 수정)은
--    문항 없이 남는다(실측 CARIS 30건 = import 22 + edit 8). NOT NULL 을 걸면 그 행들이 통째로 막힌다.

-- 조회는 언제나 kind 로 먼저 좁힌다 → 인덱스도 kind 를 앞에 둔다.
create index if not exists question_history_kind_created_idx on public.question_history (kind, created_at desc);
create index if not exists question_history_kind_label_idx   on public.question_history (kind, label);
create index if not exists question_history_kind_scope_idx   on public.question_history (kind, scope) where scope is not null;
create index if not exists question_history_question_idx     on public.question_history (question_id) where question_id is not null;

alter table public.question_history enable row level security;
-- 정책 없음 = service role 전용(관리자 함수만 읽고 쓴다). 옛 세 표와 같은 규칙.

-- ── 이관 ─────────────────────────────────────────────────────
-- 옛 id 를 그대로 가져간다(실측 세 표 사이 중복 0건). 새로 뽑으면 이력의 신원이 바뀌어
-- 화면의 key 와 되돌리기 대상이 옛 기록과 이어지지 않는다.
insert into public.question_history (id, kind, question_id, label, scope, action, actor, detail, created_at)
select id, 'caris', question_id, number::text, bank_id::text, action, actor, detail, coalesce(created_at, now())
  from public.cbt_question_events
union all
select id, 'leveltest', question_id, code, level::text, action, actor, detail, coalesce(created_at, now())
  from public.question_events
union all
select id, 'term', question_id, code, null, action, actor, detail, coalesce(created_at, now())
  from public.term_question_events
on conflict (id) do nothing;

-- ⛔ **행을 잃지 않았는지 DB 가 직접 센다.** 조용히 사라지는 길은 id 충돌이다 — 옛 세 표는 서로 남남이라
--    같은 id 를 쓸 수 있었고, 겹치면 위 `on conflict do nothing` 이 그 행을 말없이 건너뛴다(에러도 없고
--    화면에도 안 뜬다). 사람 눈으로 확인하는 자리로 두면 안 되므로 어긋나면 트랜잭션을 통째로 되돌린다.
--
-- ⚠️ 판정은 `<` 다(`<>` 가 아니다) — **이 파일은 코드 배포 뒤 한 번 더 돌려야 하기 때문이다.**
--    마이그레이션 적용과 함수 배포 사이의 틈에 일어난 변경은 옛 표에만 쌓이고(배포 전 코드가 그리 쓴다),
--    배포 뒤엔 새 표에만 쌓인다 — 그 틈의 행을 쓸어 담지 않으면 이력 탭에서 통째로 사라진다.
--    배포 뒤에는 새 표가 옛 표보다 **많은 게 정상**이므로, 모자랄 때만 터뜨린다.
do $$
declare
  r record;
  got bigint;
begin
  for r in
    select 'caris' as kind, (select count(*) from public.cbt_question_events)  as want
    union all
    select 'leveltest',     (select count(*) from public.question_events)
    union all
    select 'term',          (select count(*) from public.term_question_events)
  loop
    select count(*) into got from public.question_history h where h.kind = r.kind;
    if got < r.want then
      raise exception '이력 이관 행 수 불일치 (%): 옛 표 % / 새 표 % — id 충돌로 행을 잃었다',
        r.kind, r.want, got;
    end if;
  end loop;
end $$;

comment on table public.question_history is
  '문항 변경 이력(세 제도 공용). 읽고 쓰는 자리는 _shared/question-history.ts 하나 — kind 필터를 빠뜨리면 남의 문항이 섞인다.';
