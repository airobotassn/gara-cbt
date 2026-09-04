// T-QUESTION-HISTORY — 문항 이력 표 3개 → 1개(`question_history`) 합치기를 pglite 로 검증.
//   옛 표: cbt_question_events(number int + bank_id uuid) · question_events(code + level int) · term_question_events(code)
//
// 지키는 것:
//  ⭐1) **행을 잃지 않는다** — kind 별 행 수가 옛 표와 정확히 같다(조인 하나 잘못 걸면 조용히 사라진다).
//  ⭐2) **id 를 그대로 가져간다** — 새로 뽑으면 화면의 key·되돌리기 대상이 옛 기록과 이어지지 않는다.
//  ⭐3) **kind 로 좁히면 남의 제도가 안 섞인다** — 표를 합친 대가로 생긴 유일한 새 위험이다.
//      (2026-09-03 term 마이그레이션이 "같은 표에 세 제도를 섞으면 이력 탭이 남의 문항을 보여준다"며
//       표를 나눴던 그 위험. 합친 지금은 이 테스트와 _shared 게이트가 그 자리를 대신한다.)
//  ⭐4) **number(int) → label(text)** 로 접힌다 — 120 이 '120' 이 되고, 관리자 검색이 문자열로 본다.
//   5) question_id 가 **비는 행이 정상**이다(엑셀 import 등) — NOT NULL 이 걸려 있으면 안 된다.
//   6) label·scope 도 nullable 이다(term 은 scope 가 없다).
//   7) kind CHECK 가 오타를 막는다.
//   8) 옛 표는 이 마이그레이션이 **지우지 않는다**(코드 배포 뒤 별도 마이그레이션 — PostgREST 400 방지).
//   9) 읽고 쓰는 자리(_shared/question-history.ts)가 kind 를 **필수 인자**로 받는다.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const MIG = 'supabase/migrations/20260904400000_question_history_merge.sql';
const DROP = 'supabase/migrations/20260904410000_drop_old_question_event_tables.sql';
const SHARED = 'supabase/functions/_shared/question-history.ts';

const db = await PGlite.create();
const raw = (sql) => db.exec(sql);
const q = (sql, params) => db.query(sql, params);

const results = [];
const rec = (name, got, want, pass) =>
  results.push({ name, got: JSON.stringify(got), want: JSON.stringify(want), pass });
const eq = (name, got, want) => rec(name, got, want, JSON.stringify(got) === JSON.stringify(want));
const ok = (name, cond, got) => rec(name, got, true, !!cond);

// ── 선행: 옛 표 3개를 실제 정의 그대로 만든다 ────────────────────
await raw(`
create table cbt_question_events (
  id uuid primary key default gen_random_uuid(),
  question_id uuid, number int, action text not null, actor text,
  detail jsonb, created_at timestamptz default now(), bank_id uuid
);
create table question_events (
  id uuid primary key default gen_random_uuid(),
  question_id uuid, code text, level int, action text not null, actor text,
  detail jsonb, created_at timestamptz default now()
);
create table term_question_events (
  id uuid primary key default gen_random_uuid(),
  question_id uuid, code text, action text not null, actor text,
  detail jsonb, created_at timestamptz not null default now()
);`);

// ── 씨앗: 실측 프로덕션의 성질을 그대로 심는다 ───────────────────
//   · CARIS 는 question_id·number 가 **둘 다 비는 행**이 있다(엑셀 import·일괄 수정).
//   · 레벨테스트는 code(L#-###) + level 이 항상 있다.
//   · 용어는 code(T-###)만 있고 소속이 없다.
const BANK_A = '745e60bc-c63a-4ff4-afb2-8b64064928ad';
const BANK_B = '4bada5a0-b8fc-44eb-be4c-ff17da884aa3';
const QID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

