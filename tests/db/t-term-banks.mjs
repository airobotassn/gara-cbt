// T-TERM-BANKS — DAILY QUIZ 문제은행(20260908120000)을 pglite 로 검증.
//   같은 표(term_questions)를 은행(bank_id)으로 갈라 게임 3종과 DAILY QUIZ 가 나눠 쓴다.
//
// 지키는 것:
//  ⭐1) **시드 = src/lib/terms.ts 의 50개 그대로, 같은 순서.** 마이그레이션만으로 오늘의 문제가 바뀌면 안 된다 —
//       /daily 가 목록 순서 위에서 epochDay % N 번째를 내므로 개수·순서·문장이 전부 같아야 한다(50개 전부 대조).
//  ⭐2) **번역은 한국어 세 칸이 정확히 같은 살아 있는 게임 행에서만 복사한다.** 문장이 손봐진 행·지운 행·중지된 행의
//       번역을 가져오면 DAILY 에서 외국어로 보는 사람만 다른 문장을 읽는다.
//  ⭐3) **정답 유일은 은행 안에서만** — 같은 용어가 두 은행에 있는 게 정상이고, 한 은행 안의 중복은 여전히 막힌다.
//  ⭐4) **이력 scope** — 옛 term 행은 전부 'game' 이 되고, 다른 제도(caris)의 scope 는 안 건드린다.
//   5) bank_id 가 null 이던 22개(2026-08-11 이후 추가분)는 게임 은행이 되고, 칸이 NOT NULL·기본 a1 로 잠긴다.
//   6) 재실행 안전 — 두 번 돌려도 50개 그대로다.
//   7) 코드 sync — _shared/term-banks.ts 의 uuid·접두사가 마이그레이션과 같고, term-pool 이 'daily' 를 DAILY 은행에 물리고,
//      admin 의 은행 보는 자리 다섯이 전부 bank 를 거른다.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';

const MIG = 'supabase/migrations/20260908120000_daily_term_bank.sql';
const A1 = '00000000-0000-0000-0000-0000000000a1';
const A2 = '00000000-0000-0000-0000-0000000000a2';

const db = await PGlite.create();
const raw = (sql) => db.exec(sql);
const q = (sql, params) => db.query(sql, params);

const results = [];
const rec = (name, got, want, pass) =>
  results.push({ name, got: JSON.stringify(got), want: JSON.stringify(want), pass });
const eq = (name, got, want) => rec(name, got, want, JSON.stringify(got) === JSON.stringify(want));
const ok = (name, cond, got) => rec(name, got, true, !!cond);

// ── terms.ts 의 RAW 50개를 그대로 읽는다(시드 대조의 기준) ──────────────
const termsSrc = readFileSync('src/lib/terms.ts', 'utf8');
const RAW = JSON.parse('[' + termsSrc.match(/const RAW[^=]*=\s*\[([\s\S]*?)\n\]/)[1].trim().replace(/,\s*$/, '') + ']');
eq('전제: terms.ts RAW 는 50개', RAW.length, 50);

// ── 선행: 프로덕션 정의 그대로(2026-09-08 실측 컬럼·인덱스) ───────────────
await raw(`
create table term_banks (
  id uuid primary key default gen_random_uuid(),
  name text not null, description text not null default '',
  active boolean not null default true, sort_order int not null default 0,
  created_at timestamptz not null default now()
);
insert into term_banks (id, name, description, sort_order) values ('${A1}', 'AI·로봇 용어', '게임', 0);
create table term_questions (
  id uuid primary key default gen_random_uuid(),
  field text not null default 'AI',
  desc_i18n jsonb not null default '{}'::jsonb,
  answer_i18n jsonb not null default '{}'::jsonb,
  distractors_i18n jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  bank_id uuid references term_banks(id) on delete set null,
  code text,
  deleted_at timestamptz
);
create unique index term_questions_answer_uniq on term_questions ((answer_i18n->>'ko')) where active;
create unique index term_questions_code_uniq on term_questions (code) where code is not null;
create table question_history (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('caris', 'leveltest', 'term')),
  question_id uuid, label text, scope text,
  action text not null, actor text, detail jsonb,
  created_at timestamptz not null default now()
);`);