await raw(`
insert into cbt_question_events (id, question_id, number, bank_id, action, actor, detail, created_at) values
  ('${QID(1)}', '${QID(101)}', 120, '${BANK_A}', 'edit',       'a@x.com', '{"n":1}', '2026-08-26 06:04:02+00'),
  ('${QID(2)}', '${QID(102)}',   7, '${BANK_B}', 'deactivate', 'a@x.com', null,      '2026-08-26 06:03:48+00'),
  ('${QID(3)}', null,          null, '${BANK_A}', 'import',    'a@x.com', '{"count":120}', '2026-09-03 01:30:43+00');

insert into question_events (id, question_id, code, level, action, actor, detail, created_at) values
  ('${QID(4)}', '${QID(201)}', 'L4-101', 4, 'deactivate', 'b@x.com', null, '2026-09-02 06:22:53+00'),
  ('${QID(5)}', '${QID(202)}', 'L3-045', 3, 'edit',       'b@x.com', '{"prompt":{"before":"a","after":"b"}}', '2026-09-01 00:00:00+00');

insert into term_question_events (id, question_id, code, action, actor, detail, created_at) values
  ('${QID(6)}', '${QID(301)}', 'T-048', 'update', 'c@x.com', '{"answer":"챗GPT"}', '2026-09-04 04:42:47+00'),
  ('${QID(7)}', '${QID(302)}', 'T-061', 'delete', 'c@x.com', null,                 '2026-09-04 04:39:08+00');`);

const before = {
  caris: (await q('select count(*)::int n from cbt_question_events')).rows[0].n,
  leveltest: (await q('select count(*)::int n from question_events')).rows[0].n,
  term: (await q('select count(*)::int n from term_question_events')).rows[0].n,
};

// ── 마이그레이션 적용 ────────────────────────────────────────────
await raw(readFileSync(MIG, 'utf8'));

// ⭐1) 행을 잃지 않았다 — kind 별로 대조
const after = Object.fromEntries(
  (await q(`select kind, count(*)::int n from question_history group by 1 order by 1`)).rows.map((r) => [r.kind, r.n]),
);
eq('⭐1 kind 별 행 수가 옛 표와 같다', after, before);
eq('⭐1 총 행 수', (await q('select count(*)::int n from question_history')).rows[0].n,
  before.caris + before.leveltest + before.term);

// ⭐2) id 를 그대로 가져갔다
eq('⭐2 옛 id 가 그대로 있다', (await q(
  `select count(*)::int n from question_history where id in ('${QID(1)}','${QID(4)}','${QID(6)}')`
)).rows[0].n, 3);

// ⭐3) kind 로 좁히면 남의 제도가 안 섞인다
eq('⭐3 caris 는 CARIS 것만', (await q(
  `select label from question_history where kind='caris' order by label nulls last`
)).rows.map((r) => r.label), ['120', '7', null]);
eq('⭐3 leveltest 는 레벨테스트 것만', (await q(
  `select label from question_history where kind='leveltest' order by label`
)).rows.map((r) => r.label), ['L3-045', 'L4-101']);
eq('⭐3 term 은 용어 것만', (await q(
  `select label from question_history where kind='term' order by label`
)).rows.map((r) => r.label), ['T-048', 'T-061']);
// 옛 표가 서로 남남이던 시절엔 불가능했던 사고 — kind 를 빠뜨린 조회는 세 제도가 통째로 섞인다.
ok('⭐3 kind 를 빼면 세 제도가 섞인다(그래서 필터가 필수다)',
  (await q('select count(distinct kind)::int n from question_history')).rows[0].n === 3, 3);

// ⭐4) number(int) → label(text)
const labelType = (await q(
  `select data_type from information_schema.columns where table_name='question_history' and column_name='label'`
)).rows[0].data_type;
eq('⭐4 label 은 text 다', labelType, 'text');
eq("⭐4 CARIS 120 이 '120' 으로 접혔다", (await q(
  `select label from question_history where id='${QID(1)}'`
)).rows[0].label, '120');
// 관리자 검색이 문자열 부분일치로 본다 — 접힌 값이 그 검색에 걸려야 한다.
eq('⭐4 문자열 검색에 걸린다', (await q(
  `select count(*)::int n from question_history where kind='caris' and label like '%12%'`
)).rows[0].n, 1);

// 5) question_id 가 비는 행이 정상 — import 행이 살아 있어야 한다
eq('5 question_id 없는 행도 이관됐다', (await q(
  `select action, label, scope from question_history where id='${QID(3)}'`
)).rows[0], { action: 'import', label: null, scope: BANK_A });
const qidNullable = (await q(
  `select is_nullable from information_schema.columns where table_name='question_history' and column_name='question_id'`
)).rows[0].is_nullable;
eq('5 question_id 는 NOT NULL 이 아니다', qidNullable, 'YES');

// 6) scope — caris=bank uuid · leveltest=레벨 · term=없음
eq('6 scope: caris 는 문제은행 uuid', (await q(
  `select scope from question_history where id='${QID(2)}'`
)).rows[0].scope, BANK_B);
eq('6 scope: leveltest 는 레벨 숫자', (await q(
  `select scope from question_history where id='${QID(4)}'`
)).rows[0].scope, '4');
eq('6 scope: term 은 비어 있다', (await q(
  `select count(*)::int n from question_history where kind='term' and scope is not null`
)).rows[0].n, 0);
// 문제은행 필터(CARIS 이력 탭)가 실제로 걸린다
eq('6 문제은행으로 거르면 그 은행 것만', (await q(
  `select count(*)::int n from question_history where kind='caris' and scope='${BANK_A}'`
)).rows[0].n, 2);

// 7) kind CHECK 가 오타를 막는다
let checkHeld = false;
try {
  await raw(`insert into question_history (kind, action) values ('carisss', 'edit')`);
} catch { checkHeld = true; }
ok('7 kind CHECK 가 오타를 막는다', checkHeld, checkHeld);

// 8) 옛 표는 아직 살아 있다(코드 배포 전에 지우면 PostgREST 400)
for (const t of ['cbt_question_events', 'question_events', 'term_question_events']) {
  ok(`8 옛 표 ${t} 는 아직 안 지웠다`, (await q(`select to_regclass('public.${t}') t`)).rows[0].t !== null, true);
}