// ── 씨앗: 게임 은행의 성질을 그대로 심는다 ──────────────────────────────
//   T-001 = terms.ts 1번과 **정확히 같다**(번역 있음)          → DAILY D-001 이 번역을 물려받아야 한다
//   T-002 = terms.ts 2번인데 관리자가 **설명을 손봤다**(번역 있음) → 물려받으면 안 된다
//   T-004 = terms.ts 4번과 같지만 **지웠다**                       → 물려받으면 안 된다
//   T-005 = terms.ts 5번과 같지만 **중지했다**                     → 물려받으면 안 된다
//   T-051 = 2026-08-11 이후 추가분 — bank_id 가 **null** 이다
const row = (i) => RAW[i];
const J = (v) => JSON.stringify(v).replace(/'/g, "''");
const ins = (code, i, { desc = row(i)[1], bank = `'${A1}'`, active = true, deleted = false, en = true } = {}) => `
insert into term_questions (code, bank_id, field, desc_i18n, answer_i18n, distractors_i18n, active, sort_order, deleted_at) values (
  '${code}', ${bank}, '${row(i)[0]}',
  '${J({ ko: desc, ...(en ? { en: `EN desc ${code}` } : {}) })}'::jsonb,
  '${J({ ko: row(i)[2][0], ...(en ? { en: `EN ans ${code}` } : {}) })}'::jsonb,
  '${J({ ko: row(i)[2].slice(1), ...(en ? { en: ['e1', 'e2', 'e3'] } : {}) })}'::jsonb,
  ${active}, ${i}, ${deleted ? 'now()' : 'null'});`;
await raw(ins('T-001', 0));
await raw(ins('T-002', 1, { desc: '데이터로부터 규칙·패턴을 학습해 성능을 개선하는 인공지능의 하위 분야' }));
await raw(ins('T-004', 3, { active: false, deleted: true }));
await raw(ins('T-005', 4, { active: false }));
await raw(`insert into term_questions (code, bank_id, field, desc_i18n, answer_i18n, distractors_i18n, sort_order)
  values ('T-051', null, 'AI툴', '{"ko":"OpenAI 대화형 AI"}', '{"ko":"챗GPT"}', '{"ko":["클로드","제미나이","코파일럿"]}', 50);`);
const CARIS_BANK = '745e60bc-c63a-4ff4-afb2-8b64064928ad';
await raw(`
insert into question_history (kind, label, scope, action, actor) values
  ('term', 'T-001', null, 'create', 'a@x.com'),
  ('term', 'T-002', null, 'update', 'a@x.com'),
  ('caris', '120', '${CARIS_BANK}', 'edit', 'b@x.com'),
  ('leveltest', 'L3-045', '3', 'edit', 'b@x.com');`);

// ── 마이그레이션 ──────────────────────────────────────────────────────
await raw(readFileSync(MIG, 'utf8'));

// 5) bank_id 채움 + 잠금
eq('5 bank_id null 이던 행이 게임 은행이 된다',
  (await q(`select bank_id from term_questions where code='T-051'`)).rows[0].bank_id, A1);
eq('5 bank_id null 은 더 없다',
  (await q(`select count(*)::int n from term_questions where bank_id is null`)).rows[0].n, 0);
{
  let refused = false;
  try { await raw(`insert into term_questions (code, bank_id, answer_i18n) values ('X-1', null, '{"ko":"x"}')`); }
  catch { refused = true; }
  ok('5 bank_id 에 null 을 넣으면 거절된다(NOT NULL)', refused, refused);
  await raw(`insert into term_questions (code, answer_i18n, desc_i18n, distractors_i18n) values ('X-2', '{"ko":"x2"}', '{"ko":"d"}', '{"ko":["a","b","c"]}')`);
  eq('5 bank_id 를 안 적으면 게임 은행이다(기본값 a1 — 옛 배포본 admin 과의 호환)',
    (await q(`select bank_id from term_questions where code='X-2'`)).rows[0].bank_id, A1);
  await raw(`delete from term_questions where code='X-2'`);
}

// 2) DAILY 은행
eq('2 DAILY 은행 행이 생긴다', (await q(`select count(*)::int n from term_banks where id='${A2}'`)).rows[0].n, 1);

// ⭐1) 시드 = terms.ts 50개 그대로
const daily = (await q(`
  select code, field, sort_order, desc_i18n->>'ko' d, answer_i18n->>'ko' a, distractors_i18n->'ko' dis,
         (select count(*)::int from jsonb_object_keys(desc_i18n)) nlang, desc_i18n->>'en' en_d, answer_i18n->>'en' en_a
    from term_questions where bank_id='${A2}' order by sort_order, code`)).rows;
eq('⭐1 DAILY 은행 문항 수 = 50', daily.length, 50);
eq('⭐1 번호 D-001 … D-050, sort_order 0 … 49 (순서 그대로)',
  daily.map((r, i) => r.code === `D-${String(i + 1).padStart(3, '0')}` && r.sort_order === i).every(Boolean), true);
{
  const mismatch = [];
  daily.forEach((r, i) => {
    const [field, desc, opts] = RAW[i] ?? [];
    if (r.field !== field || r.d !== desc || r.a !== opts?.[0] || JSON.stringify(r.dis) !== JSON.stringify(opts?.slice(1))) mismatch.push(r.code);
  });
  eq('⭐1 50개 전부 terms.ts 와 분야·설명·정답·오답이 같다(어긋난 번호)', mismatch, []);
}
eq('⭐1 전부 active 이고 지워진 것이 없다',
  (await q(`select count(*)::int n from term_questions where bank_id='${A2}' and active and deleted_at is null`)).rows[0].n, 50);

// ⭐2) 번역 복사 — 정확히 같은 살아 있는 행에서만
const byCode = Object.fromEntries(daily.map((r) => [r.code, r]));
eq('⭐2 D-001 은 T-001(정확히 같음)의 번역을 물려받는다', [byCode['D-001'].nlang, byCode['D-001'].en_d, byCode['D-001'].en_a], [2, 'EN desc T-001', 'EN ans T-001']);
eq('⭐2 D-001 의 한국어는 terms.ts 그대로다(복사가 ko 를 덮지 않는다)', byCode['D-001'].d, RAW[0][1]);
eq('⭐2 D-002 는 T-002(설명이 손봐짐)의 번역을 안 받는다 — 한국어뿐', byCode['D-002'].nlang, 1);
eq('⭐2 D-004 는 T-004(지워짐)의 번역을 안 받는다 — 한국어뿐', byCode['D-004'].nlang, 1);
eq('⭐2 D-005 는 T-005(중지됨)의 번역을 안 받는다 — 한국어뿐', byCode['D-005'].nlang, 1);
eq('⭐2 게임 은행은 한 글자도 안 바뀐다',
  (await q(`select count(*)::int n from term_questions where bank_id='${A1}' and updated_at <> created_at`)).rows[0].n, 0);

// ⭐3) 정답 유일 = 은행 안에서만
eq('⭐3 같은 용어(머신러닝)가 두 은행에 같이 있다',
  (await q(`select count(distinct bank_id)::int n from term_questions where answer_i18n->>'ko'='머신러닝' and active`)).rows[0].n, 2);
{
  let refused = '';
  try { await raw(`insert into term_questions (code, bank_id, answer_i18n, desc_i18n, distractors_i18n) values ('D-999', '${A2}', '{"ko":"머신러닝"}', '{"ko":"d"}', '{"ko":["a","b","c"]}')`); }
  catch (e) { refused = String(e?.message ?? e); }
  ok('⭐3 같은 은행 안의 중복 정답은 여전히 막힌다', /term_questions_answer_uniq/.test(refused), refused.slice(0, 80));
  ok('⭐3 인덱스 이름이 그대로다(서버가 이 이름으로 오류를 옮긴다)', /term_questions_answer_uniq/.test(refused), true);
}
{
  await raw(`insert into term_questions (code, bank_id, answer_i18n, desc_i18n, distractors_i18n) values ('T-900', '${A1}', '{"ko":"새용어"}', '{"ko":"d"}', '{"ko":["a","b","c"]}')`);
  let refused = false;
  try { await raw(`insert into term_questions (code, bank_id, answer_i18n, desc_i18n, distractors_i18n) values ('D-900', '${A2}', '{"ko":"새용어"}', '{"ko":"d"}', '{"ko":["a","b","c"]}')`); }
  catch { refused = true; }
  ok('⭐3 게임에 있는 용어를 DAILY 에 넣는 건 통과한다', !refused, !refused);
  await raw(`delete from term_questions where code in ('T-900', 'D-900')`);
}

// ⭐4) 이력 scope
eq('⭐4 옛 term 이력은 전부 game 이 된다',
  (await q(`select count(*)::int n from question_history where kind='term' and scope='game'`)).rows[0].n, 2);
eq('⭐4 term 이력에 scope 가 빈 행이 없다',
  (await q(`select count(*)::int n from question_history where kind='term' and scope is null`)).rows[0].n, 0);
eq('⭐4 caris·leveltest 의 scope 는 그대로다',
  (await q(`select scope from question_history where kind in ('caris','leveltest') order by kind`)).rows.map((r) => r.scope), [CARIS_BANK, '3']);

// 6) 재실행 안전
{
  let again = true;
  try { await raw(readFileSync(MIG, 'utf8')); } catch { again = false; }
  ok('6 두 번 돌려도 오류가 없다', again, again);
  eq('6 두 번 돌려도 DAILY 는 50개 그대로', (await q(`select count(*)::int n from term_questions where bank_id='${A2}'`)).rows[0].n, 50);
  eq('6 두 번 돌려도 은행은 둘', (await q(`select count(*)::int n from term_banks`)).rows[0].n, 2);
}

// 7) 코드 sync — 마이그레이션 ↔ _shared/term-banks.ts ↔ term-pool ↔ admin ↔ 프론트
{
  const mig = readFileSync(MIG, 'utf8');
  const banks = readFileSync('supabase/functions/_shared/term-banks.ts', 'utf8');
  const pool = readFileSync('supabase/functions/term-pool/index.ts', 'utf8');
  const reform = readFileSync('supabase/functions/admin/reform.ts', 'utf8');
  const feTypes = readFileSync('src/lib/termPool.ts', 'utf8');
  const dailyPage = readFileSync('src/pages/Daily.tsx', 'utf8');
  const adminPage = readFileSync('src/pages/AdminTermQuestions.tsx', 'utf8');
  const adminRoot = readFileSync('src/pages/Admin.tsx', 'utf8');

  ok('7 _shared/term-banks.ts 의 game uuid = 마이그레이션 a1', banks.includes(`game: { id: '${A1}'`), true);
  ok('7 _shared/term-banks.ts 의 daily uuid = 마이그레이션 a2', banks.includes(`daily: { id: '${A2}'`) && mig.includes(A2), true);
  ok('7 접두사 T/D 가 시드 번호와 같다', banks.includes(`codePrefix: 'T'`) && banks.includes(`codePrefix: 'D'`) && mig.includes(`'D-' || lpad`), true);
  ok('7 term-pool 이 daily 를 DAILY 은행에 물린다', /daily:\s*'daily'/.test(pool) && pool.includes(`TERM_BANKS[bank].id`), true);
  ok('7 term-pool 순서가 결정론적이다(sort_order → code)', /\.order\('sort_order'\)\s*\.order\('code'\)/.test(pool), true);
  // admin: 은행을 보는 자리 다섯 — 각 핸들러 본문 안에 termBankKey(body?.bank) 가 있어야 한다
  const body = (name) => {
    const m = reform.match(new RegExp(`async function ${name}\\([\\s\\S]*?\\n}\\n`));
    return m ? m[0] : '';
  };
  for (const h of ['termList', 'termRestorable', 'termEvents', 'termUpsert', 'termImport']) {
    ok(`7 admin ${h} 가 bank 를 거른다`, body(h).includes('termBankKey(body?.bank)'), h);
  }
  ok('7 admin termEvents 가 이력을 scope(은행)로 거른다', body('termEvents').includes(`scope: bank`), true);
  ok('7 admin 이 새 문항에 bank_id 를 박는다(upsert·import)',
    body('termUpsert').includes('row.bank_id = TERM_BANKS[bank].id') && body('termImport').includes('bank_id: TERM_BANKS[bank].id'), true);
  ok('7 프론트 대상 타입에 daily 가 있다', /TermTarget\s*=[^\n]*'daily'/.test(feTypes), true);
  ok('7 /daily 가 DAILY 은행을 받는다', dailyPage.includes(`fetchTermPool('daily'`), true);
  {
    // ⚠️ 줄바꿈은 정규식으로 — 이 저장소는 윈도우라 CRLF 일 수 있다.
    const calls = ['termList', 'termUpsert', 'termRestorable', 'termEvents', 'termImport']
      .filter((a) => !new RegExp(`action: '${a}',\\s*bank\\b`).test(adminPage));
    eq('7 관리자 화면이 bank 를 모든 호출에 싣는다(list·upsert·restorable·events·import — 빠진 것)', calls, []);
  }
  ok('7 관리자 메뉴에 DAILY QUIZ › 문항 관리가 있고 DAILY 은행으로 선다',
    /case 'arena\/daily\/quiz': return <TermPoolAdmin key="daily" bank="daily" \/>/.test(adminRoot) &&
    /case 'arena\/minigame\/quiz': return <TermPoolAdmin key="game" bank="game" \/>/.test(adminRoot), true);
}

// ── 리포트 ───────────────────────────────────────────────────────
let bad = 0;
for (const r of results) {
  if (!r.pass) bad++;
  console.log(`${r.pass ? '✅' : '❌'} ${r.name}${r.pass ? '' : `\n     got  ${r.got}\n     want ${r.want}`}`);
}
console.log(`\n${results.length - bad}/${results.length} 통과`);
if (bad) process.exit(1);