// 9) 읽고 쓰는 자리가 kind 를 필수 인자로 받는다 — 소스에서 확인
const shared = readFileSync(SHARED, 'utf8');
// kind 가 **두 번째 위치의 필수 인자**여야 한다 — 선택 인자(`kind?`)나 옵션 객체 안으로 들어가는 순간
// 빠뜨려도 타입이 안 잡히고, 그때부터 이력 탭에 남의 제도가 섞인다.
ok('9 logQuestionEvent 가 kind 를 필수 인자로 받는다',
  /logQuestionEvent\s*\(\s*\n?\s*admin:\s*\w+,\s*\n?\s*kind:\s*QuestionKind,/.test(shared), true);
ok('9 readQuestionHistory 가 kind 를 필수 인자로 받는다',
  /readQuestionHistory\s*\(\s*\n?\s*admin:\s*\w+,\s*\n?\s*kind:\s*QuestionKind,/.test(shared), true);
ok('9 조회가 언제나 kind 로 좁힌다', /\.eq\('kind',\s*kind\)/.test(shared), true);

// ── 재실행 안전성: 같은 마이그레이션을 또 돌려도 행이 안 늘어난다 ──
await raw(readFileSync(MIG, 'utf8'));
eq('재실행해도 행이 안 늘어난다(on conflict do nothing)',
  (await q('select count(*)::int n from question_history')).rows[0].n,
  before.caris + before.leveltest + before.term);

// ── 행 수 가드가 진짜로 터지는지 ─────────────────────────────────
// 이 이관이 조용히 행을 잃는 길은 **id 충돌**이다 — 옛 세 표는 서로 남남이라 같은 id 를 쓸 수 있었고,
// 겹치면 `on conflict do nothing` 이 그 행을 말없이 건너뛴다(에러도 없고 화면에도 안 뜬다).
// 프로덕션 실측은 충돌 0건이지만, 0건이라는 사실이 아니라 **어긋나면 터진다**는 것을 여기서 증명한다.
await raw(`insert into term_question_events (id, question_id, code, action, actor)
           values ('${QID(1)}', '${QID(303)}', 'T-999', 'update', 'c@x.com')`); // ← caris 행과 같은 id
let guardFired = false;
let guardMsg = '';
try {
  await raw(readFileSync(MIG, 'utf8'));
} catch (e) {
  guardMsg = String(e?.message ?? e);
  guardFired = /행 수 불일치/.test(guardMsg);
}
ok('⭐ 행을 잃으면 마이그레이션이 스스로 터진다', guardFired, guardMsg || false);
await raw(`delete from term_question_events where id='${QID(1)}'`); // 충돌 치우고 다음 검사로

// ── 배포 뒤 재실행(틈 메우기)이 통해야 한다 ──────────────────────
// 마이그레이션 적용과 함수 배포 사이의 틈에 일어난 변경은 옛 표에만 쌓이고(배포 전 코드가 그리 쓴다),
// 배포 뒤엔 새 표에만 쌓인다. 그 틈의 행을 쓸어 담으려면 **배포 뒤에도 이 파일을 한 번 더 돌릴 수
// 있어야** 한다 — 그때 새 표는 옛 표보다 많다(정상). 가드가 `<>` 면 여기서 막혀 틈을 못 메운다.
await raw(`insert into question_history (kind, question_id, label, action, actor)
           values ('term', '${QID(304)}', 'T-777', 'update', 'c@x.com')`); // 배포 뒤 새로 쌓인 행
let sweepOk = true;
let sweepMsg = '';
try { await raw(readFileSync(MIG, 'utf8')); } catch (e) { sweepOk = false; sweepMsg = String(e?.message ?? e); }
ok('⭐ 배포 뒤(새 표가 더 많을 때) 재실행이 통한다 — 틈에 쌓인 행을 쓸어 담는 길', sweepOk, sweepMsg || true);
eq('⭐ 쓸어 담아도 배포 뒤에 쌓인 행은 안 지운다',
  (await q(`select count(*)::int n from question_history where label='T-777'`)).rows[0].n, 1);

// ── 옛 표 드롭(④)은 별도 마이그레이션이고, 못 옮긴 행이 있으면 거부한다 ──
// 드롭은 되돌릴 수 없다 — "옮긴 줄 알았는데 안 옮겨진" 상태에서 지우면 이력이 영영 사라진다.
{
  const db2 = await PGlite.create();
  const raw2 = (sql) => db2.exec(sql);
  const q2 = (sql) => db2.query(sql);
  await raw2(`
    create table cbt_question_events (id uuid primary key default gen_random_uuid(), question_id uuid, number int,
      action text not null, actor text, detail jsonb, created_at timestamptz default now(), bank_id uuid);
    create table question_events (id uuid primary key default gen_random_uuid(), question_id uuid, code text, level int,
      action text not null, actor text, detail jsonb, created_at timestamptz default now());
    create table term_question_events (id uuid primary key default gen_random_uuid(), question_id uuid, code text,
      action text not null, actor text, detail jsonb, created_at timestamptz not null default now());
    insert into question_events (id, question_id, code, level, action, actor)
      values ('${QID(4)}', '${QID(201)}', 'L4-101', 4, 'deactivate', 'b@x.com');`);
  await raw2(readFileSync(MIG, 'utf8'));

  // 못 옮긴 행을 인위로 만든다(새 표에서 한 줄 지운다) → 드롭이 거부돼야 한다
  await raw2(`delete from question_history where id='${QID(4)}'`);
  let dropRefused = false;
  try { await raw2(readFileSync(DROP, 'utf8')); } catch (e) { dropRefused = /드롭 중단/.test(String(e?.message ?? e)); }
  // ⚠️ 드롭 파일은 먼저 한 번 더 쓸어 담으므로, 지운 행이 옛 표에 남아 있으면 되살아나 통과한다.
  //    그게 정상이다 — 여기서 보고 싶은 건 "옛 표에도 없어서 못 살린" 경우다.
  ok('④ 쓸어 담기로 되살릴 수 있으면 드롭은 진행된다', !dropRefused, !dropRefused);
  eq('④ 드롭 직전 쓸어 담기가 빠진 행을 되살린다',
    (await q2(`select count(*)::int n from question_history where id='${QID(4)}'`)).rows[0].n, 1);
  for (const t of ['cbt_question_events', 'question_events', 'term_question_events']) {
    ok(`④ 옛 표 ${t} 가 드롭됐다`, (await q2(`select to_regclass('public.${t}') t`)).rows[0].t === null, true);
  }
}

// ── 리포트 ───────────────────────────────────────────────────────
let bad = 0;
for (const r of results) {
  if (!r.pass) bad++;
  console.log(`${r.pass ? '✅' : '❌'} ${r.name}${r.pass ? '' : `\n     got  ${r.got}\n     want ${r.want}`}`);
}
console.log(`\n${results.length - bad}/${results.length} 통과`);
if (bad) process.exit(1);
